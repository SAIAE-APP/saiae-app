-- Fase 2+3 do Cardápio Digital (CLAUDE.md, roadmap): cliente monta o
-- pedido pelo cardápio público e paga via Pix (Mercado Pago) antes dele
-- cair na Cozinha. Mesmo modelo já validado pro Fiscal (FocusNFe): cada
-- barraca cria a própria conta no provedor e cola só o Access Token aqui
-- — o Sai aê nunca guarda dinheiro nem vira instituição de pagamento.
--
-- Decisão de arquitetura: NÃO mexe em criar_pedido nem no enum de
-- pedidos.status (que nem está rastreado nas migrations — não dá pra
-- saber com segurança se há um CHECK constraint nos valores hoje). O
-- pedido de verdade em pedidos/itens_do_pedido só nasce depois que o
-- Mercado Pago confirma o pagamento (ver edge function
-- webhook-mercadopago, que chama a própria criar_pedido via service
-- role). Até lá, a cobrança pendente vive isolada em
-- pagamentos_pendentes — zero mudança em Cozinha/Dashboard/Histórico.

alter table public.barracas
  add column pagamento_online_habilitado boolean not null default false;

-- Token do Mercado Pago — mesmo padrão de barracas_fiscal_token/
-- barracas_senha_admin: RLS ligada, sem NENHUMA policy (só acesso via
-- função SECURITY DEFINER ou service role), nunca lido de volta pelo
-- client.
create table public.barracas_pagamento_token (
  barraca_id uuid primary key references public.barracas(id) on delete cascade,
  access_token text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.barracas_pagamento_token enable row level security;

create or replace function definir_token_pagamento(p_barraca_id uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  insert into barracas_pagamento_token (barraca_id, access_token, atualizado_em)
  values (p_barraca_id, p_token, now())
  on conflict (barraca_id) do update set access_token = excluded.access_token, atualizado_em = now();
end;
$$;

create or replace function token_pagamento_configurado(p_barraca_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  return exists (select 1 from barracas_pagamento_token where barraca_id = p_barraca_id);
end;
$$;

-- Cobrança pendente de um pedido feito no cardápio público. `itens` é um
-- snapshot já com o preço REAL resolvido no servidor (a edge function
-- criar-pagamento-pix nunca confia em preço vindo do cliente) — é esse
-- snapshot que vira o p_itens de criar_pedido quando o pagamento é
-- aprovado.
create table public.pagamentos_pendentes (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id),
  mesa text,
  viagem boolean not null default false,
  observacao text,
  itens jsonb not null,
  client_uuid text not null unique,
  mercadopago_order_id text,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado', 'expirado')),
  pedido_id uuid references public.pedidos(id),
  criado_em timestamptz not null default now()
);

alter table public.pagamentos_pendentes enable row level security;

-- Consulta pública de status — o uuid aleatório do pagamento funciona
-- como "chave de posse": só quem recebeu esse id no checkout (a resposta
-- de criar-pagamento-pix) consegue consultar aquele status específico.
-- Nunca devolve dado de outros pagamentos nem da barraca.
create or replace function consultar_status_pagamento(p_id uuid)
returns table (status text, senha int, pedido_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select pp.status, p.senha, pp.pedido_id
  from pagamentos_pendentes pp
  left join pedidos p on p.id = pp.pedido_id
  where pp.id = p_id;
$$;

grant execute on function consultar_status_pagamento(uuid) to anon, authenticated;
