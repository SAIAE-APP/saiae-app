-- Pagamento marketplace (Mercado Pago, taxa de R$ 0,99 da plataforma). ADITIVA:
-- só colunas com default e tabelas novas; não toca criar_pedido,
-- usuario_tem_acesso_barraca nem nenhuma RLS existente.
--
-- Tokens OAuth: barracas_mp_oauth e mp_oauth_estados têm RLS ligada SEM policy
-- (só service role das edge functions e a RPC SECURITY DEFINER abaixo), mesmo
-- padrão de barracas_pagamento_token. Os tokens ficam cifrados e nunca voltam
-- pro cliente.
--
-- Deploy: migration -> functions -> front.

-- 1) Taxa da plataforma no snapshot da cobrança e no pedido.
alter table public.pagamentos_pendentes
  add column if not exists taxa_plataforma_centavos integer not null default 0;
alter table public.pagamentos_pendentes
  drop constraint if exists pagamentos_pendentes_taxa_plataforma_valida;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_taxa_plataforma_valida
  check (taxa_plataforma_centavos >= 0);

alter table public.pedidos
  add column if not exists taxa_plataforma_centavos integer not null default 0;
alter table public.pedidos
  drop constraint if exists pedidos_taxa_plataforma_valida;
alter table public.pedidos
  add constraint pedidos_taxa_plataforma_valida
  check (taxa_plataforma_centavos >= 0);

-- 2) Estorno: nulo = não estornado.
alter table public.pagamentos_pendentes
  add column if not exists estornado_em timestamptz;

-- 3) Conexão OAuth da barraca com o Mercado Pago.
create table if not exists public.barracas_mp_oauth (
  barraca_id uuid primary key references public.barracas (id) on delete cascade,
  access_token_cifrado text,
  refresh_token_cifrado text,
  mp_user_id text,
  expira_em timestamptz,
  status text not null default 'desconectada'
    check (status in ('conectada', 'desconectada')),
  atualizado_em timestamptz not null default now()
);
alter table public.barracas_mp_oauth enable row level security;

-- 4) State do fluxo OAuth (uso único, curto). Sem policy.
create table if not exists public.mp_oauth_estados (
  state uuid primary key,
  barraca_id uuid not null references public.barracas (id) on delete cascade,
  usuario_id uuid not null,
  expira_em timestamptz not null
);
alter table public.mp_oauth_estados enable row level security;

-- 5) Estado da conexão para o app. Erro GENÉRICO: o mesmo texto para qualquer
-- falha, sem revelar se a barraca existe.
create or replace function public.mp_oauth_status(p_barraca_id uuid)
returns table (conectada boolean, atualizado_em timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(usuario_tem_acesso_barraca(p_barraca_id), false) then
    raise exception 'sem acesso';
  end if;

  return query
    select coalesce(o.status = 'conectada', false), o.atualizado_em
      from (select 1) base
      left join barracas_mp_oauth o on o.barraca_id = p_barraca_id;
end;
$$;

revoke all on function public.mp_oauth_status(uuid) from public, anon;
grant execute on function public.mp_oauth_status(uuid) to authenticated;
