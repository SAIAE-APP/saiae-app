-- Os 30 dias grátis liberam o plano ESSENCIAL (decisão do João, 2026-10-11), não o Pro. Antes o trial nascia com
-- plan = 'pro' (20261001120000), o que dava ao teste recursos que o plano Essencial não tem (várias barracas,
-- histórico completo, exportar) e contrariava o que o site e a vendedora prometem.
--
-- Só muda quem SE CADASTRA daqui para frente. Contas que já estão em trial ou ativas não são tocadas (quem já
-- começou o teste com o Pro termina os 30 dias como está). Rollback: voltar 'essencial' para 'pro' abaixo.

create or replace function public.criar_assinatura_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_lower text := lower(new.email);
  v_ja_teve_trial boolean;
begin
  select exists(
    select 1 from public.contas_trial_usadas where email_lower = v_email_lower
  ) into v_ja_teve_trial;

  if v_ja_teve_trial then
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at)
    values (new.id, 'expired', 'pro', now())
    on conflict (usuario_id) do nothing;
  else
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at)
    values (new.id, 'trialing', 'essencial', now() + interval '30 days')
    on conflict (usuario_id) do nothing;

    insert into public.contas_trial_usadas (email_lower)
    values (v_email_lower)
    on conflict (email_lower) do nothing;
  end if;

  return new;
end;
$$;
