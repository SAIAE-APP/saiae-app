-- Sprint 5, Story A: camada de provedores de pagamento Pix. ADITIVA e
-- retrocompatível; o Mercado Pago existente continua funcionando sem o dono
-- refazer nada (todas as linhas atuais viram provedor 'mercadopago').
--
-- Consultado antes (pg_constraint/RLS):
--   * barracas_pagamento_token: PK em barraca_id, RLS ligada SEM policy (só
--     funções SECURITY DEFINER e service role). Mantido.
--   * pagamentos_pendentes: CHECK de status ('pendente','aprovado','rejeitado',
--     'expirado') e do tipo/taxa; nenhum toca as colunas novas.
--
-- Deploy: migration -> functions -> front. As functions novas toleram rodar antes
-- da migration (tratam ausência das colunas como Mercado Pago), mas o front novo
-- chama as RPCs de token com 3 argumentos e precisa da migration.

-- 1) Provedor escolhido pela barraca (padrão = o que existe hoje).
alter table public.barracas
  add column if not exists pagamento_provedor text not null default 'mercadopago';

alter table public.barracas
  drop constraint if exists barracas_pagamento_provedor_valido;
alter table public.barracas
  add constraint barracas_pagamento_provedor_valido
  check (pagamento_provedor in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay'));

-- 2) Token por (barraca, provedor). Linhas existentes = Mercado Pago (default).
alter table public.barracas_pagamento_token
  add column if not exists provedor text not null default 'mercadopago';

alter table public.barracas_pagamento_token
  drop constraint if exists barracas_pagamento_token_provedor_valido;
alter table public.barracas_pagamento_token
  add constraint barracas_pagamento_token_provedor_valido
  check (provedor in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay'));

-- A chave primária passa de (barraca_id) para (barraca_id, provedor). O nome da
-- constraint é descoberto no catálogo em vez de assumido.
do $$
declare
  v_pk text;
begin
  select c.conname into v_pk
    from pg_constraint c
   where c.conrelid = 'public.barracas_pagamento_token'::regclass
     and c.contype = 'p';
  if v_pk is not null
     and (select array_length(c.conkey, 1)
            from pg_constraint c
           where c.conrelid = 'public.barracas_pagamento_token'::regclass
             and c.contype = 'p') = 1 then
    execute format('alter table public.barracas_pagamento_token drop constraint %I', v_pk);
    alter table public.barracas_pagamento_token add primary key (barraca_id, provedor);
  end if;
end;
$$;

-- 3) Snapshot do provedor em cada cobrança: trocar de provedor depois não afeta
-- cobranças já emitidas. A coluna `mercadopago_order_id` continua guardando o id
-- externo do pagamento em QUALQUER provedor (nome histórico, renomear fica pra depois).
alter table public.pagamentos_pendentes
  add column if not exists provedor text not null default 'mercadopago';

alter table public.pagamentos_pendentes
  drop constraint if exists pagamentos_pendentes_provedor_valido;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_provedor_valido
  check (provedor in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay'));

comment on column public.pagamentos_pendentes.mercadopago_order_id is
  'Id externo do pagamento no provedor (coluna histórica do Mercado Pago; vale pra todos os provedores).';

-- 4) RPCs de token: ganham p_provedor com DEFAULT 'mercadopago'. As assinaturas
-- antigas (2 args) saem para não sobrar sobrecarga ambígua; a chamada antiga do
-- front (2 args nomeados) continua resolvendo nas novas. Mesmo padrão de antes:
-- SECURITY DEFINER, exige acesso à barraca, o token nunca volta pro client.
drop function if exists public.definir_token_pagamento(uuid, text);
drop function if exists public.token_pagamento_configurado(uuid);

create or replace function public.definir_token_pagamento(
  p_barraca_id uuid,
  p_token text,
  p_provedor text default 'mercadopago'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if p_provedor not in ('mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay') then
    raise exception 'provedor de pagamento inválido';
  end if;

  insert into barracas_pagamento_token (barraca_id, provedor, access_token, atualizado_em)
  values (p_barraca_id, p_provedor, p_token, now())
  on conflict (barraca_id, provedor)
  do update set access_token = excluded.access_token, atualizado_em = now();
end;
$$;

create or replace function public.token_pagamento_configurado(
  p_barraca_id uuid,
  p_provedor text default 'mercadopago'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;

  return exists (
    select 1 from barracas_pagamento_token
     where barraca_id = p_barraca_id and provedor = p_provedor
  );
end;
$$;
