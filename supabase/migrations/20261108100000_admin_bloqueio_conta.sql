-- Painel do superadmin: bloquear e desbloquear conta, com log de ações administrativas.
-- Aditiva e reversível (rollback comentado no fim).
--
-- O bloqueio mora em coluna própria (`bloqueada_admin`) porque webhook do Stripe, cron de
-- expiração e avisos de trial reescrevem `status` e prazos: nenhum deles toca nesta coluna.
-- `assinatura_tem_acesso` passa a devolver false para conta bloqueada, e como
-- `barraca_assinatura_ativa` usa essa função, funcionários do dono bloqueado também perdem acesso
-- (inclusive nas policies de RLS que usam `barraca_assinatura_ativa`).
-- LIMITE: com a cobrança desligada (estado global neutro; em produção está LIGADA),
-- `barraca_assinatura_ativa` devolve true antes de consultar `assinatura_tem_acesso`, então o
-- bloqueio só alcança `assinatura_tem_acesso` e o portão do app (`assinatura_da_barraca`), não o RLS.

alter table public.assinaturas
  add column if not exists bloqueada_admin boolean not null default false,
  add column if not exists bloqueio_motivo text,
  add column if not exists bloqueada_em timestamptz;

-- Log: RLS ligada e sem policy; só as funções SECURITY DEFINER leem e escrevem.
create table if not exists public.admin_acoes_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid, -- nulo = ação do sistema (ex.: apagamento definitivo pelo job diário)
  acao text not null,
  alvo_tipo text not null,
  alvo_id uuid,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
alter table public.admin_acoes_log enable row level security;
revoke all on table public.admin_acoes_log from public, anon, authenticated;
create index if not exists admin_acoes_log_criado_em_idx on public.admin_acoes_log (criado_em desc);

