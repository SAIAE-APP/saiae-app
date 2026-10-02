-- Trial grátis de 7 → 30 dias (sem cartão, mesma mecânica: trigger em
-- auth.users, 1 trial por e-mail). Decisão do dono do produto, 2026-10-01.

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
    values (new.id, 'trialing', 'pro', now() + interval '30 days')
    on conflict (usuario_id) do nothing;

    insert into public.contas_trial_usadas (email_lower)
    values (v_email_lower)
    on conflict (email_lower) do nothing;
  end if;

  return new;
end;
$$;

-- Estende quem ainda está no trial de 7 dias (+23 dias, totalizando 30
-- desde o cadastro). Só trials em andamento; expirados não são tocados.
update public.assinaturas
set trial_ends_at = trial_ends_at + interval '23 days',
    updated_at = now()
where status = 'trialing'
  and trial_ends_at > now();
