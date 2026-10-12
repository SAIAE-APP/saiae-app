-- expirar_assinaturas_job: (1) só rebaixa active -> past_due assinatura FORA da Stripe; (2) fecha o acesso pela API.
--
-- (1) Para assinatura Stripe o estado vem dos webhooks (invoice.payment_failed -> past_due, subscription.deleted ->
--     canceled). A regra por data (current_period_end < now() - 2 dias) rebaixava quem JÁ PAGOU sempre que um
--     invoice.paid se perdia ou atrasava. Fica só para o legado (Kirvano), que não tem webhook de falha equivalente.
-- (2) A função era SECURITY DEFINER sem REVOKE: qualquer `anon` chamava /rest/v1/rpc/expirar_assinaturas_job.
--     Só o pg_cron (dono do job) precisa executá-la.
--
-- Reexecutável (create or replace + revoke). NÃO muda app_config.cobranca_ativa.

create or replace function public.expirar_assinaturas_job()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.assinaturas
     set status = 'expired', updated_at = now()
   where (status = 'trialing' and trial_ends_at < now())
      or (status = 'past_due' and grace_until < now())
      or (status = 'canceled' and current_period_end < now());

  update public.assinaturas
     set status = 'past_due', grace_until = now() + interval '3 days', updated_at = now()
   where status = 'active'
     and stripe_subscription_id is null
     and current_period_end is not null
     and current_period_end < now() - interval '2 days';
$$;

revoke all on function public.expirar_assinaturas_job() from public, anon, authenticated;
