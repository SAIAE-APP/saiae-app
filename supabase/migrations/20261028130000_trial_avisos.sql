-- Painel do dono do sistema, funcionalidade 5: ciclo de vida do trial
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva. O bloqueio no fim do trial já existe
-- (`assinatura_tem_acesso`); aqui entram só os avisos, de forma idempotente.
--
-- `trial_avisos_enviados` guarda (usuário, etapa): cada aviso sai uma vez só, mesmo que o agendador
-- rode várias vezes ou duas rodadas se sobreponham. Quem envia é a edge function `trial-avisos`
-- (chave de serviço); `trial_avisos_pendentes()` só diz quem precisa de qual aviso agora.
--
-- Etapas (dias contados a partir do cadastro, `auth.users.created_at`, e do fim do trial):
--   sem_pedido_48h (dono)    : 2 a 7 dias de cadastro, trial ativo, nenhum pedido ainda
--   sem_pedido_7d  (suporte) : 7+ dias de cadastro, trial ativo, nenhum pedido ainda
--   faltam_7       (dono)    : trial acaba em 7 dias ou menos (e mais de 2)
--   faltam_2       (dono)    : trial acaba em 2 dias ou menos
--   fim            (dono)    : trial acabou há menos de 1 dia (acesso bloqueado)
--   retorno        (dono)    : trial acabou entre 1 e 14 dias atrás (dados preservados)
-- Só quem ainda não tem assinatura na Stripe e com a cobrança ligada (`cobranca_ativa()`).
-- Os dados da conta seguem preservados sem prazo de exclusão: não existe rotina que apague barraca
-- de trial vencido, e esta migration não cria uma.

create table if not exists public.trial_avisos_enviados (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  etapa text not null check (etapa in ('sem_pedido_48h', 'sem_pedido_7d', 'faltam_7', 'faltam_2', 'fim', 'retorno')),
  enviado_em timestamptz not null default now(),
  primary key (usuario_id, etapa)
);
alter table public.trial_avisos_enviados enable row level security;
revoke all on table public.trial_avisos_enviados from public, anon, authenticated;

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
