-- Onboarding de configuração inicial — PR 1 (banco). Spec: docs/superpowers/specs/2026-10-08-onboarding-configuracao-design.md.
--
-- ADITIVA e REEXECUTÁVEL: tabelas/colunas novas (nullable ou com default constante: sem reescrever a tabela),
-- funções novas e um `create or replace` de criar_barraca (só acrescenta a recusa de slug reservado).
-- Não toca em `pedidos` nem em nenhuma tabela quente. Barraca antiga NUNCA é bloqueada: o backfill a marca
-- como "onboarding concluído" (uma única vez, na primeira execução). A flag de front (VITE_ONBOARDING_CONFIG)
-- é quem liga o assistente; sem ela nada muda.

-- 1) Dados do USUÁRIO coletados antes de existir barraca (passos 1 e 2). Só o próprio usuário lê e grava.
create table if not exists public.perfis_usuario (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  origem_aquisicao text,
  origem_detalhe text,
  categoria_negocio text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint perfis_usuario_origem_valida check (
    origem_aquisicao is null or origem_aquisicao in
      ('anuncio', 'instagram', 'tiktok', 'youtube', 'google', 'indicacao', 'panfleto', 'outro')
  ),
  constraint perfis_usuario_origem_detalhe_curto check (origem_detalhe is null or char_length(origem_detalhe) <= 60),
  constraint perfis_usuario_categoria_valida check (
    categoria_negocio is null or categoria_negocio in
      ('lanches', 'pizza', 'marmita', 'oriental', 'acai', 'doces', 'pastel', 'bebidas', 'churrasco', 'outra')
  )
);
alter table public.perfis_usuario enable row level security;
revoke all on table public.perfis_usuario from anon;
drop policy if exists perfis_usuario_proprio_select on public.perfis_usuario;
create policy perfis_usuario_proprio_select on public.perfis_usuario for select to authenticated
  using (usuario_id = auth.uid());
drop policy if exists perfis_usuario_proprio_insert on public.perfis_usuario;
create policy perfis_usuario_proprio_insert on public.perfis_usuario for insert to authenticated
  with check (usuario_id = auth.uid());
drop policy if exists perfis_usuario_proprio_update on public.perfis_usuario;
create policy perfis_usuario_proprio_update on public.perfis_usuario for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- 2) Colunas novas em barracas (sem default volátil, sem reescrita) e backfill de UMA vez.
alter table public.barracas
  add column if not exists categoria_negocio text,
  add column if not exists endereco_cep text,
  add column if not exists endereco_rua text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_complemento text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_cidade text,
  add column if not exists endereco_uf text,
  add column if not exists sem_cnpj boolean not null default false,
  add column if not exists onboarding_etapa smallint not null default 0,
  add column if not exists checklist_oculto_ate timestamptz;

do $$
begin
  -- Backfill idempotente: só na PRIMEIRA execução (coluna ainda não existia). Reexecutar depois não marca
  -- como "concluídas" as barracas novas. São poucas linhas (barracas), nada de pedidos.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'barracas' and column_name = 'onboarding_concluido_em'
  ) then
    alter table public.barracas add column onboarding_concluido_em timestamptz;
    update public.barracas set onboarding_concluido_em = criada_em, onboarding_etapa = 10;
  end if;
end;
$$;

alter table public.barracas drop constraint if exists barracas_categoria_negocio_valida;
alter table public.barracas add constraint barracas_categoria_negocio_valida check (
  categoria_negocio is null or categoria_negocio in
    ('lanches', 'pizza', 'marmita', 'oriental', 'acai', 'doces', 'pastel', 'bebidas', 'churrasco', 'outra')
);
alter table public.barracas drop constraint if exists barracas_endereco_valido;
alter table public.barracas add constraint barracas_endereco_valido check (
  (endereco_cep is null or endereco_cep ~ '^[0-9]{8}$')
  and (endereco_rua is null or char_length(endereco_rua) <= 120)
  and (endereco_numero is null or char_length(endereco_numero) <= 20)
  and (endereco_complemento is null or char_length(endereco_complemento) <= 80)
  and (endereco_bairro is null or char_length(endereco_bairro) <= 80)
  and (endereco_cidade is null or char_length(endereco_cidade) <= 80)
  and (endereco_uf is null or endereco_uf ~ '^[A-Z]{2}$')
);
alter table public.barracas drop constraint if exists barracas_onboarding_etapa_valida;
alter table public.barracas add constraint barracas_onboarding_etapa_valida check (onboarding_etapa between 0 and 10);

