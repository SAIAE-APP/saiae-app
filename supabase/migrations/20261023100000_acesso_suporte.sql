-- Acesso do suporte: o dono gera um código curto pra uma conta de suporte
-- (allowlist `usuarios_suporte`, começa vazia) entrar na loja sem SQL manual
-- e sem a senha do cliente, SÓ para montar o cardápio. Código de 8
-- caracteres, válido 24h, uso único; o acesso concedido dura 7 dias e pode
-- ser encerrado pelo dono a qualquer momento.
--
-- ESCOPO DELIBERADAMENTE ESTREITO (revisão de segurança, 2026-10-11): a
-- primeira versão desta migration estendia `usuario_tem_acesso_barraca`
-- (a função genérica de "tem acesso à barraca") para aceitar acesso de
-- suporte. Isso foi revertido: várias policies e RPCs sensíveis usam SÓ
-- essa função sem checar `papel = 'dono'` — UPDATE de `barracas` (incluindo
-- whatsapp/CNPJ/provedor de pagamento), DELETE de `pedidos` ("Apagar
-- período" em Histórico), `definir_token_pagamento`, `definir_senha_admin`
-- (o próprio PIN que o suporte deveria pular, não reescrever),
-- `definir_token_fiscal`, `integracao_crm_salvar`. Estender a função
-- genérica daria ao suporte acesso a TUDO isso. Em vez disso, o suporte
-- ganha SÓ o que precisa pra montar cardápio: `acesso_suporte_ativo(uuid)`
-- é usada em NOVAS policies de SELECT/INSERT/UPDATE/DELETE de `itens` e
-- `categorias`, e SELECT (só leitura) de `barracas`. `usuario_tem_acesso_
-- barraca` NÃO muda — nenhuma RPC ou policy existente precisa de trava
-- nova. Histórico, Caixa, Faturamento e as demais seções de Ajustes
-- (Pagamento, Fiscal, Pagamento online etc.) continuam vazios/bloqueados
-- pro suporte mesmo com o PIN pulado — é esperado, não um bug: a RLS
-- continua a barreira de verdade, o GateSenhaAdmin é só UX.
--
-- O código em si nunca é guardado em texto puro, só o hash. Usamos SHA-256
-- (`extensions.digest`), não bcrypt como a senha administrativa
-- (definir_senha_admin.sql): a defesa aqui não é o custo computacional do
-- hash contra força bruta offline (o código já é de uso único, expira em
-- 24h e só resgata quem está na allowlist, com limite de tentativas) — é
-- um lookup por igualdade, então precisa ser indexável, o que um hash de
-- custo variável como bcrypt não permite. No Supabase o pgcrypto vive no
-- schema `extensions` (não `public`) — toda função que chama `digest`
-- inclui `extensions` no search_path, mesmo padrão de definir_senha_admin.sql
-- (`set search_path = public, extensions`).

create extension if not exists pgcrypto;

-- 1) Allowlist de quem pode RESGATAR código de suporte. Sem policy nenhuma
-- pro cliente (nem select): só leitura interna das funções SECURITY
-- DEFINER abaixo. Inclusão é manual por SQL, feita pelo dono do projeto.
-- Tirar alguém daqui encerra o acesso dela na mesma hora (ver
-- acesso_suporte_ativo/suporte_meu_acesso/suporte_minhas_barracas abaixo —
-- todas conferem a allowlist de novo, não só o prazo do acesso concedido).
create table if not exists public.usuarios_suporte (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_suporte enable row level security;

-- 2) Códigos gerados. Ninguém lê o hash — nem o dono, nem o suporte — só
-- as funções abaixo. "usado_em"/"usado_por" e "criado_por" são a auditoria
-- de quem gerou e quem usou. `usado_por` vira NULL se a conta de suporte for
-- apagada depois (a linha do código continua, só perde a referência).
create table if not exists public.codigos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  usado_por uuid references auth.users(id) on delete set null,
  criado_por uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
create unique index if not exists codigos_suporte_hash_idx on public.codigos_suporte (codigo_hash);
alter table public.codigos_suporte enable row level security;

