-- Trial grátis de 30 → 3 dias corridos (decisão do João, 2026-10-24): o teste dura 72 horas a partir do cadastro,
-- contando sábado, domingo e feriado (a maioria dos clientes é de barraca de feira e usa justamente nesses dias).
-- Mesma mecânica: trigger no cadastro, plano ESSENCIAL, 1 trial por e-mail, sem cartão.
--
-- Só muda quem SE CADASTRA daqui para frente. Quem já está em trial mantém o `trial_ends_at` que tem.
-- Rollback: voltar interval '3 days' para '30 days' em criar_assinatura_trial e remover a condição de
-- duração em faltam_7 (versão de 20261028130000).
--
-- Efeito colateral tratado aqui: o aviso `faltam_7` (trial acaba em 7 dias ou menos e mais de 2) passaria a
-- sair NA HORA do cadastro de um trial de 3 dias. Agora ele só vale para trial com mais de 7 dias de duração
-- total (os de 30 dias que já estão rodando). `sem_pedido_7d` e `retorno` seguem iguais; num trial de 3 dias o
-- primeiro nunca dispara, e `faltam_2` cobre o último dia.

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
    values (new.id, 'trialing', 'essencial', now() + interval '3 days')
    on conflict (usuario_id) do nothing;

    insert into public.contas_trial_usadas (email_lower)
    values (v_email_lower)
    on conflict (email_lower) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.trial_avisos_pendentes()
returns table (
  usuario_id uuid,
  email text,
  barraca_nome text,
  barraca_slug text,
  etapa text,
  destino text,
  dias_restantes integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      a.usuario_id,
      u.email::text as email,
      u.created_at as inicio,
      a.trial_ends_at as fim,
      a.status,
      (select b.nome from public.usuarios_barracas ub join public.barracas b on b.id = ub.barraca_id
        where ub.usuario_id = a.usuario_id and ub.papel = 'dono' order by b.criada_em limit 1) as nome,
      (select b.slug from public.usuarios_barracas ub join public.barracas b on b.id = ub.barraca_id
        where ub.usuario_id = a.usuario_id and ub.papel = 'dono' order by b.criada_em limit 1) as slug,
      exists (select 1 from public.usuarios_barracas ub join public.pedidos p on p.barraca_id = ub.barraca_id
               where ub.usuario_id = a.usuario_id and ub.papel = 'dono' and p.cancelado_em is null) as teve_pedido
    from public.assinaturas a
    join auth.users u on u.id = a.usuario_id
    where public.cobranca_ativa()
      and a.stripe_subscription_id is null
      and a.status in ('trialing', 'expired')
      and a.trial_ends_at is not null
  ),
  candidatos as (
    select b.*, 'sem_pedido_48h'::text as etapa, 'dono'::text as destino from base b
     where b.status = 'trialing' and b.fim > now() and not b.teve_pedido
       and now() >= b.inicio + interval '2 days' and now() < b.inicio + interval '7 days'
    union all
    select b.*, 'sem_pedido_7d', 'suporte' from base b
     where b.status = 'trialing' and b.fim > now() and not b.teve_pedido
       and now() >= b.inicio + interval '7 days'
    union all
    select b.*, 'faltam_7', 'dono' from base b
     where b.status = 'trialing' and b.fim > now() + interval '2 days' and b.fim <= now() + interval '7 days'
       and b.fim - b.inicio > interval '7 days'
    union all
    select b.*, 'faltam_2', 'dono' from base b
     where b.status = 'trialing' and b.fim > now() and b.fim <= now() + interval '2 days'
    union all
    select b.*, 'fim', 'dono' from base b
     where b.fim <= now() and b.fim > now() - interval '1 day'
    union all
    select b.*, 'retorno', 'dono' from base b
     where b.fim <= now() - interval '1 day' and b.fim > now() - interval '14 days'
  )
  select c.usuario_id, c.email, c.nome, c.slug, c.etapa, c.destino,
         ceil(extract(epoch from (c.fim - now())) / 86400)::integer
    from candidatos c
   where c.slug is not null
     and not exists (select 1 from public.trial_avisos_enviados e where e.usuario_id = c.usuario_id and e.etapa = c.etapa)
   order by c.fim, c.usuario_id;
$$;

revoke all on function public.trial_avisos_pendentes() from public, anon, authenticated;
grant execute on function public.trial_avisos_pendentes() to service_role;
