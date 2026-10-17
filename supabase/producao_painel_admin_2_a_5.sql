
-- ======================================================================
-- 20261028110000_admin_resumo_ativas.sql
-- ======================================================================

-- Painel do dono do sistema, funcionalidade 2: barracas ativas agora e cartões de resumo
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva: só um índice e uma função nova.
-- Devolve contagens e nomes de barraca; nenhum dado de cliente final sai daqui.
--
-- "Ativa agora" = ao menos um pedido não cancelado criado nas últimas `p_janela_horas` horas
-- (parâmetro, padrão 2). "Vendia e parou" = pedidos em pelo menos 5 dos 7 dias que vão de 9 a 3
-- dias atrás (contando hoje como dia 0) e nenhum pedido nos últimos 3 dias (hoje e os 2 anteriores).
--
-- shortcut: "hoje" e "dia" usam America/Sao_Paulo para todas as barracas; usar `barracas.fuso`
-- por barraca quando houver cliente fora desse fuso.

-- Os índices atuais de `pedidos` começam por barraca_id; o painel olha todas as barracas por
-- janela de tempo, então precisa de um por criado_em.
create index if not exists pedidos_criado_em_idx on public.pedidos (criado_em desc);

create or replace function public.admin_resumo_ativas(p_janela_horas integer default 2)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_fuso constant text := 'America/Sao_Paulo';
  c_dias_vendia constant integer := 5;
  v_janela integer := greatest(1, least(coalesce(p_janela_horas, 2), 72));
  v_hoje date := (now() at time zone c_fuso)::date;
  v_inicio_hoje timestamptz := (v_hoje::timestamp at time zone c_fuso);
  v_resultado jsonb;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'janela_horas', v_janela,
    'ativas_agora', (
      select count(distinct p.barraca_id)
        from public.pedidos p
       where p.criado_em >= now() - make_interval(hours => v_janela)
         and p.cancelado_em is null),
    'pedidos_hoje', (
      select count(*)
        from public.pedidos p
       where p.criado_em >= v_inicio_hoje and p.cancelado_em is null),
    'pedidos_hoje_por_barraca', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'barraca_id', t.id, 'nome', t.nome, 'slug', t.slug, 'pedidos', t.n
             ) order by t.n desc, t.nome), '[]'::jsonb)
        from (select b.id, b.nome, b.slug, count(*) as n
                from public.pedidos p
                join public.barracas b on b.id = p.barraca_id
               where p.criado_em >= v_inicio_hoje and p.cancelado_em is null
               group by b.id, b.nome, b.slug
               order by n desc, b.nome
               limit 10) t),
    'barracas_novas_7d', (
      select count(*) from public.barracas b where b.criada_em >= now() - interval '7 days'),
    'trials_acabando_7d', (
      select count(*)
        from public.assinaturas a
       where a.status = 'trialing'
         and a.trial_ends_at between now() and now() + interval '7 days'),
    'pararam', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'barraca_id', t.id, 'nome', t.nome, 'slug', t.slug, 'ultimo_pedido_em', t.ultimo
             ) order by t.ultimo desc, t.nome), '[]'::jsonb)
        from (select b.id, b.nome, b.slug, max(p.criado_em) as ultimo
                from public.barracas b
                join public.pedidos p on p.barraca_id = b.id and p.cancelado_em is null
               where p.criado_em >= ((v_hoje - 9)::timestamp at time zone c_fuso)
               group by b.id, b.nome, b.slug
              having count(distinct (p.criado_em at time zone c_fuso)::date) filter (
                       where (p.criado_em at time zone c_fuso)::date <= v_hoje - 3) >= c_dias_vendia
                 and count(*) filter (
                       where (p.criado_em at time zone c_fuso)::date >= v_hoje - 2) = 0
               order by ultimo desc, b.nome
               limit 50) t),
    'pedidos_por_dia', (
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'pedidos', coalesce(c.n, 0)) order by d.dia)
        from generate_series(v_hoje - 13, v_hoje, interval '1 day') as g(dia_ts)
        cross join lateral (select g.dia_ts::date as dia) d
        left join (select (p.criado_em at time zone c_fuso)::date as dia, count(*) as n
                     from public.pedidos p
                    where p.criado_em >= ((v_hoje - 13)::timestamp at time zone c_fuso)
                      and p.cancelado_em is null
                    group by 1) c on c.dia = d.dia)
  ) into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.admin_resumo_ativas(integer) from public, anon;