-- 3) Telemetria mínima: sem texto livre, sem dado pessoal. Sem leitura pela API (consulta SQL interna).
create table if not exists public.onboarding_eventos (
  id bigint generated always as identity primary key,
  barraca_id uuid references public.barracas(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete cascade,
  passo smallint not null check (passo between 1 and 10),
  acao text not null check (acao in ('visto', 'concluido', 'pulado', 'abandonou')),
  criado_em timestamptz not null default now()
);
create index if not exists onboarding_eventos_passo_idx on public.onboarding_eventos (passo, acao, criado_em);
alter table public.onboarding_eventos enable row level security;
revoke all on table public.onboarding_eventos from anon, authenticated;

-- 4) Slugs que colidem com rotas do app (mesma lista em src/lib/onboardingConfig.ts; um teste compara as duas).
create or replace function public.slug_reservado(p_slug text) returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_slug = any (array[
    'login', 'cadastro', 'onboarding', 'esqueci-senha', 'redefinir-senha', 'assinar', 'e', 'privacidade',
    'excluir-conta', 'selecionar-barraca', 'configurar', 'brand', 'assets', 'api', 'admin', 'app', 'www',
    'suporte', 'ajuda', 'termos'
  ]);
$$;

-- 5) Disponibilidade do link do cardápio: SÓ o booleano (não revela quais slugs existem nem de quem).
create or replace function public.slug_disponivel(p_slug text) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 40 or public.slug_reservado(v_slug) then
    return false;
  end if;
  return not exists (select 1 from public.barracas where slug = v_slug);
end;
$$;

-- 6) criar_barraca: igual à versão de 20261013100000, com UMA recusa a mais (slug reservado). Barraca que já
-- existe com slug reservado não é afetada (a função só roda na criação).
create or replace function public.criar_barraca(p_nome text, p_slug text)
returns public.barracas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := trim(p_nome);
  v_slug text := trim(p_slug);
  v_barraca public.barracas;
  v_plano text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  select plan into v_plano from public.assinaturas where usuario_id = auth.uid();

  if public.cobranca_ativa() and v_plano = 'essencial' and exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and papel = 'dono'
  ) then
    raise exception 'O plano Essencial permite só 1 barraca. Faça upgrade para o Pro pra criar mais.';
  end if;

  if v_nome = '' then
    raise exception 'Nome da barraca não pode ser vazio';
  end if;

  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Endereço inválido — use só letras minúsculas, números e hífen';
  end if;

  if public.slug_reservado(v_slug) then
    raise exception 'Esse endereço já está em uso';
  end if;

  if exists (select 1 from public.barracas where slug = v_slug) then
    raise exception 'Esse endereço já está em uso';
  end if;

  insert into public.barracas (
    nome, slug, modo, verde_ate, amarelo_ate, metodos_pagamento_ativos
  )
  values (
    v_nome, v_slug, 'claro', 15, 30,
    '["dinheiro", "debito", "credito", "pix"]'::jsonb
  )
  returning * into v_barraca;

  insert into public.usuarios_barracas (usuario_id, barraca_id, papel)
  values (auth.uid(), v_barraca.id, 'dono');

  return v_barraca;
end;
$$;
grant execute on function public.criar_barraca(text, text) to authenticated;

