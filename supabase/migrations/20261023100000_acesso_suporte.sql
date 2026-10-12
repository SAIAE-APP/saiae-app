-- Acesso do suporte: o dono gera um código curto pra uma conta de suporte
-- (allowlist `usuarios_suporte`, começa vazia) entrar na loja sem SQL manual
-- e sem a senha do cliente. Código de 8 caracteres, válido 24h, uso único;
-- o acesso concedido dura 7 dias e pode ser encerrado pelo dono a qualquer
-- momento. Migration 100% aditiva: a única função existente alterada é
-- `usuario_tem_acesso_barraca`, só pra ACRESCENTAR uma condição OR — o
-- corpo original (vínculo em usuarios_barracas) continua exatamente igual.
--
-- O código em si nunca é guardado em texto puro, só o hash. Usamos SHA-256
-- (pgcrypto.digest), não bcrypt como a senha administrativa
-- (definir_senha_admin.sql): a defesa aqui não é o custo computacional do
-- hash contra força bruta offline (o código já é de uso único, expira em
-- 24h e só resgata quem está na allowlist, com limite de tentativas) — é
-- um lookup por igualdade, então precisa ser indexável, o que um hash de
-- custo variável como bcrypt não permite.
--
-- Suporte NUNCA ganha uma linha em usuarios_barracas — por isso fica de
-- fora, por construção, de toda ação que checa `papel = 'dono'`
-- (apagar_barraca, excluir_dados_conta, assinatura): não precisa de
-- nenhuma trava nova nelas.

create extension if not exists pgcrypto;

-- 1) Allowlist de quem pode RESGATAR código de suporte. Sem policy nenhuma
-- pro cliente (nem select): só leitura interna das funções SECURITY
-- DEFINER abaixo. Inclusão é manual por SQL, feita pelo dono do projeto.
create table if not exists public.usuarios_suporte (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_suporte enable row level security;

-- 2) Códigos gerados. Ninguém lê o hash — nem o dono, nem o suporte — só
-- as funções abaixo. "usado_em"/"usado_por" e "criado_por" são a auditoria
-- de quem gerou e quem usou.
create table if not exists public.codigos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  usado_por uuid references auth.users(id),
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);
create unique index if not exists codigos_suporte_hash_idx on public.codigos_suporte (codigo_hash);
alter table public.codigos_suporte enable row level security;

-- 3) Acessos concedidos. O dono vê e encerra os da própria loja; o
-- suporte não lê esta tabela diretamente (usa suporte_meu_acesso /
-- suporte_minhas_barracas, que já filtram pro próprio usuário).
create table if not exists public.acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  usuario_suporte_id uuid not null references auth.users(id),
  concedido_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  codigo_id uuid not null references public.codigos_suporte(id)
);
alter table public.acessos_suporte enable row level security;

drop policy if exists "dono ve acessos de suporte da propria loja" on public.acessos_suporte;
create policy "dono ve acessos de suporte da propria loja" on public.acessos_suporte
for select
using (exists (
  select 1 from public.usuarios_barracas ub
  where ub.barraca_id = acessos_suporte.barraca_id
    and ub.usuario_id = auth.uid()
    and ub.papel = 'dono'
));

-- 4) Tentativas de resgate erradas, por usuário de suporte (não por IP: só
-- conta autenticada e já na allowlist chega a gastar uma tentativa aqui —
-- ver suporte_resgatar_codigo). 5 erros bloqueiam 10 minutos.
create table if not exists public.suporte_tentativas (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  tentativas integer not null default 0,
  bloqueado_ate timestamptz
);
alter table public.suporte_tentativas enable row level security;

-- 5) Gerar código — só o dono da barraca.
create or replace function public.suporte_gerar_codigo(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_codigo text;
  v_expira timestamptz := now() + interval '24 hours';
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  if not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  v_codigo := '';
  for i in 1..8 loop
    v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::integer, 1);
  end loop;

  insert into public.codigos_suporte (barraca_id, codigo_hash, expira_em, criado_por)
  values (p_barraca_id, encode(digest(v_codigo, 'sha256'), 'hex'), v_expira, auth.uid());

  return jsonb_build_object('estado', 'ok', 'codigo', v_codigo, 'expira_em', v_expira);
end;
$$;
revoke all on function public.suporte_gerar_codigo(uuid) from public, anon, authenticated;
grant execute on function public.suporte_gerar_codigo(uuid) to authenticated;

