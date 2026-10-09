-- Kits iniciais por tipo de negócio (PR 1 de 6, banco). Spec: docs/superpowers/specs/2026-10-09-kits-iniciais-design.md
--
-- ADITIVA e reexecutável. Não recria cardapio_publico, resolver_carrinho nem criar_pedido.
-- O kit só INSERE (categorias, itens, grupos, opções e ligações) numa barraca com catálogo vazio, e nada nasce
-- vendável: item com ativo = false e preço 0; opção de variação e opção "precisa de preço" com ativo = false.
--
-- Rollback (antes de qualquer kit aplicado em produção):
--   drop function if exists public.onboarding_aplicar_kit(uuid, text, jsonb);
--   alter table public.itens drop column if exists kit_exemplo;
--   alter table public.barracas drop column if exists kit_aplicado_em, drop column if exists kit_aplicado, drop column if exists kit_elegivel;
--   alter table public.perfis_usuario drop constraint if exists perfis_usuario_kit_valido, drop column if exists kit_inicial;
--   (onboarding_salvar_origem e onboarding_progresso: reaplicar 20261020100000.)

-- 1) Escolha do kit (passo 2, antes de existir barraca): fica no usuário.
alter table public.perfis_usuario add column if not exists kit_inicial text;
alter table public.perfis_usuario drop constraint if exists perfis_usuario_kit_valido;
alter table public.perfis_usuario add constraint perfis_usuario_kit_valido check (
  kit_inicial is null or kit_inicial in
    ('feira', 'quermesse', 'lanchonete', 'acai', 'hamburgueria', 'pizzaria', 'pastelaria', 'pf', 'nenhum')
);

-- 2) Elegibilidade: barraca que JÁ existe nunca recebe kit (backfill false só na primeira execução);
-- barraca criada depois nasce elegível sem tocar em criar_barraca.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'barracas' and column_name = 'kit_elegivel'
  ) then
    alter table public.barracas add column kit_elegivel boolean not null default true;
    update public.barracas set kit_elegivel = false;
  end if;
end;
$$;
alter table public.barracas add column if not exists kit_aplicado text;
alter table public.barracas add column if not exists kit_aplicado_em timestamptz;

-- 3) Marca do que veio do kit (coluna com default constante: não reescreve a tabela).
alter table public.itens add column if not exists kit_exemplo boolean not null default false;

