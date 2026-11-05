-- Painel do superadmin: trocar plano, estender vencimento e marcar a origem do plano.
-- Aditiva e reversível (rollback comentado no fim).
--
-- origem_plano: 'legado' (pro dado antes da cobrança, sem pagamento), 'trial' ou 'pago'.
-- Mantida por trigger (BEFORE INSERT OR UPDATE) para não mexer em criar_assinatura_trial nem no
-- webhook-stripe: INSERT trialing => 'trial'; stripe_subscription_id passando a não nulo => 'pago';
-- demais escritas deixam como está.
--
-- Regra do backfill (conferida em produção, somente leitura, 2026-11-05; `assinaturas` NÃO tem
-- created_at, então a data de criação da conta vem de auth.users.created_at):
--   stripe_subscription_id não nulo                         => pago
--   plan = 'pro', conta criada antes de 2026-10-22, sem stripe => legado
--   demais                                                  => trial
-- Contagem observada (8 assinaturas): pago 1 (essencial expired com stripe);
--   legado 4 (pro active x2, pro expired x1, pro trialing x1); trial 3 (essencial: expired x1,
--   trialing x2). Obs.: o pro "trialing" antigo também cai em legado pela regra; se for trial
--   real, o admin corrige depois ou o trigger o move para 'pago' ao assinar.

alter table public.assinaturas
  add column if not exists origem_plano text not null default 'trial'
  check (origem_plano in ('legado', 'trial', 'pago'));

-- Backfill antes do trigger existir (assim o trigger não interfere).
update public.assinaturas a
   set origem_plano = case
     when a.stripe_subscription_id is not null then 'pago'
     when a.plan = 'pro'
          and exists (select 1 from auth.users u where u.id = a.usuario_id and u.created_at < timestamptz '2026-10-22')
       then 'legado'
     else 'trial'
   end;

create or replace function public.assinaturas_definir_origem_plano()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.stripe_subscription_id is not null
     and (tg_op = 'INSERT' or old.stripe_subscription_id is distinct from new.stripe_subscription_id) then
    new.origem_plano := 'pago';
  elsif tg_op = 'INSERT' and new.status = 'trialing' then
    new.origem_plano := 'trial';
  end if;
  return new;
end;
$$;

drop trigger if exists assinaturas_origem_plano on public.assinaturas;
create trigger assinaturas_origem_plano
  before insert or update on public.assinaturas
  for each row execute function public.assinaturas_definir_origem_plano();

create or replace function public.admin_definir_plano(p_usuario_id uuid, p_plano text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anterior text;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_plano is null or p_plano not in ('essencial', 'pro') then
    raise exception 'plano inválido' using errcode = '22023';
  end if;

  select a.plan into v_anterior from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;
  if v_anterior is not distinct from p_plano then
    return; -- mesmo plano: sem erro e sem log duplicado
  end if;

  update public.assinaturas set plan = p_plano, updated_at = now() where usuario_id = p_usuario_id;
  perform public.admin_registrar_acao('definir_plano', 'usuario', p_usuario_id,
    jsonb_build_object('plano', p_plano, 'plano_anterior', v_anterior));
end;
$$;

create or replace function public.admin_estender_vencimento(p_usuario_id uuid, p_dias integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_trial timestamptz;
  v_periodo timestamptz;
  v_antes timestamptz;
  v_depois timestamptz;
  v_campo text;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    raise exception 'dias deve ficar entre 1 e 365' using errcode = '22023';
  end if;

  select a.status, a.trial_ends_at, a.current_period_end into v_status, v_trial, v_periodo
    from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;

  v_campo := case when v_status = 'trialing' then 'trial_ends_at' else 'current_period_end' end;
  v_antes := case when v_status = 'trialing' then v_trial else v_periodo end;
  if v_antes is null then
    raise exception 'conta sem vencimento para estender' using errcode = '22023';
  end if;
  v_depois := v_antes + make_interval(days => p_dias);

  if v_campo = 'trial_ends_at' then
    update public.assinaturas set trial_ends_at = v_depois, updated_at = now() where usuario_id = p_usuario_id;
  else
    update public.assinaturas set current_period_end = v_depois, updated_at = now() where usuario_id = p_usuario_id;
  end if;
  perform public.admin_registrar_acao('estender_vencimento', 'usuario', p_usuario_id,
    jsonb_build_object('dias', p_dias, 'campo', v_campo, 'vencimento_anterior', v_antes, 'vencimento_novo', v_depois));
end;
$$;

revoke all on function public.admin_definir_plano(uuid, text) from public, anon;
revoke all on function public.admin_estender_vencimento(uuid, integer) from public, anon;
grant execute on function public.admin_definir_plano(uuid, text) to authenticated;
grant execute on function public.admin_estender_vencimento(uuid, integer) to authenticated;

-- ROLLBACK (rodar manualmente):
-- drop function if exists public.admin_estender_vencimento(uuid, integer);
-- drop function if exists public.admin_definir_plano(uuid, text);
-- drop trigger if exists assinaturas_origem_plano on public.assinaturas;
-- drop function if exists public.assinaturas_definir_origem_plano();
-- alter table public.assinaturas drop column if exists origem_plano;