-- 7) Passos 1 e 2 (antes de existir barraca): origem e categoria ficam no usuário.
create or replace function public.onboarding_salvar_origem(p_origem text, p_detalhe text, p_categoria text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  -- Os CHECKs da tabela recusam valores fora da lista; vazio vira null (passo pulado).
  insert into public.perfis_usuario (usuario_id, origem_aquisicao, origem_detalhe, categoria_negocio)
  values (
    auth.uid(),
    nullif(btrim(p_origem), ''),
    nullif(left(btrim(coalesce(p_detalhe, '')), 60), ''),
    nullif(btrim(p_categoria), '')
  )
  on conflict (usuario_id) do update set
    origem_aquisicao = coalesce(nullif(btrim(p_origem), ''), public.perfis_usuario.origem_aquisicao),
    origem_detalhe = coalesce(nullif(left(btrim(coalesce(p_detalhe, '')), 60), ''), public.perfis_usuario.origem_detalhe),
    categoria_negocio = coalesce(nullif(btrim(p_categoria), ''), public.perfis_usuario.categoria_negocio),
    atualizado_em = now();
end;
$$;

-- 8) Passos com barraca (3 a 10). Só o DONO grava; valida e grava SÓ os campos conhecidos de cada passo;
-- idempotente (repetir o mesmo passo dá o mesmo resultado). Nunca baixa onboarding_etapa.
create or replace function public.onboarding_salvar_passo(p_barraca_id uuid, p_etapa integer, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := coalesce(p_dados, '{}'::jsonb);
  v_lista text[];
  v_item jsonb;
  v_dia integer;
  v_aberto boolean;
  v_abre time;
  v_fecha time;
  v_algum_aberto boolean := false;
  v_concluido timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono'
  ) then
    raise exception 'sem acesso a esta barraca';
  end if;
  if p_etapa is null or p_etapa not between 3 and 10 then
    raise exception 'etapa_invalida';
  end if;
  if jsonb_typeof(d) <> 'object' then
    raise exception 'dados_invalidos';
  end if;

  if p_etapa = 3 then
    -- A barraca acabou de nascer: leva a categoria escolhida no passo 2 (que ficou no usuário).
    update public.barracas b
       set categoria_negocio = coalesce(b.categoria_negocio, (select p.categoria_negocio from public.perfis_usuario p where p.usuario_id = auth.uid()))
     where b.id = p_barraca_id;

  elsif p_etapa = 4 then
    if d ? 'cnpj' and d->>'cnpj' is not null and d->>'cnpj' !~ '^[0-9]{14}$' then
      raise exception 'cnpj_invalido';
    end if;
    update public.barracas set
      cnpj = case when d ? 'cnpj' then nullif(d->>'cnpj', '') else cnpj end,
      sem_cnpj = case when d ? 'sem_cnpj' then coalesce((d->>'sem_cnpj')::boolean, false) else sem_cnpj end,
      emitente_razao_social = case when d ? 'razao_social' then nullif(left(btrim(d->>'razao_social'), 120), '') else emitente_razao_social end
    where id = p_barraca_id;

  elsif p_etapa = 5 then
    update public.barracas set
      endereco_cep = case when d ? 'cep' then nullif(regexp_replace(coalesce(d->>'cep', ''), '\D', '', 'g'), '') else endereco_cep end,
      endereco_rua = case when d ? 'rua' then nullif(left(btrim(d->>'rua'), 120), '') else endereco_rua end,
      endereco_numero = case when d ? 'numero' then nullif(left(btrim(d->>'numero'), 20), '') else endereco_numero end,
      endereco_complemento = case when d ? 'complemento' then nullif(left(btrim(d->>'complemento'), 80), '') else endereco_complemento end,
      endereco_bairro = case when d ? 'bairro' then nullif(left(btrim(d->>'bairro'), 80), '') else endereco_bairro end,
      endereco_cidade = case when d ? 'cidade' then nullif(left(btrim(d->>'cidade'), 80), '') else endereco_cidade end,
      endereco_uf = case when d ? 'uf' then nullif(upper(btrim(d->>'uf')), '') else endereco_uf end
    where id = p_barraca_id;

  elsif p_etapa = 6 then
    if coalesce(jsonb_typeof(d->'horarios'), '') <> 'array' or jsonb_array_length(d->'horarios') not between 1 and 7 then
      raise exception 'horarios_invalidos';
    end if;
    for v_item in select * from jsonb_array_elements(d->'horarios') loop
      v_dia := (v_item->>'dia')::integer;
      v_aberto := coalesce((v_item->>'aberto')::boolean, false);
      if v_dia is null or v_dia not between 0 and 6 then
        raise exception 'horarios_invalidos';
      end if;
      if v_aberto then
        v_abre := (v_item->>'abre')::time;
        v_fecha := (v_item->>'fecha')::time;
        if v_abre is null or v_fecha is null then
          raise exception 'horarios_invalidos';
        end if;
        v_algum_aberto := true;
      else
        v_abre := null;
        v_fecha := null;
      end if;
      insert into public.horarios_funcionamento (barraca_id, dia_semana, aberto, hora_abertura, hora_fechamento)
      values (p_barraca_id, v_dia, v_aberto, v_abre, v_fecha)
      on conflict (barraca_id, dia_semana) do update
        set aberto = excluded.aberto, hora_abertura = excluded.hora_abertura, hora_fechamento = excluded.hora_fechamento;
    end loop;
    -- Obrigatório: ao menos um dia aberto no conjunto final (não só neste envio).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto) then
      raise exception 'horario_vazio';
    end if;

  elsif p_etapa = 7 then
    if coalesce(jsonb_typeof(d->'metodos'), '') <> 'array' then
      raise exception 'metodos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'metodos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['dinheiro', 'debito', 'credito', 'pix']::text[]) then
      raise exception 'metodos_invalidos';
    end if;
    update public.barracas set metodos_pagamento_ativos = to_jsonb(v_lista) where id = p_barraca_id;

  elsif p_etapa = 8 then
    if coalesce(jsonb_typeof(d->'modos'), '') <> 'array' then
      raise exception 'modos_invalidos';
    end if;
    select coalesce(array_agg(distinct x), '{}') into v_lista from jsonb_array_elements_text(d->'modos') x;
    if cardinality(v_lista) < 1 or not (v_lista <@ array['mesa', 'balcao', 'retirada', 'entrega']::text[]) then
      raise exception 'modos_invalidos';
    end if;
    update public.barracas set modos_atendimento = v_lista where id = p_barraca_id;

  elsif p_etapa = 9 then
    update public.barracas set
      taxa_entrega_habilitada = case when d ? 'habilitada' then coalesce((d->>'habilitada')::boolean, false) else taxa_entrega_habilitada end,
      taxa_entrega_centavos = case when d ? 'centavos' then least(greatest(coalesce((d->>'centavos')::integer, 0), 0), 99999999) else taxa_entrega_centavos end
    where id = p_barraca_id;

  elsif p_etapa = 10 then
    -- Conclui só se os 4 obrigatórios estão de fato preenchidos (conferido no banco, não no cliente).
    if not exists (select 1 from public.horarios_funcionamento where barraca_id = p_barraca_id and aberto)
       or not exists (select 1 from public.barracas where id = p_barraca_id and jsonb_array_length(coalesce(metodos_pagamento_ativos, '[]'::jsonb)) >= 1 and cardinality(modos_atendimento) >= 1) then
      raise exception 'obrigatorios_pendentes';
    end if;
    update public.barracas set onboarding_concluido_em = coalesce(onboarding_concluido_em, now()) where id = p_barraca_id;
  end if;

  update public.barracas set onboarding_etapa = greatest(onboarding_etapa, p_etapa::smallint) where id = p_barraca_id;
  select onboarding_concluido_em into v_concluido from public.barracas where id = p_barraca_id;
  return jsonb_build_object('etapa', p_etapa, 'concluido', v_concluido is not null);