-- 4) Passo 2 grava também o kit escolhido. A assinatura de 3 argumentos sai (senão a chamada antiga ficaria ambígua).
drop function if exists public.onboarding_salvar_origem(text, text, text);
create or replace function public.onboarding_salvar_origem(p_origem text, p_detalhe text, p_categoria text, p_kit text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  -- Os CHECKs da tabela recusam valores fora da lista; vazio vira null (passo pulado) e null não apaga o que já existe.
  insert into public.perfis_usuario (usuario_id, origem_aquisicao, origem_detalhe, categoria_negocio, kit_inicial)
  values (
    auth.uid(),
    nullif(btrim(p_origem), ''),
    nullif(left(btrim(coalesce(p_detalhe, '')), 60), ''),
    nullif(btrim(p_categoria), ''),
    nullif(btrim(p_kit), '')
  )
  on conflict (usuario_id) do update set
    origem_aquisicao = coalesce(nullif(btrim(p_origem), ''), public.perfis_usuario.origem_aquisicao),
    origem_detalhe = coalesce(nullif(left(btrim(coalesce(p_detalhe, '')), 60), ''), public.perfis_usuario.origem_detalhe),
    categoria_negocio = coalesce(nullif(btrim(p_categoria), ''), public.perfis_usuario.categoria_negocio),
    kit_inicial = coalesce(nullif(btrim(p_kit), ''), public.perfis_usuario.kit_inicial),
    atualizado_em = now();
end;
$$;

-- 5) Aplicar o kit. Só o DONO. Valida TUDO antes de gravar (nada é gravado se algo estiver inválido) e grava numa
-- transação. Formato de p_conteudo:
--   { categorias: [{chave, nome}], grupos: [{chave, nome, tipo, obrigatorio, maximo, opcoes: [{nome, precisaPreco}]}],
--     itens: [{nome, categoria, grupos: [chave]}], opcoes_habilitado: boolean }
-- Estados: ok | ja_aplicado | nao_elegivel | catalogo_nao_vazio | dados_invalidos | sem_acesso | nao_autenticado.
create or replace function public.onboarding_aplicar_kit(p_barraca_id uuid, p_kit text, p_conteudo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb := coalesce(p_conteudo, '{}'::jsonb);
  b public.barracas;
  e jsonb;
  o jsonb;
  g jsonb;
  i jsonb;
  v_chaves text[];
  v_chave text;
  v_nome text;
  v_tipo text;
  v_min integer;
  v_max integer;
  v_texto text;
  v_var integer;
  v_cat_ids jsonb := '{}'::jsonb;
  v_grupo_ids jsonb := '{}'::jsonb;
  v_id uuid;
  v_ordem integer;
  v_ordem_o integer;
  v_item_id uuid;
  v_n_itens integer := 0;
  v_n_grupos integer := 0;
  v_liga boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not exists (
    select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id and papel = 'dono'
  ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  -- Uma aplicação por vez por barraca (duas chamadas simultâneas gravam uma vez só).
  perform pg_advisory_xact_lock(hashtextextended('kit:' || p_barraca_id::text, 0));
  select * into b from public.barracas where id = p_barraca_id for update;
  if not found then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if b.kit_aplicado_em is not null then
    return jsonb_build_object('estado', 'ja_aplicado');
  end if;
  if not b.kit_elegivel then
    return jsonb_build_object('estado', 'nao_elegivel');
  end if;
  if exists (select 1 from public.categorias where barraca_id = p_barraca_id)
     or exists (select 1 from public.itens where barraca_id = p_barraca_id)
     or exists (select 1 from public.grupos_opcoes where barraca_id = p_barraca_id) then
    return jsonb_build_object('estado', 'catalogo_nao_vazio');
  end if;

  -- ---- validação (sem gravar nada)
  if p_kit is null or p_kit not in ('feira', 'quermesse', 'lanchonete', 'acai', 'hamburgueria', 'pizzaria', 'pastelaria', 'pf')
     or jsonb_typeof(c) <> 'object'
     or jsonb_typeof(c -> 'categorias') is distinct from 'array'
     or jsonb_typeof(c -> 'itens') is distinct from 'array'
     or jsonb_typeof(c -> 'grupos') is distinct from 'array'
     or jsonb_array_length(c -> 'categorias') > 8
     or jsonb_array_length(c -> 'itens') not between 1 and 30
     or jsonb_array_length(c -> 'grupos') > 6 then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;

  -- categorias
  v_chaves := '{}';
  for e in select * from jsonb_array_elements(c -> 'categorias') loop
    v_chave := e ->> 'chave';
    v_nome := btrim(coalesce(e ->> 'nome', ''));
    if jsonb_typeof(e) <> 'object' or v_chave is null or v_chave !~ '^[a-z0-9_]{1,30}$' or v_chave = any (v_chaves)
       or v_nome = '' or char_length(v_nome) > 60 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_chaves := v_chaves || v_chave;
  end loop;
  -- grupos
  v_chaves := '{}';
  for g in select * from jsonb_array_elements(c -> 'grupos') loop
    v_chave := g ->> 'chave';
    v_nome := btrim(coalesce(g ->> 'nome', ''));
    v_tipo := g ->> 'tipo';
    if jsonb_typeof(g) <> 'object' or v_chave is null or v_chave !~ '^[a-z0-9_]{1,30}$' or v_chave = any (v_chaves)
       or v_nome = '' or char_length(v_nome) > 60 or v_tipo not in ('variacao', 'adicional')
       or jsonb_typeof(g -> 'opcoes') is distinct from 'array'
       or jsonb_array_length(g -> 'opcoes') not between 1 and 12 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    v_chaves := v_chaves || v_chave;
    v_texto := g ->> 'maximo';
    if v_texto is not null and (v_texto !~ '^[0-9]{1,2}$' or v_texto::integer not between 1 and 20) then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if v_tipo = 'adicional' and coalesce(g ->> 'obrigatorio', 'false') not in ('true', 'false') then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if v_tipo = 'adicional' and v_texto is not null and (case when g ->> 'obrigatorio' = 'true' then 1 else 0 end) > v_texto::integer then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    for o in select * from jsonb_array_elements(g -> 'opcoes') loop
      v_nome := btrim(coalesce(o ->> 'nome', ''));
      if jsonb_typeof(o) <> 'object' or v_nome = '' or char_length(v_nome) > 60
         or coalesce(o ->> 'precisaPreco', 'false') not in ('true', 'false') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end loop;
  end loop;

  -- itens: categoria existente, grupos existentes, no máximo uma variação por item
  for i in select * from jsonb_array_elements(c -> 'itens') loop
    v_nome := btrim(coalesce(i ->> 'nome', ''));
    if jsonb_typeof(i) <> 'object' or v_nome = '' or char_length(v_nome) > 60 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(c -> 'categorias') x where x ->> 'chave' = i ->> 'categoria'
    ) then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    if i ? 'grupos' then
      if jsonb_typeof(i -> 'grupos') <> 'array' or jsonb_array_length(i -> 'grupos') > 6 then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
      v_var := 0;
      for v_chave in select jsonb_array_elements_text(i -> 'grupos') loop
        select x ->> 'tipo' into v_tipo from jsonb_array_elements(c -> 'grupos') x where x ->> 'chave' = v_chave;
        if v_tipo is null then
          return jsonb_build_object('estado', 'dados_invalidos');
        end if;
        if v_tipo = 'variacao' then
          v_var := v_var + 1;
        end if;
      end loop;
      if v_var > 1 or (select count(distinct t) from jsonb_array_elements_text(i -> 'grupos') t) <> jsonb_array_length(i -> 'grupos') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end if;
  end loop;

  -- ---- gravação
  v_ordem := 0;
  for e in select * from jsonb_array_elements(c -> 'categorias') loop
    v_ordem := v_ordem + 1;
    insert into public.categorias (barraca_id, nome, ordem)
    values (p_barraca_id, btrim(e ->> 'nome'), v_ordem)
    returning id into v_id;
    v_cat_ids := v_cat_ids || jsonb_build_object(e ->> 'chave', v_id);
  end loop;

  v_ordem := 0;
  for g in select * from jsonb_array_elements(c -> 'grupos') loop
    v_ordem := v_ordem + 1;
    v_tipo := g ->> 'tipo';
    if v_tipo = 'variacao' then
      v_min := 1;
      v_max := 1;
    else
      v_min := case when g ->> 'obrigatorio' = 'true' then 1 else 0 end;
      v_max := (g ->> 'maximo')::integer;
    end if;
    insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas, ordem, ativo)
    values (p_barraca_id, btrim(g ->> 'nome'), v_tipo, v_min, v_max, v_ordem, true)
    returning id into v_id;
    v_grupo_ids := v_grupo_ids || jsonb_build_object(g ->> 'chave', v_id);
    v_n_grupos := v_n_grupos + 1;
    v_ordem_o := 0;
    for o in select * from jsonb_array_elements(g -> 'opcoes') loop
      v_ordem_o := v_ordem_o + 1;
      -- Nada que custe dinheiro (ou substitua o preço do item) nasce ativo: o dono preenche e ativa.
      insert into public.opcoes (grupo_id, barraca_id, nome, preco_centavos, ordem, ativo, esgotado)
      values (
        v_id, p_barraca_id, btrim(o ->> 'nome'), 0, v_ordem_o,
        not (v_tipo = 'variacao' or coalesce(o ->> 'precisaPreco', 'false') = 'true'),
        false
      );
    end loop;
  end loop;

  v_ordem := 0;
  for i in select * from jsonb_array_elements(c -> 'itens') loop
    v_ordem := v_ordem + 1;
    insert into public.itens (barraca_id, nome, preco_centavos, ativo, ordem, categoria_id, kit_exemplo)
    values (
      p_barraca_id, btrim(i ->> 'nome'), 0, false, v_ordem,
      (v_cat_ids ->> (i ->> 'categoria'))::uuid, true
    )
    returning id into v_item_id;
    v_n_itens := v_n_itens + 1;
    v_ordem_o := 0;
    if i ? 'grupos' then
      for v_chave in select jsonb_array_elements_text(i -> 'grupos') loop
        v_ordem_o := v_ordem_o + 1;
        insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem)
        values (v_item_id, (v_grupo_ids ->> v_chave)::uuid, p_barraca_id, v_ordem_o);
      end loop;
    end if;
  end loop;

  -- Liga "Opções" só se o kit usa grupos (e só se a loja ainda não tinha ligado).
  v_liga := coalesce(c ->> 'opcoes_habilitado', 'false') = 'true' and v_n_grupos > 0;
  update public.barracas
     set kit_aplicado = p_kit,
         kit_aplicado_em = now(),
         opcoes_habilitado = opcoes_habilitado or v_liga
   where id = p_barraca_id;

  return jsonb_build_object('estado', 'ok', 'itens', v_n_itens, 'grupos', v_n_grupos, 'opcoes_habilitado', v_liga);