grant execute on function public.admin_resumo_ativas(integer) to authenticated;

-- ======================================================================
-- 20261028120000_observabilidade.sql
-- ======================================================================

-- Painel do dono do sistema, funcionalidade 4: observabilidade
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva: tabelas e funções novas, mais uma extensão
-- da retenção de logs. Não altera `criar_pedido`, `usuario_tem_acesso_barraca` nem policies.
--
-- Privacidade: `eventos_erro` guarda barraca, versão, plataforma, tipo e uma mensagem curta. Sem
-- texto livre do usuário: a função corta em 200 caracteres e troca e-mail e sequências longas de
-- dígitos (telefone, CPF, CNPJ) antes de gravar. Retenção de 30 dias (`limpar_logs_antigos`).

create table if not exists public.eventos_erro (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  tipo text not null check (tipo in ('js', 'sync', 'impressao', 'tela_branca')),
  mensagem text not null check (char_length(mensagem) <= 200),
  versao_app text not null check (char_length(versao_app) <= 40),
  plataforma text not null check (plataforma in ('android', 'ios', 'web')),
  criado_em timestamptz not null default now()
);
create index if not exists eventos_erro_criado_em_idx on public.eventos_erro (criado_em desc);
create index if not exists eventos_erro_versao_idx on public.eventos_erro (versao_app, criado_em desc);
create index if not exists eventos_erro_barraca_idx on public.eventos_erro (barraca_id, criado_em desc);
alter table public.eventos_erro enable row level security;
revoke all on table public.eventos_erro from public, anon, authenticated;

create table if not exists public.barracas_versao_app (
  barraca_id uuid primary key references public.barracas(id) on delete cascade,
  versao_app text not null check (char_length(versao_app) <= 40),
  plataforma text not null check (plataforma in ('android', 'ios', 'web')),
  atualizado_em timestamptz not null default now()
);
alter table public.barracas_versao_app enable row level security;
revoke all on table public.barracas_versao_app from public, anon, authenticated;

-- Alertas já enviados, para o e-mail não repetir o mesmo aviso no mesmo dia. Só a edge function
-- (service role) escreve.
create table if not exists public.alertas_enviados (
  chave text primary key,
  enviado_em timestamptz not null default now()
);
alter table public.alertas_enviados enable row level security;
revoke all on table public.alertas_enviados from public, anon, authenticated;

