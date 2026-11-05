-- Painel do superadmin: lista de barracas v2 (busca, ordenação, filtros novos, saúde) e contagens por filtro.
-- Troca a assinatura de `admin_listar_barracas` (drop + create; os novos parâmetros têm default, então
-- chamadas posicionais antigas de 4 argumentos continuam valendo). Rollback comentado no fim.
--
-- Filtros: null (todas, sem arquivadas), vence_7d, trial_acabando, vencida, bloqueada, legado, arquivada.
-- Barraca arquivada aparece SOMENTE com o filtro 'arquivada'.
-- Ordem: vencimento (padrão, igual ao anterior), nome, atividade (último pedido mais recente primeiro,
-- sem pedido por último), nova (barraca mais nova primeiro).
-- Busca: substring sem diferenciar maiúsculas em nome, slug e e-mail do dono; `strpos` evita ter de
-- escapar % e _ (são sempre literais).
-- Saúde: mesma regra de `admin_saude_barracas` (pedido cancelado não conta; 7 dias contra 8 a 14 dias
-- atrás; erros de 24 h), agregada uma vez por barraca em vez de subconsulta por linha.

drop function if exists public.admin_listar_barracas(text, text, integer, integer);

create function public.admin_listar_barracas(
  p_filtro text default null,
  p_plano text default null,
  p_limite integer default 50,
  p_offset integer default 0,
  p_busca text default null,
  p_ordem text default 'vencimento'
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
  total bigint,
  usuario_id uuid,
  bloqueada boolean,
  bloqueio_motivo text,
  origem_plano text,
  arquivada_em timestamptz,
  pedidos_7d bigint,
  pedidos_semana_anterior bigint,
  erros_24h bigint,
  versao_app text,
  plataforma text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_busca text := nullif(lower(btrim(p_busca)), '');
  v_ordem text := coalesce(p_ordem, 'vencimento');
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_filtro is not null
     and p_filtro not in ('vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado', 'arquivada') then
    raise exception 'filtro invalido' using errcode = '22023';
  end if;
  if p_plano is not null and p_plano not in ('essencial', 'pro') then
    raise exception 'plano invalido' using errcode = '22023';
  end if;
  if v_ordem not in ('vencimento', 'nome', 'atividade', 'nova') then
    raise exception 'ordem invalida' using errcode = '22023';
  end if;

  return query
  with pedidos_agg as (
    select p.barraca_id as bid,
           count(*) filter (where p.criado_em >= now() - interval '7 days') as p7,
           count(*) filter (where p.criado_em >= now() - interval '14 days'
                              and p.criado_em < now() - interval '7 days') as p_ant,
           max(p.criado_em) as ultimo
      from public.pedidos p
     where p.cancelado_em is null
     group by p.barraca_id
  ),
  erros_agg as (
    select e.barraca_id as bid, count(*) as n
      from public.eventos_erro e
     where e.criado_em >= now() - interval '24 hours'
     group by e.barraca_id
  ),
  base as (
    select
      b.id as barraca_id,
      b.nome,
      b.slug,
      u.email::text as email_dono,
      ub.usuario_id,
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
          and e.error is null) as ultimo_pagamento_em,
      coalesce(a.bloqueada_admin, false) as bloqueada,
      a.bloqueio_motivo,
      a.origem_plano,
      b.arquivada_em,
      coalesce(pa.p7, 0) as pedidos_7d,
      coalesce(pa.p_ant, 0) as pedidos_semana_anterior,
      coalesce(ea.n, 0) as erros_24h,
      v.versao_app,
      v.plataforma,
      pa.ultimo as ultimo_pedido_em
    from public.barracas b
    join public.usuarios_barracas ub on ub.barraca_id = b.id and ub.papel = 'dono'
    join auth.users u on u.id = ub.usuario_id
    left join public.assinaturas a on a.usuario_id = ub.usuario_id
    left join pedidos_agg pa on pa.bid = b.id
    left join erros_agg ea on ea.bid = b.id
    left join public.barracas_versao_app v on v.barraca_id = b.id
  ),
  filtrada as (
    select base.*
      from base
     where (p_plano is null or base.plano = p_plano)
       and (coalesce(p_filtro = 'arquivada', false) = (base.arquivada_em is not null))
       and (v_busca is null
         or strpos(lower(base.nome), v_busca) > 0
         or strpos(lower(base.slug), v_busca) > 0
         or strpos(lower(base.email_dono), v_busca) > 0)
       and (p_filtro is null or p_filtro = 'arquivada'
         or (p_filtro = 'vence_7d'
             and base.vencimento_em between now() and now() + interval '7 days')
         or (p_filtro = 'trial_acabando'
             and base.estado = 'trial'
             and base.vencimento_em <= now() + interval '7 days')
         or (p_filtro = 'vencida' and base.estado = 'vencida')
         or (p_filtro = 'bloqueada' and base.bloqueada)
         or (p_filtro = 'legado' and base.origem_plano = 'legado'))
  )
  select
    f.barraca_id, f.nome, f.slug, f.email_dono, f.plano, f.estado, f.tem_acesso,
    f.inicio_em, f.vencimento_em,
    case when f.vencimento_em is null then null
         else ceil(extract(epoch from (f.vencimento_em - now())) / 86400)::integer end,
    f.origem_cobranca, f.ultimo_pagamento_em,
    count(*) over (),
    f.usuario_id, f.bloqueada, f.bloqueio_motivo, f.origem_plano, f.arquivada_em,
    f.pedidos_7d, f.pedidos_semana_anterior, f.erros_24h, f.versao_app, f.plataforma
  from filtrada f
  order by
    case when v_ordem = 'nome' then f.nome end asc,
    case when v_ordem = 'nova' then f.inicio_em end desc nulls last,
    case when v_ordem = 'atividade' then f.ultimo_pedido_em end desc nulls last,
    case when v_ordem = 'vencimento' then f.vencimento_em end asc nulls last,
    f.nome, f.barraca_id
  limit greatest(1, least(coalesce(p_limite, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_listar_barracas(text, text, integer, integer, text, text) from public, anon;
grant execute on function public.admin_listar_barracas(text, text, integer, integer, text, text) to authenticated;

-- Contagem por filtro, sempre igual ao `total` da lista: usa a própria `admin_listar_barracas`.
-- shortcut: 7 chamadas da lista (cada uma agrega pedidos); trocar por uma consulta só se o painel ficar lento.
create function public.admin_contar_filtros()
returns table (filtro text, total bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  return query
  select f.nome_filtro,
         coalesce((select l.total from public.admin_listar_barracas(f.valor, null, 1, 0) l limit 1), 0)::bigint
    from (values (1, 'todas', null::text), (2, 'vence_7d', 'vence_7d'), (3, 'trial_acabando', 'trial_acabando'),
                 (4, 'vencida', 'vencida'), (5, 'bloqueada', 'bloqueada'), (6, 'legado', 'legado'),
                 (7, 'arquivada', 'arquivada')) as f(ordem, nome_filtro, valor)
   order by f.ordem;
end;
$$;

revoke all on function public.admin_contar_filtros() from public, anon;
grant execute on function public.admin_contar_filtros() to authenticated;

-- ROLLBACK (rodar manualmente, nesta ordem; recria a versão de 20261028100000):
-- drop function if exists public.admin_contar_filtros();
-- drop function if exists public.admin_listar_barracas(text, text, integer, integer, text, text);
-- create or replace function public.admin_listar_barracas(
--   p_filtro text default null, p_plano text default null, p_limite integer default 50, p_offset integer default 0
-- )
-- returns table (
--   barraca_id uuid, nome text, slug text, email_dono text, plano text, estado text, tem_acesso boolean,
--   inicio_em timestamptz, vencimento_em timestamptz, dias_restantes integer, origem_cobranca text,
--   ultimo_pagamento_em timestamptz, total bigint
-- )
-- language plpgsql stable security definer set search_path = public, pg_temp
-- as $fn$
-- begin
--   if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
--     raise exception 'acesso negado' using errcode = '42501';
--   end if;
--   if p_filtro is not null and p_filtro not in ('vence_7d', 'trial_acabando', 'vencida') then
--     raise exception 'filtro invalido' using errcode = '22023';
--   end if;
--   if p_plano is not null and p_plano not in ('essencial', 'pro') then
--     raise exception 'plano invalido' using errcode = '22023';
--   end if;
--   return query
--   with base as (
--     select b.id as barraca_id, b.nome, b.slug, u.email::text as email_dono, a.plan as plano,
--       case
--         when a.usuario_id is null then 'vencida'
--         when a.status = 'trialing' and a.trial_ends_at is not null and now() < a.trial_ends_at then 'trial'
--         when a.status = 'active' then 'ativa'
--         when a.status = 'canceled' then 'cancelada'
--         else 'vencida'
--       end as estado,
--       case when a.usuario_id is null then false else public.assinatura_tem_acesso(a) end as tem_acesso,
--       coalesce(b.criada_em, a.updated_at) as inicio_em,
--       case a.status
--         when 'trialing' then a.trial_ends_at
--         when 'past_due' then coalesce(a.grace_until, a.current_period_end)
--         else a.current_period_end
--       end as vencimento_em,
--       case when a.stripe_subscription_id is not null then 'stripe' end as origem_cobranca,
--       (select max(e.received_at) from public.eventos_webhook_stripe e
--         where e.subscription_id = a.stripe_subscription_id and e.event = 'invoice.paid' and e.error is null) as ultimo_pagamento_em
--     from public.barracas b
--     join public.usuarios_barracas ub on ub.barraca_id = b.id and ub.papel = 'dono'
--     join auth.users u on u.id = ub.usuario_id
--     left join public.assinaturas a on a.usuario_id = ub.usuario_id
--   ),
--   filtrada as (
--     select base.* from base
--      where (p_plano is null or base.plano = p_plano)
--        and (p_filtro is null
--          or (p_filtro = 'vence_7d' and base.vencimento_em between now() and now() + interval '7 days')
--          or (p_filtro = 'trial_acabando' and base.estado = 'trial' and base.vencimento_em <= now() + interval '7 days')
--          or (p_filtro = 'vencida' and base.estado = 'vencida'))
--   )
--   select f.barraca_id, f.nome, f.slug, f.email_dono, f.plano, f.estado, f.tem_acesso, f.inicio_em, f.vencimento_em,
--     case when f.vencimento_em is null then null
--          else ceil(extract(epoch from (f.vencimento_em - now())) / 86400)::integer end,
--     f.origem_cobranca, f.ultimo_pagamento_em, count(*) over ()
--   from filtrada f
--   order by f.vencimento_em asc nulls last, f.nome
--   limit greatest(1, least(coalesce(p_limite, 50), 200))
--   offset greatest(0, coalesce(p_offset, 0));
-- end;
-- $fn$;
-- revoke all on function public.admin_listar_barracas(text, text, integer, integer) from public, anon;
-- grant execute on function public.admin_listar_barracas(text, text, integer, integer) to authenticated;