end;
$$;

-- 6) Progresso do checklist: duas chaves novas (contagem e booleano) e "item" ignora item de kit ainda sem preço.
create or replace function public.onboarding_progresso(p_barraca_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  b public.barracas;
  v_entrega boolean;
  v_kit_inicial text;
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
  select p.kit_inicial into v_kit_inicial from public.perfis_usuario p where p.usuario_id = auth.uid();
  return jsonb_build_object(
    'etapa', b.onboarding_etapa,
    'concluido', b.onboarding_concluido_em is not null,
    'checklist_oculto_ate', b.checklist_oculto_ate,
    'horario', exists (select 1 from public.horarios_funcionamento h where h.barraca_id = b.id and h.aberto),
    'pagamento', jsonb_array_length(coalesce(b.metodos_pagamento_ativos, '[]'::jsonb)) >= 1,
    'modos', cardinality(b.modos_atendimento) >= 1,
    'item', exists (select 1 from public.itens i where i.barraca_id = b.id and not (i.kit_exemplo and i.preco_centavos = 0)),
    'endereco', coalesce(b.endereco_rua, '') <> '' and coalesce(b.endereco_numero, '') <> '' and coalesce(b.endereco_cidade, '') <> '',
    'cnpj', b.cnpj is not null or b.sem_cnpj,
    'entrega_ativa', v_entrega,
    'taxa', case when v_entrega then
      (b.taxa_entrega_habilitada and b.taxa_entrega_centavos > 0)
      or exists (select 1 from public.taxas_entrega_bairro t where t.barraca_id = b.id and t.ativo)
      else null end,
    'pix_online', b.pagamento_online_habilitado and exists (select 1 from public.barracas_pagamento_token k where k.barraca_id = b.id),
    'logo', b.logo_url is not null,
    'kit_precos_pendentes', (select count(*) from public.itens i where i.barraca_id = b.id and i.kit_exemplo and i.preco_centavos = 0),
    'kit_oferta', b.kit_elegivel and b.kit_aplicado_em is null
      and v_kit_inicial is distinct from 'nenhum'
      and not exists (select 1 from public.categorias x where x.barraca_id = b.id)
      and not exists (select 1 from public.itens x where x.barraca_id = b.id)
      and not exists (select 1 from public.grupos_opcoes x where x.barraca_id = b.id)
  );
end;
$$;

-- Só usuário autenticado executa (nada para anon).
do $$
declare
  f text;
begin
  foreach f in array array[
    'onboarding_salvar_origem(text, text, text, text)',
    'onboarding_aplicar_kit(uuid, text, jsonb)',
    'onboarding_progresso(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