-- Quem tem acesso à barraca (dono, funcionário) grava erro dela. Erro inválido, de quem não tem
-- acesso ou acima de 60 por hora por usuário é ignorado sem devolver erro: reportar erro nunca
-- pode quebrar o app nem virar um canal de abuso.
create or replace function public.registrar_erro_app(
  p_barraca_id uuid,
  p_tipo text,
  p_mensagem text,
  p_versao text,
  p_plataforma text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mensagem text;
begin
  if auth.uid() is null
     or p_tipo not in ('js', 'sync', 'impressao', 'tela_branca')
     or p_plataforma not in ('android', 'ios', 'web')
     or coalesce(p_versao, '') = ''
     or not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return;
  end if;
  if (select count(*) from public.eventos_erro e
       where e.usuario_id = auth.uid() and e.criado_em > now() - interval '1 hour') >= 60 then
    return;
  end if;

  v_mensagem := coalesce(p_mensagem, '');
  v_mensagem := regexp_replace(v_mensagem, '[[:alnum:]._%+-]+@[[:alnum:].-]+', '[email]', 'g');
  v_mensagem := regexp_replace(v_mensagem, '[0-9]{8,}', '[numero]', 'g');
  v_mensagem := left(v_mensagem, 200);

  insert into public.eventos_erro (barraca_id, usuario_id, tipo, mensagem, versao_app, plataforma)
  values (p_barraca_id, auth.uid(), p_tipo, v_mensagem, left(p_versao, 40), p_plataforma);
end;
$$;

revoke all on function public.registrar_erro_app(uuid, text, text, text, text) from public, anon;
grant execute on function public.registrar_erro_app(uuid, text, text, text, text) to authenticated;

create or replace function public.registrar_versao_app(p_barraca_id uuid, p_versao text, p_plataforma text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or p_plataforma not in ('android', 'ios', 'web')
     or coalesce(p_versao, '') = ''
     or not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return;
  end if;
  insert into public.barracas_versao_app (barraca_id, versao_app, plataforma, atualizado_em)
  values (p_barraca_id, left(p_versao, 40), p_plataforma, now())
  on conflict (barraca_id) do update
    set versao_app = excluded.versao_app, plataforma = excluded.plataforma, atualizado_em = now();
end;
$$;

revoke all on function public.registrar_versao_app(uuid, text, text) from public, anon;
grant execute on function public.registrar_versao_app(uuid, text, text) to authenticated;

-- Saúde por barraca: pedidos dos últimos 7 dias contra a média de 7 dias da semana anterior
-- (dias 8 a 14 atrás), versão do app e erros das últimas 24 horas. Pedido cancelado não conta.
create or replace function public.admin_saude_barracas()
returns table (
  barraca_id uuid,
  nome text,
  slug text,
  versao_app text,
  plataforma text,
  versao_vista_em timestamptz,
  pedidos_7d bigint,
  pedidos_semana_anterior bigint,
  erros_24h bigint
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
  select
    b.id, b.nome, b.slug, v.versao_app, v.plataforma, v.atualizado_em,
    (select count(*) from public.pedidos p
      where p.barraca_id = b.id and p.cancelado_em is null
        and p.criado_em >= now() - interval '7 days'),
    (select count(*) from public.pedidos p
      where p.barraca_id = b.id and p.cancelado_em is null
        and p.criado_em >= now() - interval '14 days' and p.criado_em < now() - interval '7 days'),
    (select count(*) from public.eventos_erro e
      where e.barraca_id = b.id and e.criado_em >= now() - interval '24 hours')
  from public.barracas b
  left join public.barracas_versao_app v on v.barraca_id = b.id
  order by 9 desc, b.nome;
end;
$$;

revoke all on function public.admin_saude_barracas() from public, anon;
grant execute on function public.admin_saude_barracas() to authenticated;

-- Regras dos alertas (constantes aqui, não espalhadas):
--  * parou: pedidos em pelo menos 5 dos 7 dias que vão de 9 a 3 dias atrás e nenhum nos últimos 3
--    dias (mesma regra de `admin_resumo_ativas`; repetida porque aquela função exige superadmin
--    logado e esta também roda pelo job com a chave de serviço);
--  * pico_erros: 10 ou mais erros da mesma versão do app na última hora;
--  * webhook_falhas: 3 ou mais webhooks da Stripe com erro nas últimas 24 horas.
-- Falha de Pix pelo Mercado Pago ainda não entra: `webhook-mercadopago` não grava evento com erro.
-- shortcut: fuso America/Sao_Paulo para todas as barracas, como em `admin_resumo_ativas`.
create or replace function public.alertas_sistema()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_fuso constant text := 'America/Sao_Paulo';
  c_dias_vendia constant integer := 5;
  c_pico_erros constant integer := 10;
  c_webhook_falhas constant integer := 3;
  v_hoje date := (now() at time zone c_fuso)::date;
begin
  return jsonb_build_object(
    'parou', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'barraca_id', t.id, 'nome', t.nome, 'ultimo_pedido_em', t.ultimo
             ) order by t.ultimo desc, t.nome), '[]'::jsonb)
        from (select b.id, b.nome, max(p.criado_em) as ultimo
                from public.barracas b
                join public.pedidos p on p.barraca_id = b.id and p.cancelado_em is null
               where p.criado_em >= ((v_hoje - 9)::timestamp at time zone c_fuso)
               group by b.id, b.nome
              having count(distinct (p.criado_em at time zone c_fuso)::date) filter (
                       where (p.criado_em at time zone c_fuso)::date <= v_hoje - 3) >= c_dias_vendia
                 and count(*) filter (
                       where (p.criado_em at time zone c_fuso)::date >= v_hoje - 2) = 0
               limit 50) t),
    'pico_erros', (
      select coalesce(jsonb_agg(jsonb_build_object('versao', t.versao_app, 'erros', t.n) order by t.n desc), '[]'::jsonb)
        from (select e.versao_app, count(*) as n
                from public.eventos_erro e
               where e.criado_em >= now() - interval '1 hour'
               group by e.versao_app
              having count(*) >= c_pico_erros) t),
    'webhook_falhas', (
      select case when n >= c_webhook_falhas then n else 0 end
        from (select count(*)::integer as n
                from public.eventos_webhook_stripe w
               where w.error is not null and w.received_at >= now() - interval '24 hours') x)
  );
end;
$$;

-- Só o job (chave de serviço) chama direto; o painel passa por `admin_alertas`.
revoke all on function public.alertas_sistema() from public, anon, authenticated;
grant execute on function public.alertas_sistema() to service_role;

