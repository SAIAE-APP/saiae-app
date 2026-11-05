-- Painel do dono do sistema, funcionalidade 1: planos e prazos de todas as barracas
-- (docs/roadmap-admin-e-observabilidade.md). Só aditiva: não altera
-- `usuario_tem_acesso_barraca`, `assinatura_tem_acesso` nem nenhuma policy existente.
--
-- A allowlist `superadmins` segue o desenho de `usuarios_suporte`: RLS ligada e SEM policy,
-- só as funções SECURITY DEFINER abaixo leem. Inclusão é manual por SQL (uma vez):
--   insert into public.superadmins (usuario_id)
--   select id from auth.users where email = 'contatosaiae@gmail.com';
-- Tirar a linha encerra o acesso na hora, porque toda chamada confere a allowlist de novo.

create table if not exists public.superadmins (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.superadmins enable row level security;
revoke all on table public.superadmins from public, anon, authenticated;

-- Usada pelo front só para decidir se mostra o link do painel. Não é barreira de segurança:
-- a barreira é `admin_listar_barracas`, que confere a allowlist por conta própria.
create or replace function public.sou_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.superadmins where usuario_id = auth.uid());
$$;

revoke all on function public.sou_superadmin() from public, anon;
grant execute on function public.sou_superadmin() to authenticated;

-- Lista paginada de barracas com plano, estado e prazo. `total` é o total depois dos
-- filtros (igual em todas as linhas), para a tela paginar sem segunda chamada.
-- p_filtro: null | 'vence_7d' | 'trial_acabando' | 'vencida'. p_plano: null | 'essencial' | 'pro'.
-- Estado: trial / ativa / vencida / cancelada. `tem_acesso` é o que `assinatura_tem_acesso`
-- decide (past_due dentro da tolerância é 'vencida' com acesso, por isso as duas colunas).
create or replace function public.admin_listar_barracas(
  p_filtro text default null,
  p_plano text default null,
  p_limite integer default 50,
  p_offset integer default 0
)
returns table (
  barraca_id uuid,
  nome text,
  slug text,
  email_dono text,
  plano text,
  estado text,
  tem_acesso boolean,
  inicio_em timestamptz,
  vencimento_em timestamptz,
  dias_restantes integer,
  origem_cobranca text,
  ultimo_pagamento_em timestamptz,
  total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_filtro is not null and p_filtro not in ('vence_7d', 'trial_acabando', 'vencida') then
    raise exception 'filtro invalido' using errcode = '22023';
  end if;
  if p_plano is not null and p_plano not in ('essencial', 'pro') then
    raise exception 'plano invalido' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      b.id as barraca_id,
      b.nome,
      b.slug,
      u.email::text as email_dono,
      a.plan as plano,
      case
        when a.usuario_id is null then 'vencida'
        when a.status = 'trialing' and a.trial_ends_at is not null and now() < a.trial_ends_at then 'trial'
        when a.status = 'active' then 'ativa'
        when a.status = 'canceled' then 'cancelada'
        else 'vencida'
      end as estado,
      case when a.usuario_id is null then false else public.assinatura_tem_acesso(a) end as tem_acesso,
      coalesce(b.criada_em, a.updated_at) as inicio_em,
      case a.status
        when 'trialing' then a.trial_ends_at
        when 'past_due' then coalesce(a.grace_until, a.current_period_end)
        else a.current_period_end
      end as vencimento_em,
      case when a.stripe_subscription_id is not null then 'stripe' end as origem_cobranca,
      (select max(e.received_at)
         from public.eventos_webhook_stripe e
        where e.subscription_id = a.stripe_subscription_id
          and e.event = 'invoice.paid'
          and e.error is null) as ultimo_pagamento_em
    from public.barracas b
    join public.usuarios_barracas ub on ub.barraca_id = b.id and ub.papel = 'dono'
    join auth.users u on u.id = ub.usuario_id
    left join public.assinaturas a on a.usuario_id = ub.usuario_id
  ),
  filtrada as (
    select base.*
      from base
     where (p_plano is null or base.plano = p_plano)
       and (p_filtro is null
         or (p_filtro = 'vence_7d'
             and base.vencimento_em between now() and now() + interval '7 days')
         or (p_filtro = 'trial_acabando'
             and base.estado = 'trial'
             and base.vencimento_em <= now() + interval '7 days')
         or (p_filtro = 'vencida' and base.estado = 'vencida'))
  )
  select
    f.barraca_id, f.nome, f.slug, f.email_dono, f.plano, f.estado, f.tem_acesso,
    f.inicio_em, f.vencimento_em,
    case when f.vencimento_em is null then null
         else ceil(extract(epoch from (f.vencimento_em - now())) / 86400)::integer end,
    f.origem_cobranca, f.ultimo_pagamento_em,
    count(*) over ()
  from filtrada f
  order by f.vencimento_em asc nulls last, f.nome
  limit greatest(1, least(coalesce(p_limite, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_listar_barracas(text, text, integer, integer) from public, anon;
grant execute on function public.admin_listar_barracas(text, text, integer, integer) to authenticated;