end;
$$;

-- 9) Situação para o checklist do Hub: só booleanos/etapa, calculados no banco (1 chamada em vez de 8).
create or replace function public.onboarding_progresso(p_barraca_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas;
  v_entrega boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  select * into b from public.barracas where id = p_barraca_id;
  if not found then
    raise exception 'sem acesso a esta barraca';
  end if;
  v_entrega := 'entrega' = any (b.modos_atendimento);
  return jsonb_build_object(
    'etapa', b.onboarding_etapa,
    'concluido', b.onboarding_concluido_em is not null,
    'checklist_oculto_ate', b.checklist_oculto_ate,
    'horario', exists (select 1 from public.horarios_funcionamento h where h.barraca_id = b.id and h.aberto),
    'pagamento', jsonb_array_length(coalesce(b.metodos_pagamento_ativos, '[]'::jsonb)) >= 1,
    'modos', cardinality(b.modos_atendimento) >= 1,
    'item', exists (select 1 from public.itens i where i.barraca_id = b.id),
    'endereco', coalesce(b.endereco_rua, '') <> '' and coalesce(b.endereco_numero, '') <> '' and coalesce(b.endereco_cidade, '') <> '',
    'cnpj', b.cnpj is not null or b.sem_cnpj,
    'entrega_ativa', v_entrega,
    'taxa', case when v_entrega then
      (b.taxa_entrega_habilitada and b.taxa_entrega_centavos > 0)
      or exists (select 1 from public.taxas_entrega_bairro t where t.barraca_id = b.id and t.ativo)
      else null end,
    'pix_online', b.pagamento_online_habilitado and exists (select 1 from public.barracas_pagamento_token k where k.barraca_id = b.id),
    'logo', b.logo_url is not null
  );
end;
$$;

-- 10) Ocultar o checklist por 7 dias (só o dono).
create or replace function public.onboarding_ocultar_checklist(p_barraca_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  update public.barracas set checklist_oculto_ate = now() + interval '7 days'
   where id = p_barraca_id
     and exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono');
  if not found then
    raise exception 'sem acesso a esta barraca';
  end if;
end;
$$;

-- 11) Evento de telemetria (sem texto livre).
create or replace function public.onboarding_evento(p_barraca_id uuid, p_passo integer, p_acao text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_barraca_id is not null and not public.usuario_tem_acesso_barraca(p_barraca_id) then
    raise exception 'sem acesso a esta barraca';
  end if;
  insert into public.onboarding_eventos (barraca_id, usuario_id, passo, acao)
  values (p_barraca_id, auth.uid(), p_passo::smallint, p_acao);
end;
$$;

-- Só usuário autenticado executa (nada para anon).
do $$
declare
  f text;
begin
  foreach f in array array[
    'slug_reservado(text)',
    'slug_disponivel(text)',
    'onboarding_salvar_origem(text, text, text)',
    'onboarding_salvar_passo(uuid, integer, jsonb)',
    'onboarding_progresso(uuid)',
    'onboarding_ocultar_checklist(uuid)',
    'onboarding_evento(uuid, integer, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