create or replace function public.admin_alertas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return public.alertas_sistema();
end;
$$;

revoke all on function public.admin_alertas() from public, anon;
grant execute on function public.admin_alertas() to authenticated;

-- Retenção: eventos_erro guarda 30 dias; o resto continua como em 20261026130000.
create or replace function public.limpar_logs_antigos()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.cardapio_pedidos_log where criado_em < now() - interval '2 days';
  delete from public.cliente_verificacoes_log where criado_em < now() - interval '2 days';
  delete from public.cliente_codigos
   where criado_em < now() - interval '7 days'
     and (usado_em is not null or expira_em < now());
  delete from public.eventos_erro where criado_em < now() - interval '30 days';
  delete from public.alertas_enviados where enviado_em < now() - interval '30 days';
$$;

revoke all on function public.limpar_logs_antigos() from public, anon, authenticated;

-- ======================================================================
-- 20261028130000_trial_avisos.sql
-- ======================================================================

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

-- ======================================================================
-- 20261028140000_admin_abrir_barraca.sql
-- ======================================================================

-- Painel do dono do sistema, funcionalidade 3: abrir uma barraca pelo painel, SÓ LEITURA
-- (docs/roadmap-admin-e-observabilidade.md). Aditiva: não altera `usuario_tem_acesso_barraca`,
-- policies nem RPCs existentes.
--
-- Como é somente leitura DE VERDADE: o superadmin não ganha linha em `usuarios_barracas` nem policy
-- nova em nenhuma tabela. Tudo que ele vê passa pelas funções abaixo, que só fazem SELECT (e gravam
-- apenas no log de acesso). Não existe caminho de escrita em pedido, caixa, cardápio nem ajustes,
-- então tentar gravar falha no banco e não só na tela.
--
-- Cada abertura grava uma linha em `acessos_admin_log` (quem, barraca, quando, modo, duração, quantas
-- revelações). Toda função de leitura exige um `acesso_id` aberto pelo próprio superadmin e ainda
-- válido (2 horas), conferindo a allowlist de novo a cada chamada. O dono da barraca vê a lista em
-- Ajustes > Conta (`acessos_admin_da_barraca`).
--
-- Dado de cliente final: nome só o primeiro, telefone com os 4 últimos dígitos; endereço não sai
-- na lista. Ver completo é `admin_barraca_revelar_cliente`, um pedido por vez, e cada revelação
-- entra em `acessos_admin_revelacoes`. Páginas de no máximo 50 linhas e nenhuma exportação.
--
-- Edição (cardápio) segue o mecanismo do suporte (migration 20261028150000_superadmin_vira_suporte.sql, que só
-- pode entrar depois de 20261023100000_acesso_suporte.sql).

create table if not exists public.acessos_admin_log (
  id uuid primary key default gen_random_uuid(),
  superadmin_id uuid references auth.users(id) on delete set null,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  modo text not null default 'leitura' check (modo in ('leitura')),
  aberto_em timestamptz not null default now(),
  ultimo_uso_em timestamptz not null default now(),
  revelacoes integer not null default 0
);
create index if not exists acessos_admin_log_barraca_idx on public.acessos_admin_log (barraca_id, aberto_em desc);
alter table public.acessos_admin_log enable row level security;
revoke all on table public.acessos_admin_log from public, anon, authenticated;

create table if not exists public.acessos_admin_revelacoes (
  id uuid primary key default gen_random_uuid(),
  acesso_id uuid not null references public.acessos_admin_log(id) on delete cascade,
  pedido_id uuid not null,
  em timestamptz not null default now()
);
alter table public.acessos_admin_revelacoes enable row level security;
revoke all on table public.acessos_admin_revelacoes from public, anon, authenticated;

