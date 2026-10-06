-- Link do entregador: o motoboy (anônimo) abre um link público, vê o pedido de
-- Entrega, informa a forma de pagamento real (quando era "pagar na entrega") e
-- confirma a entrega. Tudo ADITIVO: colunas nullable, trigger novo, 2 funções
-- novas; nada do que o app v1.8 usa muda.

alter table public.pedidos
  add column if not exists entrega_token text,
  add column if not exists entrega_confirmada_em timestamptz;

create unique index if not exists pedidos_entrega_token_key
  on public.pedidos (entrega_token) where entrega_token is not null;

-- Token aleatório longo (2 UUIDv4 sem hífen = 64 hex, ~240 bits), gerado no
-- servidor só em pedido de Entrega. Pedido antigo fica NULL (sem link).
create or replace function public.pedidos_gerar_entrega_token()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tipo_atendimento = 'entrega' and new.entrega_token is null then
    new.entrega_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_entrega_token on public.pedidos;
create trigger pedidos_entrega_token
  before insert on public.pedidos
  for each row execute function public.pedidos_gerar_entrega_token();

-- Anti-abuso: tentativas com token inexistente, por IP (hash). RLS ligada e sem
-- policy: só as funções SECURITY DEFINER abaixo escrevem/leem.
create table if not exists public.entregador_tentativas (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  criado_em timestamptz not null default now()
);
alter table public.entregador_tentativas enable row level security;
create index if not exists entregador_tentativas_ip_idx
  on public.entregador_tentativas (ip_hash, criado_em desc);

create or replace function public._entregador_ip_hash()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select md5(
    'entregador:' || coalesce(
      nullif(
        split_part(
          coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
          ',', 1
        ),
        ''
      ),
      'sem-ip'
    )
  );
$$;

-- Bloqueia o IP com muitas tentativas de token inválido (20 em 10 min).
create or replace function public._entregador_bloqueado()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*) >= 20
    from public.entregador_tentativas
   where ip_hash = public._entregador_ip_hash()
     and criado_em > now() - interval '10 minutes';
$$;

create or replace function public._entregador_registrar_falha()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.entregador_tentativas (ip_hash) values (public._entregador_ip_hash());
  delete from public.entregador_tentativas where criado_em < now() - interval '1 day';
$$;

revoke all on function public._entregador_bloqueado() from public, anon, authenticated;
revoke all on function public._entregador_registrar_falha() from public, anon, authenticated;

-- Dados do pedido pro entregador. Devolve só o necessário e NUNCA dado da
-- barraca além do nome. `estado`: ok | ja_confirmado | cancelado | expirado |
-- invalido | bloqueado. Depois de confirmado (ou expirado/cancelado) o token
-- não mostra mais nada do cliente.
create or replace function public.entregador_pedido(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_barraca text;
  v_itens jsonb;
  v_total_itens integer;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if public._entregador_bloqueado() then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  select * into v_pedido from public.pedidos where entrega_token = p_token;
  if not found then
    perform public._entregador_registrar_falha();
    return jsonb_build_object('estado', 'invalido');
  end if;

  select nome into v_barraca from public.barracas where id = v_pedido.barraca_id;

  if v_pedido.entrega_confirmada_em is not null or v_pedido.status = 'entregue' then
    return jsonb_build_object('estado', 'ja_confirmado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;
  if v_pedido.status = 'cancelado' then
    return jsonb_build_object('estado', 'cancelado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;
  if v_pedido.criado_em < now() - interval '24 hours' then
    return jsonb_build_object('estado', 'expirado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'nome_item', i.nome_item,
      'quantidade', i.quantidade,
      'observacao', i.observacao
    )), '[]'::jsonb),
    coalesce(sum(i.quantidade * i.preco_centavos_unitario), 0)
  into v_itens, v_total_itens
  from public.itens_do_pedido i
  where i.pedido_id = v_pedido.id and not i.removido;

  return jsonb_build_object(
    'estado', 'ok',
    'senha', v_pedido.senha,
    'barraca_nome', v_barraca,
    'status', v_pedido.status,
    'cliente_nome', v_pedido.entrega_nome,
    'telefone', v_pedido.entrega_telefone,
    'rua', v_pedido.entrega_rua,
    'numero', v_pedido.entrega_numero,
    'bairro', v_pedido.entrega_bairro,
    'referencia', v_pedido.entrega_referencia,
    'observacao', v_pedido.observacao,
    'itens', v_itens,
    'taxa_entrega_centavos', coalesce(v_pedido.taxa_entrega_centavos, 0),
    'total_centavos', v_total_itens + coalesce(v_pedido.taxa_entrega_centavos, 0),
    'metodo_pagamento', v_pedido.metodo_pagamento,
    -- Só quem escolheu "pagar na entrega" tem o método definido pelo entregador;
    -- pedido já pago online (ou com método definido no balcão) não muda.
    'metodo_definivel', v_pedido.metodo_pagamento = 'na_entrega'
  );
end;
$$;

-- Confirma a entrega. Idempotente: segunda chamada devolve ja_confirmado sem
-- mexer em nada. SEM troco (decisão do produto): só grava o método.
create or replace function public.entregador_confirmar(p_token text, p_metodo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if public._entregador_bloqueado() then
    return jsonb_build_object('estado', 'bloqueado');
  end if;
  if p_metodo is not null and p_metodo not in ('dinheiro', 'debito', 'credito', 'pix') then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  select * into v_pedido from public.pedidos where entrega_token = p_token for update;
  if not found then
    perform public._entregador_registrar_falha();
    return jsonb_build_object('estado', 'invalido');
  end if;

  if v_pedido.entrega_confirmada_em is not null or v_pedido.status = 'entregue' then
    return jsonb_build_object('estado', 'ja_confirmado', 'senha', v_pedido.senha);
  end if;
  if v_pedido.status = 'cancelado' then
    return jsonb_build_object('estado', 'cancelado');
  end if;
  if v_pedido.criado_em < now() - interval '24 hours' then
    return jsonb_build_object('estado', 'expirado');
  end if;

  -- "Pagar na entrega": o método real é obrigatório e vem do entregador.
  -- Qualquer outro método já está definido e NÃO muda.
  if v_pedido.metodo_pagamento = 'na_entrega' and p_metodo is null then
    return jsonb_build_object('estado', 'metodo_obrigatorio');
  end if;

  update public.pedidos
     set metodo_pagamento = case when metodo_pagamento = 'na_entrega' then p_metodo else metodo_pagamento end,
         status = 'entregue',
         pronto_em = coalesce(pronto_em, now()),
         entregue_em = now(),
         entrega_confirmada_em = now()
   where id = v_pedido.id;

  return jsonb_build_object('estado', 'confirmado', 'senha', v_pedido.senha);
end;
$$;

revoke all on function public.entregador_pedido(text) from public;
revoke all on function public.entregador_confirmar(text, text) from public;
grant execute on function public.entregador_pedido(text) to anon, authenticated;
grant execute on function public.entregador_confirmar(text, text) to anon, authenticated;
