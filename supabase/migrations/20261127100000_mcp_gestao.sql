-- Gestão por IA (MCP), fatia 1: tokens por barraca e auditoria. Spec: docs/superpowers/specs/2026-11-27-mcp-gestao-ia-design.md
-- ADITIVA: duas tabelas novas e cinco funções novas; nada existente muda.
--
-- Rollback:
--   drop function if exists public.mcp_token_criar(uuid, text);
--   drop function if exists public.mcp_token_listar(uuid);
--   drop function if exists public.mcp_token_revogar(uuid);
--   drop function if exists public.mcp_token_validar(text);
--   drop function if exists public.mcp_auditoria_listar(uuid, integer);
--   drop table if exists public.mcp_auditoria;
--   drop table if exists public.mcp_tokens;
--
-- Decisões:
--   * O token ("sae_" + 48 hex) é mostrado UMA vez, na criação; no banco fica só o SHA-256.
--   * Só o DONO (usuarios_barracas.papel = 'dono') cria, lista e revoga. O suporte nunca entra aqui.
--   * As tabelas não têm policy: o app só mexe nelas pelas funções abaixo. A edge function `mcp-saiae`
--     usa a service role e SEMPRE filtra por barraca_id vindo do token, nunca de argumento da IA.
--   * Sem módulo pago: toda barraca pode criar a chave (decisão do dono do produto, 2026-11-27).

create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  nome text not null,
  token_hash text not null unique,
  prefixo text not null,
  criado_por uuid not null,
  criado_em timestamptz not null default now(),
  ultimo_uso_em timestamptz,
  revogado_em timestamptz,
  constraint mcp_tokens_nome_check check (char_length(nome) between 1 and 60)
);
create index if not exists mcp_tokens_barraca_idx on public.mcp_tokens (barraca_id);

create table if not exists public.mcp_auditoria (
  id bigint generated always as identity primary key,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  token_id uuid references public.mcp_tokens(id) on delete set null,
  ferramenta text not null,
  argumentos jsonb,
  resultado text not null,
  criado_em timestamptz not null default now()
);
create index if not exists mcp_auditoria_barraca_idx on public.mcp_auditoria (barraca_id, criado_em desc);

alter table public.mcp_tokens enable row level security;
alter table public.mcp_auditoria enable row level security;
revoke all on table public.mcp_tokens from public, anon, authenticated;
revoke all on table public.mcp_auditoria from public, anon, authenticated;

-- Dono cria um token. Máximo de 5 ativos por barraca. Devolve o token em texto puro uma única vez.
create or replace function public.mcp_token_criar(p_barraca_id uuid, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_nome text := left(trim(coalesce(p_nome, '')), 60);
  v_token text;
  v_id uuid;
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
  if v_nome = '' then
    return jsonb_build_object('estado', 'nome_invalido');
  end if;
  perform pg_advisory_xact_lock(hashtext('mcp_token_criar:' || p_barraca_id::text));
  if (select count(*) from public.mcp_tokens where barraca_id = p_barraca_id and revogado_em is null) >= 5 then
    return jsonb_build_object('estado', 'limite_de_tokens');
  end if;

  v_token := 'sae_' || encode(gen_random_bytes(24), 'hex');
  insert into public.mcp_tokens (barraca_id, nome, token_hash, prefixo, criado_por)
  values (p_barraca_id, v_nome, encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), auth.uid())
  returning id into v_id;

  return jsonb_build_object('estado', 'ok', 'id', v_id, 'token', v_token);
end;
$$;

create or replace function public.mcp_token_listar(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'nome', t.nome, 'prefixo', t.prefixo,
      'criado_em', t.criado_em, 'ultimo_uso_em', t.ultimo_uso_em, 'revogado_em', t.revogado_em
    ) order by t.criado_em desc)
    from public.mcp_tokens t where t.barraca_id = p_barraca_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_token_revogar(p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  select barraca_id into v_barraca from public.mcp_tokens where id = p_token_id;
  if v_barraca is null or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = v_barraca and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  update public.mcp_tokens set revogado_em = now() where id = p_token_id and revogado_em is null;
  return jsonb_build_object('estado', 'ok');
end;
$$;

create or replace function public.mcp_auditoria_listar(p_barraca_id uuid, p_limite integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.usuarios_barracas
    where barraca_id = p_barraca_id and usuario_id = auth.uid() and papel = 'dono'
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'id', a.id, 'ferramenta', a.ferramenta, 'argumentos', a.argumentos,
        'resultado', a.resultado, 'criado_em', a.criado_em
      ) as x
      from public.mcp_auditoria a
      where a.barraca_id = p_barraca_id
      order by a.criado_em desc
      limit greatest(1, least(coalesce(p_limite, 50), 200))
    ) s
  ), '[]'::jsonb);
end;
$$;

-- Só a edge function (service role): confere o hash, ignora token revogado e marca o uso.
create or replace function public.mcp_token_validar(p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.mcp_tokens%rowtype;
begin
  -- O token só vale enquanto quem o criou ainda é dono da barraca.
  select t.* into v_token
  from public.mcp_tokens t
  where t.token_hash = p_hash and t.revogado_em is null
    and exists (
      select 1 from public.usuarios_barracas ub
      where ub.barraca_id = t.barraca_id and ub.usuario_id = t.criado_por and ub.papel = 'dono'
    );
  if not found then
    return null;
  end if;
  if v_token.ultimo_uso_em is null or v_token.ultimo_uso_em < now() - interval '1 minute' then
    update public.mcp_tokens set ultimo_uso_em = now() where id = v_token.id;
  end if;
  return jsonb_build_object('barraca_id', v_token.barraca_id, 'token_id', v_token.id);
end;
$$;

revoke all on function public.mcp_token_criar(uuid, text) from public, anon;
revoke all on function public.mcp_token_listar(uuid) from public, anon;
revoke all on function public.mcp_token_revogar(uuid) from public, anon;
revoke all on function public.mcp_auditoria_listar(uuid, integer) from public, anon;
revoke all on function public.mcp_token_validar(text) from public, anon, authenticated;
grant execute on function public.mcp_token_criar(uuid, text) to authenticated;
grant execute on function public.mcp_token_listar(uuid) to authenticated;
grant execute on function public.mcp_token_revogar(uuid) to authenticated;
grant execute on function public.mcp_auditoria_listar(uuid, integer) to authenticated;
grant execute on function public.mcp_token_validar(text) to service_role;