-- 6) Função auxiliar (não exposta ao client) de suporte_resgatar_codigo —
-- incrementa tentativas erradas e bloqueia 10 minutos na 5ª.
create or replace function public.suporte_registrar_tentativa_errada(p_usuario_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tentativas integer;
begin
  insert into public.suporte_tentativas (usuario_id, tentativas)
  values (p_usuario_id, 1)
  on conflict (usuario_id) do update set tentativas = public.suporte_tentativas.tentativas + 1
  returning tentativas into v_tentativas;

  if v_tentativas >= 5 then
    update public.suporte_tentativas
       set tentativas = 0, bloqueado_ate = now() + interval '10 minutes'
     where usuario_id = p_usuario_id;
  end if;
end;
$$;
revoke all on function public.suporte_registrar_tentativa_errada(uuid) from public, anon, authenticated;

-- 7) Resgatar código — só quem está em usuarios_suporte. Conta fora da
-- allowlist e código que não casou dão a MESMA resposta ('codigo_invalido'):
-- nunca revela se a conta está ou não na lista.
create or replace function public.suporte_resgatar_codigo(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codigo text;
  v_hash text;
  v_tentativas public.suporte_tentativas%rowtype;
  v_achado public.codigos_suporte%rowtype;
  v_barraca public.barracas%rowtype;
  v_expira_acesso timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  select * into v_tentativas from public.suporte_tentativas where usuario_id = auth.uid();
  if v_tentativas.bloqueado_ate is not null and v_tentativas.bloqueado_ate > now() then
    return jsonb_build_object('estado', 'bloqueado', 'ate', v_tentativas.bloqueado_ate);
  end if;

  if not exists (select 1 from public.usuarios_suporte where usuario_id = auth.uid()) then
    perform public.suporte_registrar_tentativa_errada(auth.uid());
    return jsonb_build_object('estado', 'codigo_invalido');
  end if;

  v_codigo := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_hash := encode(digest(v_codigo, 'sha256'), 'hex');

  select * into v_achado
  from public.codigos_suporte
  where codigo_hash = v_hash and expira_em > now() and usado_em is null;

  if not found then
    perform public.suporte_registrar_tentativa_errada(auth.uid());
    return jsonb_build_object('estado', 'codigo_invalido');
  end if;

  update public.codigos_suporte
     set usado_em = now(), usado_por = auth.uid()
   where id = v_achado.id;

  v_expira_acesso := now() + interval '7 days';

  insert into public.acessos_suporte (barraca_id, usuario_suporte_id, expira_em, codigo_id)
  values (v_achado.barraca_id, auth.uid(), v_expira_acesso, v_achado.id);

  delete from public.suporte_tentativas where usuario_id = auth.uid();

  select * into v_barraca from public.barracas where id = v_achado.barraca_id;

  return jsonb_build_object(
    'estado', 'ok',
    'barraca_id', v_barraca.id,
    'slug', v_barraca.slug,
    'nome', v_barraca.nome,
    'expira_em', v_expira_acesso
  );
end;
$$;
revoke all on function public.suporte_resgatar_codigo(text) from public, anon, authenticated;
grant execute on function public.suporte_resgatar_codigo(text) to authenticated;

-- 8) Encerrar acesso — só o dono da barraca do acesso.
create or replace function public.suporte_encerrar_acesso(p_acesso_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acesso public.acessos_suporte%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;

  select * into v_acesso from public.acessos_suporte where id = p_acesso_id;
  if not found then
    return jsonb_build_object('estado', 'nao_encontrado');
  end if;

  if not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = v_acesso.barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  update public.acessos_suporte
     set revogado_em = now()
   where id = p_acesso_id and revogado_em is null;

  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke all on function public.suporte_encerrar_acesso(uuid) from public, anon, authenticated;
grant execute on function public.suporte_encerrar_acesso(uuid) to authenticated;

-- 9) O próprio usuário de suporte conferindo se tem acesso ativo numa
-- barraca — usado por GateSenhaAdmin (pular o PIN) e pela faixa fixa.
create or replace function public.suporte_meu_acesso(p_barraca_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ativo', exists (
      select 1 from public.acessos_suporte
      where usuario_suporte_id = auth.uid()
        and barraca_id = p_barraca_id
        and expira_em > now()
        and revogado_em is null
    ),
    'expira_em', (
      select max(expira_em) from public.acessos_suporte
      where usuario_suporte_id = auth.uid()
        and barraca_id = p_barraca_id
        and expira_em > now()
        and revogado_em is null
    )
  );
$$;
revoke all on function public.suporte_meu_acesso(uuid) from public, anon;
grant execute on function public.suporte_meu_acesso(uuid) to authenticated;

-- 10) As barracas onde o usuário de suporte tem acesso ativo agora —
-- unidas com usuarios_barracas no front (useBarracasDoUsuario) pra ele
-- aparecer em Selecionar barraca e passar em RotaProtegida sem precisar
-- de nenhuma linha em usuarios_barracas.
create or replace function public.suporte_minhas_barracas()
returns table(barraca_id uuid, nome text, slug text, logo_url text, expira_em timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.nome, b.slug, b.logo_url, a.expira_em
  from public.acessos_suporte a
  join public.barracas b on b.id = a.barraca_id
  where a.usuario_suporte_id = auth.uid()
    and a.expira_em > now()
    and a.revogado_em is null;
$$;
revoke all on function public.suporte_minhas_barracas() from public, anon;
grant execute on function public.suporte_minhas_barracas() to authenticated;

-- 11) Acesso de suporte ativo também conta como "tem acesso à barraca" —
-- condição OR acrescentada ao corpo original (select exists na
-- usuarios_barracas), que fica intacto.
create or replace function public.usuario_tem_acesso_barraca(p_barraca_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from usuarios_barracas
    where usuario_id = auth.uid()
      and barraca_id = p_barraca_id
  )
  or exists (
    select 1 from acessos_suporte
    where usuario_suporte_id = auth.uid()
      and barraca_id = p_barraca_id
      and expira_em > now()
      and revogado_em is null
  );
$function$;
