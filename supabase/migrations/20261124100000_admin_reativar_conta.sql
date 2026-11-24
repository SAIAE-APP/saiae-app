-- Painel do superadmin: reativar conta vencida por N meses (pagamento fora do Stripe, ex.: Pix).
-- Aditiva e reversível (rollback comentado no fim).
--
-- Põe a assinatura em 'active' com current_period_end = (hoje, ou o fim do período se ainda estiver ativa) + N meses.
-- O job expirar_assinaturas_job só rebaixa 'active' sem Stripe 2 dias depois de current_period_end.
-- Recusa conta com assinatura Stripe: lá o estado vem dos webhooks e uma reativação manual seria sobrescrita.
-- Não mexe em bloqueada_admin: conta bloqueada continua bloqueada até "Desbloquear".

create or replace function public.admin_reativar_conta(p_usuario_id uuid, p_meses integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_stripe text;
  v_periodo timestamptz;
  v_base timestamptz;
  v_depois timestamptz;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_meses is null or p_meses < 1 or p_meses > 36 then
    raise exception 'meses deve ficar entre 1 e 36' using errcode = '22023';
  end if;

  select a.status, a.stripe_subscription_id, a.current_period_end into v_status, v_stripe, v_periodo
    from public.assinaturas a where a.usuario_id = p_usuario_id for update;
  if not found then
    raise exception 'conta sem assinatura' using errcode = '22023';
  end if;
  if v_stripe is not null then
    raise exception 'conta com cobrança no stripe' using errcode = '22023';
  end if;

  v_base := case when v_status = 'active' and v_periodo is not null and v_periodo > now() then v_periodo else now() end;
  v_depois := v_base + make_interval(months => p_meses);

  update public.assinaturas
     set status = 'active', current_period_end = v_depois, grace_until = null,
         origem_plano = 'pago', updated_at = now()
   where usuario_id = p_usuario_id;
  perform public.admin_registrar_acao('reativar_conta', 'usuario', p_usuario_id,
    jsonb_build_object('meses', p_meses, 'status_anterior', v_status, 'vencimento_anterior', v_periodo, 'vencimento_novo', v_depois));
end;
$$;

revoke all on function public.admin_reativar_conta(uuid, integer) from public, anon;
grant execute on function public.admin_reativar_conta(uuid, integer) to authenticated;

-- ROLLBACK (rodar manualmente):
-- drop function if exists public.admin_reativar_conta(uuid, integer);