-- 3) Acessos concedidos. O dono vê e encerra os da própria loja; o
-- suporte não lê esta tabela diretamente (usa suporte_meu_acesso /
-- suporte_minhas_barracas, que já filtram pro próprio usuário). Se a conta
-- de suporte for apagada, a linha do acesso sai junto (não faz sentido
-- manter um acesso "de ninguém").
create table if not exists public.acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  usuario_suporte_id uuid not null references auth.users(id) on delete cascade,
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

-- 5) O usuário de suporte tem um acesso ATIVO e válido (acesso concedido
-- não expirado/revogado E a conta ainda está na allowlist) a esta barraca.
-- Usada SÓ nas policies novas de itens/categorias/barracas abaixo e nas
-- RPCs suporte_meu_acesso/suporte_minhas_barracas — nunca em
-- usuario_tem_acesso_barraca (ver nota no topo do arquivo).
create or replace function public.acesso_suporte_ativo(p_barraca_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.acessos_suporte a
      join public.usuarios_suporte s on s.usuario_id = a.usuario_suporte_id
     where a.usuario_suporte_id = auth.uid()
       and a.barraca_id = p_barraca_id
       and a.expira_em > now()
       and a.revogado_em is null
  );
$$;
revoke all on function public.acesso_suporte_ativo(uuid) from public, anon;
grant execute on function public.acesso_suporte_ativo(uuid) to authenticated;