-- Interna: chamada pelas funções de admin; nenhum papel de API executa direto.
create or replace function public.admin_registrar_acao(
  p_acao text, p_alvo_tipo text, p_alvo_id uuid, p_detalhes jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.admin_acoes_log (admin_id, acao, alvo_tipo, alvo_id, detalhes)
  values (auth.uid(), p_acao, p_alvo_tipo, p_alvo_id, coalesce(p_detalhes, '{}'::jsonb));
$$;
revoke all on function public.admin_registrar_acao(text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.admin_bloquear_conta(p_usuario_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ja boolean;
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select a.bloqueada_admin into v_ja from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;
  if v_ja then
    return; -- já bloqueada: sem erro e sem log duplicado
  end if;

  update public.assinaturas
     set bloqueada_admin = true, bloqueio_motivo = v_motivo, bloqueada_em = now()
   where usuario_id = p_usuario_id;
  perform public.admin_registrar_acao('bloquear_conta', 'usuario', p_usuario_id, jsonb_build_object('motivo', v_motivo));
end;
$$;

create or replace function public.admin_desbloquear_conta(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ja boolean;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select a.bloqueada_admin into v_ja from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;
  if not v_ja then
    return; -- não estava bloqueada: sem erro e sem log
  end if;

  update public.assinaturas
     set bloqueada_admin = false, bloqueio_motivo = null, bloqueada_em = null
   where usuario_id = p_usuario_id;
  perform public.admin_registrar_acao('desbloquear_conta', 'usuario', p_usuario_id, '{}'::jsonb);
end;
$$;

create or replace function public.admin_listar_acoes(p_limite integer default 50, p_offset integer default 0)
returns table (
  id uuid, admin_email text, acao text, alvo_tipo text, alvo_id uuid, detalhes jsonb, criado_em timestamptz
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
  return query
  select l.id, u.email::text, l.acao, l.alvo_tipo, l.alvo_id, l.detalhes, l.criado_em
    from public.admin_acoes_log l
    left join auth.users u on u.id = l.admin_id
   order by l.criado_em desc, l.id
   limit greatest(1, least(coalesce(p_limite, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_bloquear_conta(uuid, text) from public, anon;
revoke all on function public.admin_desbloquear_conta(uuid) from public, anon;
revoke all on function public.admin_listar_acoes(integer, integer) from public, anon;
grant execute on function public.admin_bloquear_conta(uuid, text) to authenticated;
grant execute on function public.admin_desbloquear_conta(uuid) to authenticated;
grant execute on function public.admin_listar_acoes(integer, integer) to authenticated;

-- Acesso: conta bloqueada nunca tem acesso, nem com a cobrança desligada. Resto igual ao anterior
-- (corpo vigente de 20261013100000_cobranca_flag.sql).
create or replace function public.assinatura_tem_acesso(
  p_assinatura public.assinaturas,
  p_now timestamptz default now()
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not coalesce(p_assinatura.bloqueada_admin, false) and (
    not public.cobranca_ativa() or case p_assinatura.status
      when 'trialing' then p_assinatura.trial_ends_at is not null and p_now < p_assinatura.trial_ends_at
      when 'active'   then true
      when 'past_due' then p_assinatura.grace_until is not null and p_now < p_assinatura.grace_until
      when 'canceled' then p_assinatura.current_period_end is not null and p_now < p_assinatura.current_period_end
      else false
    end
  );
$$;

-- assinatura_da_barraca ganha `bloqueada` (nova assinatura de retorno: drop + create).
drop function if exists public.assinatura_da_barraca(text);

create or replace function public.assinatura_da_barraca(p_slug text)
returns table (
  status text, plano text, ciclo text, tem_acesso boolean, dias_restantes_trial integer,
  trial_ends_at timestamptz, current_period_end timestamptz, eh_dono boolean, cobranca_ativa boolean,
  bloqueada boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_barraca_id uuid;
  v_dono_id uuid;
  v_assinatura public.assinaturas;
  v_cobranca boolean := public.cobranca_ativa();
begin
  select id into v_barraca_id from public.barracas where slug = p_slug;
  if v_barraca_id is null then
    raise exception 'Barraca não encontrada';
  end if;

  if not public.usuario_tem_acesso_barraca(v_barraca_id) then
    raise exception 'Sem acesso a esta barraca';
  end if;

  select ub.usuario_id into v_dono_id
    from public.usuarios_barracas ub
   where ub.barraca_id = v_barraca_id and ub.papel = 'dono'
   limit 1;

  if v_dono_id is null then
    return query select 'active'::text, 'pro'::text, null::text, true, null::integer,
      null::timestamptz, null::timestamptz, false, v_cobranca, false;
    return;
  end if;

  select * into v_assinatura from public.assinaturas where usuario_id = v_dono_id;

  if not v_cobranca then
    return query select 'active'::text, 'pro'::text, null::text,
      not coalesce(v_assinatura.bloqueada_admin, false), null::integer,
      null::timestamptz, null::timestamptz, (v_dono_id = auth.uid()), false,
      coalesce(v_assinatura.bloqueada_admin, false);
    return;
  end if;

  return query select
    v_assinatura.status,
    v_assinatura.plan,
    v_assinatura.cycle,
    public.assinatura_tem_acesso(v_assinatura, now()),
    case
      when v_assinatura.status = 'trialing' and v_assinatura.trial_ends_at is not null
        then greatest(0, ceil(extract(epoch from (v_assinatura.trial_ends_at - now())) / 86400))::integer
      else null
    end,
    v_assinatura.trial_ends_at,
    v_assinatura.current_period_end,
    (v_dono_id = auth.uid()),
    true,
    coalesce(v_assinatura.bloqueada_admin, false);
end;
$$;

revoke all on function public.assinatura_da_barraca(text) from public, anon;
grant execute on function public.assinatura_da_barraca(text) to authenticated;

-- ROLLBACK (rodar manualmente, nesta ordem):
-- drop function if exists public.assinatura_da_barraca(text);
-- create or replace function public.assinatura_da_barraca(p_slug text)
--   returns table (status text, plano text, ciclo text, tem_acesso boolean, dias_restantes_trial integer,
--     trial_ends_at timestamptz, current_period_end timestamptz, eh_dono boolean, cobranca_ativa boolean)
--   language plpgsql stable security definer set search_path = public as $$
--   declare v_barraca_id uuid; v_dono_id uuid; v_assinatura public.assinaturas; v_cobranca boolean := public.cobranca_ativa();
--   begin
--     select id into v_barraca_id from public.barracas where slug = p_slug;
--     if v_barraca_id is null then raise exception 'Barraca não encontrada'; end if;
--     if not public.usuario_tem_acesso_barraca(v_barraca_id) then raise exception 'Sem acesso a esta barraca'; end if;
--     select ub.usuario_id into v_dono_id from public.usuarios_barracas ub
--      where ub.barraca_id = v_barraca_id and ub.papel = 'dono' limit 1;
--     if v_dono_id is null then
--       return query select 'active'::text, 'pro'::text, null::text, true, null::integer, null::timestamptz, null::timestamptz, false, v_cobranca;
--       return;
--     end if;
--     if not v_cobranca then
--       return query select 'active'::text, 'pro'::text, null::text, true, null::integer, null::timestamptz, null::timestamptz, (v_dono_id = auth.uid()), false;
--       return;
--     end if;
--     select * into v_assinatura from public.assinaturas where usuario_id = v_dono_id;
--     return query select v_assinatura.status, v_assinatura.plan, v_assinatura.cycle,
--       public.assinatura_tem_acesso(v_assinatura, now()),
--       case when v_assinatura.status = 'trialing' and v_assinatura.trial_ends_at is not null
--         then greatest(0, ceil(extract(epoch from (v_assinatura.trial_ends_at - now())) / 86400))::integer else null end,
--       v_assinatura.trial_ends_at, v_assinatura.current_period_end, (v_dono_id = auth.uid()), true;
--   end; $$;
-- revoke all on function public.assinatura_da_barraca(text) from public, anon;
-- grant execute on function public.assinatura_da_barraca(text) to authenticated;
-- create or replace function public.assinatura_tem_acesso(p_assinatura public.assinaturas, p_now timestamptz default now())
--   returns boolean language sql stable set search_path = public, pg_temp as $$
--   select not public.cobranca_ativa() or case p_assinatura.status
--     when 'trialing' then p_assinatura.trial_ends_at is not null and p_now < p_assinatura.trial_ends_at
--     when 'active'   then true
--     when 'past_due' then p_assinatura.grace_until is not null and p_now < p_assinatura.grace_until
--     when 'canceled' then p_assinatura.current_period_end is not null and p_now < p_assinatura.current_period_end
--     else false end; $$;
-- drop function if exists public.admin_listar_acoes(integer, integer);
-- drop function if exists public.admin_desbloquear_conta(uuid);
-- drop function if exists public.admin_bloquear_conta(uuid, text);
-- drop function if exists public.admin_registrar_acao(text, text, uuid, jsonb);
-- drop table if exists public.admin_acoes_log;
-- alter table public.assinaturas drop column if exists bloqueada_em, drop column if exists bloqueio_motivo, drop column if exists bloqueada_admin;
