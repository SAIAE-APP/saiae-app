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