-- 6) Cardápio: suporte lê/escreve itens e categorias da barraca onde tem
-- acesso ativo — é o único propósito da feature ("montar o cardápio").
-- Policies NOVAS (somadas às existentes, nunca substituem): o dono e os
-- funcionários de sempre continuam exatamente como estavam.
drop policy if exists "suporte ve itens com acesso ativo" on public.itens;
create policy "suporte ve itens com acesso ativo" on public.itens
for select using (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte insere itens com acesso ativo" on public.itens;
create policy "suporte insere itens com acesso ativo" on public.itens
for insert with check (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte edita itens com acesso ativo" on public.itens;
create policy "suporte edita itens com acesso ativo" on public.itens
for update using (public.acesso_suporte_ativo(barraca_id)) with check (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte apaga itens com acesso ativo" on public.itens;
create policy "suporte apaga itens com acesso ativo" on public.itens
for delete using (public.acesso_suporte_ativo(barraca_id));

drop policy if exists "suporte ve categorias com acesso ativo" on public.categorias;
create policy "suporte ve categorias com acesso ativo" on public.categorias
for select using (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte insere categorias com acesso ativo" on public.categorias;
create policy "suporte insere categorias com acesso ativo" on public.categorias
for insert with check (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte edita categorias com acesso ativo" on public.categorias;
create policy "suporte edita categorias com acesso ativo" on public.categorias
for update using (public.acesso_suporte_ativo(barraca_id)) with check (public.acesso_suporte_ativo(barraca_id));
drop policy if exists "suporte apaga categorias com acesso ativo" on public.categorias;
create policy "suporte apaga categorias com acesso ativo" on public.categorias
for delete using (public.acesso_suporte_ativo(barraca_id));

-- Só LEITURA de barracas (nome/slug/logo etc.) — é o que toda tela do app
-- precisa pra renderizar (useBarraca). UPDATE de barracas NÃO ganha policy
-- nova: o suporte não troca nada de configuração da loja.
drop policy if exists "suporte ve a barraca com acesso ativo" on public.barracas;
create policy "suporte ve a barraca com acesso ativo" on public.barracas
for select using (public.acesso_suporte_ativo(id));

-- 7) Gerar código — só o dono da barraca.
create or replace function public.suporte_gerar_codigo(p_barraca_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 32 chars: 256/32 sem viés no byte aleatório abaixo
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

  -- Byte aleatório criptográfico (não random(), que não é CSPRNG) — 32
  -- divide 256 exatamente, então o módulo não introduz viés nenhum.
  v_codigo := '';
  for i in 1..8 loop
    v_codigo := v_codigo || substr(alfabeto, 1 + (get_byte(gen_random_bytes(1), 0) % length(alfabeto)), 1);
  end loop;

  insert into public.codigos_suporte (barraca_id, codigo_hash, expira_em, criado_por)
  values (p_barraca_id, encode(digest(v_codigo, 'sha256'), 'hex'), v_expira, auth.uid());

  return jsonb_build_object('estado', 'ok', 'codigo', v_codigo, 'expira_em', v_expira);
end;
$$;
revoke all on function public.suporte_gerar_codigo(uuid) from public, anon, authenticated;
grant execute on function public.suporte_gerar_codigo(uuid) to authenticated;

-- 8) Função auxiliar (não exposta ao client) de suporte_resgatar_codigo —
-- incrementa tentativas erradas e bloqueia 10 minutos na 5ª. Chamada só
-- depois do pg_advisory_xact_lock em suporte_resgatar_codigo, então não
-- precisa de lock próprio (uma chamada por vez, por usuário).
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

-- 9) Resgatar código — só quem está em usuarios_suporte. Conta fora da
-- allowlist e código que não casou dão a MESMA resposta ('codigo_invalido'):
-- nunca revela se a conta está ou não na lista. pg_advisory_xact_lock no
-- início serializa chamadas concorrentes do MESMO usuário (fecha a corrida
-- do rate limit — I3 da revisão); o UPDATE ... RETURNING com
-- `usado_em is null` na cláusula where (não um SELECT seguido de UPDATE)
-- reivindica o código atomicamente, então duas chamadas concorrentes com o
-- MESMO código nunca resgatam as duas (I2 da revisão).
create or replace function public.suporte_resgatar_codigo(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

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

  update public.codigos_suporte
     set usado_em = now(), usado_por = auth.uid()
   where codigo_hash = v_hash and expira_em > now() and usado_em is null
  returning * into v_achado;

  if not found then
    perform public.suporte_registrar_tentativa_errada(auth.uid());
    return jsonb_build_object('estado', 'codigo_invalido');
  end if;

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

-- 10) Encerrar acesso — só o dono da barraca do acesso.
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

-- 11) O próprio usuário de suporte conferindo se tem acesso ativo numa
-- barraca — usado por GateSenhaAdmin (pular o PIN) e pela faixa fixa. Checa
-- a allowlist de novo (não só o prazo do acesso): tirar a conta de
-- usuarios_suporte encerra o acesso na mesma hora, não só depois dos 7 dias.
create or replace function public.suporte_meu_acesso(p_barraca_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ativo', public.acesso_suporte_ativo(p_barraca_id),
    'expira_em', (
      select max(a.expira_em)
        from public.acessos_suporte a
        join public.usuarios_suporte s on s.usuario_id = a.usuario_suporte_id
       where a.usuario_suporte_id = auth.uid()
         and a.barraca_id = p_barraca_id
         and a.expira_em > now()
         and a.revogado_em is null
    )
  );
$$;
revoke all on function public.suporte_meu_acesso(uuid) from public, anon;
grant execute on function public.suporte_meu_acesso(uuid) to authenticated;

-- 12) As barracas onde o usuário de suporte tem acesso ativo agora —
-- unidas com usuarios_barracas no front (useBarracasDoUsuario) pra ele
-- aparecer em Selecionar barraca e passar em RotaProtegida sem precisar
-- de nenhuma linha em usuarios_barracas. GROUP BY: se o dono revogou e
-- gerou acesso de novo, pode existir mais de uma linha ativa pra mesma
-- barraca — uma só por barraca aqui (com a validade mais distante), senão
-- vira `key` duplicada na lista do front.
create or replace function public.suporte_minhas_barracas()
returns table(barraca_id uuid, nome text, slug text, logo_url text, expira_em timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.nome, b.slug, b.logo_url, max(a.expira_em)
    from public.acessos_suporte a
    join public.usuarios_suporte s on s.usuario_id = a.usuario_suporte_id
    join public.barracas b on b.id = a.barraca_id
   where a.usuario_suporte_id = auth.uid()
     and a.expira_em > now()
     and a.revogado_em is null
   group by b.id, b.nome, b.slug, b.logo_url;
$$;
revoke all on function public.suporte_minhas_barracas() from public, anon;
grant execute on function public.suporte_minhas_barracas() to authenticated;