-- Valida o acesso e devolve a barraca. Interna: só as funções abaixo (definer) chamam. As que a chamam
-- são VOLATILE de propósito (ela atualiza `ultimo_uso_em`), nunca STABLE.
create or replace function public.admin_acesso_barraca(p_acesso_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  update public.acessos_admin_log l
     set ultimo_uso_em = now()
   where l.id = p_acesso_id
     and l.superadmin_id = auth.uid()
     and l.aberto_em > now() - interval '2 hours'
  returning l.barraca_id into v_barraca;
  if v_barraca is null then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return v_barraca;
end;
$$;

revoke all on function public.admin_acesso_barraca(uuid) from public, anon, authenticated;

create or replace function public.admin_abrir_barraca_leitura(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acesso uuid;
  v_nome text;
  v_slug text;
begin
  if not exists (select 1 from public.superadmins s where s.usuario_id = auth.uid()) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  select b.nome, b.slug into v_nome, v_slug from public.barracas b where b.id = p_barraca_id;
  if v_nome is null then
    raise exception 'barraca nao encontrada' using errcode = 'P0002';
  end if;
  insert into public.acessos_admin_log (superadmin_id, barraca_id)
  values (auth.uid(), p_barraca_id)
  returning id into v_acesso;
  return jsonb_build_object('acesso_id', v_acesso, 'barraca_id', p_barraca_id, 'nome', v_nome, 'slug', v_slug);
end;
$$;

revoke all on function public.admin_abrir_barraca_leitura(uuid) from public, anon;
grant execute on function public.admin_abrir_barraca_leitura(uuid) to authenticated;

-- Pedidos (Histórico e Cozinha). p_filtro: null = todos; 'abertos' = a fazer, pronto e saiu para entrega.
create or replace function public.admin_barraca_pedidos(
  p_acesso_id uuid,
  p_filtro text default null,
  p_limite integer default 30,
  p_offset integer default 0
)
returns table (
  pedido_id uuid,
  senha integer,
  status text,
  criado_em timestamptz,
  tipo_atendimento text,
  metodo_pagamento text,
  cliente_primeiro_nome text,
  telefone_mascarado text,
  total_centavos bigint,
  total bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  if p_filtro is not null and p_filtro <> 'abertos' then
    raise exception 'filtro invalido' using errcode = '22023';
  end if;

  return query
  select
    p.id, p.senha, p.status, p.criado_em, p.tipo_atendimento, p.metodo_pagamento,
    nullif(split_part(coalesce(p.cliente_nome, ''), ' ', 1), ''),
    case when coalesce(p.cliente_telefone, '') = '' then null
         else repeat('*', greatest(char_length(p.cliente_telefone) - 4, 0)) || right(p.cliente_telefone, 4) end,
    coalesce((select sum(i.preco_centavos_unitario::bigint * i.quantidade)
                from public.itens_do_pedido i where i.pedido_id = p.id and not i.removido), 0)::bigint,
    count(*) over ()
  from public.pedidos p
  where p.barraca_id = v_barraca
    and (p_filtro is null or p.status in ('a_fazer', 'pronto', 'saiu_entrega'))
  order by p.criado_em desc
  limit greatest(1, least(coalesce(p_limite, 30), 50))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_barraca_pedidos(uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_barraca_pedidos(uuid, text, integer, integer) to authenticated;

-- Mostrar completo: um pedido por vez, cada chamada fica no log.
create or replace function public.admin_barraca_revelar_cliente(p_acesso_id uuid, p_pedido_id uuid)
returns table (
  cliente_nome text,
  cliente_telefone text,
  entrega_rua text,
  entrega_numero text,
  entrega_bairro text,
  entrega_referencia text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  if not exists (select 1 from public.pedidos p where p.id = p_pedido_id and p.barraca_id = v_barraca) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  insert into public.acessos_admin_revelacoes (acesso_id, pedido_id) values (p_acesso_id, p_pedido_id);
  update public.acessos_admin_log l set revelacoes = l.revelacoes + 1 where l.id = p_acesso_id;
  return query
  select p.cliente_nome, p.cliente_telefone, p.entrega_rua, p.entrega_numero, p.entrega_bairro, p.entrega_referencia
    from public.pedidos p where p.id = p_pedido_id;
end;
$$;

revoke all on function public.admin_barraca_revelar_cliente(uuid, uuid) from public, anon;
grant execute on function public.admin_barraca_revelar_cliente(uuid, uuid) to authenticated;

-- Faturamento por dia e forma de pagamento (pedido cancelado fora; total = itens não removidos,
-- como em `calcularTotalPedido`). p_dias vai de 1 a 90.
create or replace function public.admin_barraca_faturamento(p_acesso_id uuid, p_dias integer default 14)
returns table (dia date, metodo_pagamento text, pedidos bigint, total_centavos bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_dias integer := greatest(1, least(coalesce(p_dias, 14), 90));
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return query
  select p.data_operacao, p.metodo_pagamento, count(*),
         coalesce(sum((select sum(i.preco_centavos_unitario::bigint * i.quantidade)
                         from public.itens_do_pedido i where i.pedido_id = p.id and not i.removido)), 0)::bigint
    from public.pedidos p
   where p.barraca_id = v_barraca
     and p.status <> 'cancelado'
     and p.data_operacao >= current_date - (v_dias - 1)
   group by p.data_operacao, p.metodo_pagamento
   order by p.data_operacao desc, p.metodo_pagamento;
end;
$$;

revoke all on function public.admin_barraca_faturamento(uuid, integer) from public, anon;
grant execute on function public.admin_barraca_faturamento(uuid, integer) to authenticated;

create or replace function public.admin_barraca_caixas(p_acesso_id uuid, p_limite integer default 14)
returns table (
  data date,
  status text,
  valor_abertura_centavos integer,
  valor_fechamento_centavos integer,
  valor_esperado_centavos integer,
  diferenca_centavos integer,
  aberto_em timestamptz,
  fechado_em timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return query
  select c.data, c.status, c.valor_abertura_centavos, c.valor_fechamento_centavos,
         c.valor_esperado_centavos, c.diferenca_centavos, c.aberto_em, c.fechado_em
    from public.caixas c
   where c.barraca_id = v_barraca
   order by c.data desc, c.aberto_em desc
   limit greatest(1, least(coalesce(p_limite, 14), 60));
end;
$$;

revoke all on function public.admin_barraca_caixas(uuid, integer) from public, anon;
grant execute on function public.admin_barraca_caixas(uuid, integer) to authenticated;

-- Ajustes: só configuração sem segredo. Fora daqui, de propósito: tokens, PIN, CNPJ e dados do
-- emitente, contatos do dono, pagamento e fiscal além de ligado/desligado.
create or replace function public.admin_barraca_ajustes(p_acesso_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  v_barraca := public.admin_acesso_barraca(p_acesso_id);
  return (
    select jsonb_build_object(
      'nome', b.nome,
      'slug', b.slug,
      'criada_em', b.criada_em,
      'fuso', b.fuso,
      'modos_atendimento', b.modos_atendimento,
      'taxa_entrega_habilitada', b.taxa_entrega_habilitada,
      'taxa_entrega_centavos', b.taxa_entrega_centavos,
      'pagamento_provedor', b.pagamento_provedor,
      'pagamento_online_habilitado', b.pagamento_online_habilitado,
      'pagar_na_entrega_habilitado', b.pagar_na_entrega_habilitado,
      'fiscal_habilitado', b.fiscal_habilitado,
      'impressora_habilitada', b.impressora_habilitada,
      'ia_habilitada', b.ia_habilitada,
      'cupons_habilitado', b.cupons_habilitado,
      'opcoes_habilitado', b.opcoes_habilitado,
      'estoque_bloqueia', b.estoque_bloqueia,
      'bloquear_fora_do_horario', b.bloquear_fora_do_horario,
      'onboarding_concluido_em', b.onboarding_concluido_em,
      'assinatura', (
        select jsonb_build_object('status', a.status, 'plano', a.plan, 'trial_ends_at', a.trial_ends_at,
                                  'current_period_end', a.current_period_end)
          from public.usuarios_barracas ub
          join public.assinaturas a on a.usuario_id = ub.usuario_id
         where ub.barraca_id = b.id and ub.papel = 'dono'
         limit 1)
    )
    from public.barracas b where b.id = v_barraca);
end;
$$;

revoke all on function public.admin_barraca_ajustes(uuid) from public, anon;
grant execute on function public.admin_barraca_ajustes(uuid) to authenticated;

-- O dono vê quem abriu a barraca dele, quando, por quanto tempo e quantas revelações houve.
create or replace function public.acessos_admin_da_barraca(p_barraca_id uuid)
returns table (aberto_em timestamptz, duracao_segundos integer, modo text, revelacoes integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.usuarios_barracas ub
     where ub.barraca_id = p_barraca_id and ub.usuario_id = auth.uid() and ub.papel = 'dono'
  ) then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  return query
  select l.aberto_em, extract(epoch from (l.ultimo_uso_em - l.aberto_em))::integer, l.modo, l.revelacoes
    from public.acessos_admin_log l
   where l.barraca_id = p_barraca_id
   order by l.aberto_em desc
   limit 30;
end;
$$;

revoke all on function public.acessos_admin_da_barraca(uuid) from public, anon;
grant execute on function public.acessos_admin_da_barraca(uuid) to authenticated;
