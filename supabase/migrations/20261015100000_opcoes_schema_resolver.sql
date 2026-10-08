-- SAI-010a, etapa 1: schema de adicionais/variações + resolver_carrinho.
-- Spec: docs/superpowers/specs/2026-10-07-sai-010-adicionais-design.md (PR #44).
-- Contrato: INTEGRACAO.md §3.1.
--
-- ADITIVA. Nada aqui muda criar_pedido (v9 vem na etapa 2), as edge functions nem o
-- app. Loja sem `opcoes_habilitado` (padrão false) continua com item plano.
--
-- Regras da v1 (decisão do dono + Frente A):
--   * tipo 'variacao': no máximo UM grupo por item, e nele min = max = 1; o preço da
--     opção é ABSOLUTO e substitui o preço base. Tipo 'adicional': preço é delta e
--     min/max livres (max NULL = sem limite).
--   * grupo obrigatório (min >= 1) sem nenhuma opção disponível => item NÃO pedível.
--   * sem quantidade por opção (o snapshot reserva o campo, fixo em 1).
--
-- Rollback (nada depende disto até a etapa 2):
--   drop function if exists public.resolver_carrinho(uuid, jsonb);
--   drop table if exists public.itens_grupos, public.opcoes, public.grupos_opcoes cascade;
--   drop function if exists public.itens_grupos_preencher(), public.grupos_opcoes_tipo_imutavel();
--   alter table public.itens_do_pedido drop constraint if exists itens_do_pedido_opcoes_valido;
--   alter table public.itens_do_pedido drop column if exists opcoes;
--   alter table public.barracas drop column if exists opcoes_habilitado;

-- 1) Flag de rollout por loja e snapshot das escolhas na linha do pedido.
alter table public.barracas
  add column if not exists opcoes_habilitado boolean not null default false;

alter table public.itens_do_pedido
  add column if not exists opcoes jsonb not null default '[]'::jsonb;

-- NOT VALID + VALIDATE: não segura lock forte na tabela quente de pedidos.
alter table public.itens_do_pedido
  drop constraint if exists itens_do_pedido_opcoes_valido;
alter table public.itens_do_pedido
  add constraint itens_do_pedido_opcoes_valido
  check (jsonb_typeof(opcoes) = 'array' and jsonb_array_length(opcoes) <= 20) not valid;
alter table public.itens_do_pedido validate constraint itens_do_pedido_opcoes_valido;

-- 2) Grupos de opções (reutilizáveis entre itens).
create table if not exists public.grupos_opcoes (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('variacao', 'adicional')),
  min_escolhas integer not null default 0,
  max_escolhas integer,
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  constraint grupos_opcoes_id_barraca_unico unique (id, barraca_id),
  constraint grupos_opcoes_nome_valido check (btrim(nome) <> '' and length(nome) <= 60),
  constraint grupos_opcoes_limites_validos check (
    min_escolhas between 0 and 20
    and (max_escolhas is null or (max_escolhas between 1 and 20 and max_escolhas >= min_escolhas))
  ),
  constraint grupos_opcoes_variacao_um_a_um check (
    tipo <> 'variacao' or (min_escolhas = 1 and coalesce(max_escolhas, 0) = 1)
  )
);

-- O tipo é imutável: itens_grupos guarda uma cópia dele para o índice de "uma variação por item".
create or replace function public.grupos_opcoes_tipo_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'O tipo do grupo (variação ou adicional) não pode mudar depois de criado.';
  end if;
  if new.barraca_id is distinct from old.barraca_id then
    raise exception 'O grupo não pode mudar de barraca.';
  end if;
  return new;
end;
$$;

drop trigger if exists grupos_opcoes_tipo_imutavel on public.grupos_opcoes;
create trigger grupos_opcoes_tipo_imutavel
  before update of tipo, barraca_id on public.grupos_opcoes
  for each row execute function public.grupos_opcoes_tipo_imutavel();

-- 3) Opções de cada grupo. barraca_id acompanha o do grupo (FK composta).
create table if not exists public.opcoes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  nome text not null,
  preco_centavos integer not null default 0,
  ordem integer not null default 0,
  ativo boolean not null default true,
  esgotado boolean not null default false,
  criado_em timestamptz not null default now(),
  constraint opcoes_grupo_fk foreign key (grupo_id, barraca_id)
    references public.grupos_opcoes (id, barraca_id) on delete cascade,
  constraint opcoes_nome_valido check (btrim(nome) <> '' and length(nome) <= 60),
  constraint opcoes_preco_valido check (preco_centavos between 0 and 99999999)
);

create index if not exists idx_opcoes_grupo on public.opcoes (grupo_id);

-- 4) Ligação item <-> grupo. `tipo` é copiado do grupo (trigger) para o índice parcial
-- garantir, à prova de corrida, no máximo UMA variação por item.
create table if not exists public.itens_grupos (
  item_id uuid not null references public.itens(id) on delete cascade,
  grupo_id uuid not null,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  tipo text not null,
  ordem integer not null default 0,
  primary key (item_id, grupo_id),
  constraint itens_grupos_grupo_fk foreign key (grupo_id, barraca_id)
    references public.grupos_opcoes (id, barraca_id) on delete cascade
);

create index if not exists idx_itens_grupos_grupo on public.itens_grupos (grupo_id);
create unique index if not exists itens_grupos_uma_variacao
  on public.itens_grupos (item_id) where tipo = 'variacao';

create or replace function public.itens_grupos_preencher()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select g.tipo into new.tipo
    from public.grupos_opcoes g
   where g.id = new.grupo_id and g.barraca_id = new.barraca_id;
  if new.tipo is null then
    raise exception 'Grupo de opções não encontrado nesta barraca.';
  end if;
  if not exists (select 1 from public.itens i where i.id = new.item_id and i.barraca_id = new.barraca_id) then
    raise exception 'O item não pertence a esta barraca.';
  end if;
  return new;
end;
$$;

drop trigger if exists itens_grupos_preencher on public.itens_grupos;
create trigger itens_grupos_preencher
  before insert or update of item_id, grupo_id, barraca_id on public.itens_grupos
  for each row execute function public.itens_grupos_preencher();

-- 5) RLS: mesmo padrão de taxas_entrega_bairro (dono/funcionário da barraca). Sem acesso
-- anon: o cardápio público lê pelo RPC próprio (etapa de cardápio), e a edge function
-- usa a chave de serviço.
do $$
declare
  t text;
begin
  foreach t in array array['grupos_opcoes', 'opcoes', 'itens_grupos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'usuarios veem ' || t || ' de suas barracas', t);
    execute format('drop policy if exists %I on public.%I', 'usuarios inserem ' || t || ' em suas barracas', t);
    execute format('drop policy if exists %I on public.%I', 'usuarios editam ' || t || ' de suas barracas', t);
    execute format('drop policy if exists %I on public.%I', 'usuarios deletam ' || t || ' de suas barracas', t);
    execute format('create policy %I on public.%I for select to authenticated using (usuario_tem_acesso_barraca(barraca_id))',
      'usuarios veem ' || t || ' de suas barracas', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (usuario_tem_acesso_barraca(barraca_id))',
      'usuarios inserem ' || t || ' em suas barracas', t);
    execute format('create policy %I on public.%I for update to authenticated using (usuario_tem_acesso_barraca(barraca_id)) with check (usuario_tem_acesso_barraca(barraca_id))',
      'usuarios editam ' || t || ' de suas barracas', t);
    execute format('create policy %I on public.%I for delete to authenticated using (usuario_tem_acesso_barraca(barraca_id))',
      'usuarios deletam ' || t || ' de suas barracas', t);
  end loop;
end;
$$;

-- 6) resolver_carrinho: fonte ÚNICA da regra de preço/validação (edge functions do cardápio
-- e do Pix, com a chave de serviço). O cliente manda só ids; preço, nome e total saem daqui.
--
-- Entrada: p_linhas = [{item_id, quantidade, opcao_ids: [uuid], observacao}] (1 a 40 linhas).
-- Saída (nunca levanta erro de negócio):
--   {"ok": true,  "linhas": [{item_id, nome_item, quantidade, preco_centavos_unitario,
--                             opcoes: [snapshot], observacao}], "total_centavos": n}
--   {"ok": false, "erros": [{linha, item_id, codigo, mensagem}]}   -- 1 erro por linha
-- Códigos: carrinho_invalido, barraca_invalida, item_invalido, quantidade_invalida,
--   item_indisponivel, opcoes_desabilitadas, muitas_opcoes, opcao_duplicada, opcao_invalida,
--   opcao_indisponivel, grupo_sem_opcao_disponivel, grupo_minimo, grupo_maximo, preco_invalido.
-- Loja com opcoes_habilitado = false se comporta como item plano (e recusa opcao_ids).
-- Estoque NÃO é tratado aqui (segue nas edge functions, por item_id x quantidade).
create or replace function public.resolver_carrinho(p_barraca_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_habilitado boolean;
  v_idx integer;
  v_linha jsonb;
  v_item public.itens%rowtype;
  v_item_id uuid;
  v_qtd integer;
  v_ids uuid[];
  v_ids_brutos jsonb;
  v_elem jsonb;
  v_n integer;
  v_vinculadas integer;
  v_disponiveis integer;
  v_opcoes jsonb;
  v_unit bigint;
  v_obs text;
  v_cod text;
  v_msg text;
  g record;
  v_linhas jsonb := '[]'::jsonb;
  v_erros jsonb := '[]'::jsonb;
  v_total bigint := 0;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array'
     or jsonb_array_length(p_linhas) = 0 or jsonb_array_length(p_linhas) > 40 then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array(jsonb_build_object(
      'linha', null, 'item_id', null, 'codigo', 'carrinho_invalido', 'mensagem', 'Carrinho inválido.')));
  end if;

  select b.opcoes_habilitado into v_habilitado from public.barracas b where b.id = p_barraca_id;
  if not found then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array(jsonb_build_object(
      'linha', null, 'item_id', null, 'codigo', 'barraca_invalida', 'mensagem', 'Barraca não encontrada.')));
  end if;

  for v_idx in 0 .. jsonb_array_length(p_linhas) - 1 loop
    v_linha := p_linhas -> v_idx;
    v_cod := null;
    v_msg := null;
    v_item_id := null;
    v_opcoes := '[]'::jsonb;
    v_ids := '{}';

    -- Forma da linha.
    if jsonb_typeof(v_linha) <> 'object' or coalesce(v_linha ->> 'item_id', '') !~ c_uuid then
      v_cod := 'item_invalido'; v_msg := 'Item inválido.';
    else
      v_item_id := (v_linha ->> 'item_id')::uuid;
      if coalesce(v_linha ->> 'quantidade', '') !~ '^[0-9]{1,5}$' or (v_linha ->> 'quantidade')::integer < 1 then
        v_cod := 'quantidade_invalida'; v_msg := 'Quantidade inválida.';
      else
        v_qtd := (v_linha ->> 'quantidade')::integer;
      end if;
    end if;

    -- opcao_ids: array de uuids distintos, até 20.
    if v_cod is null then
      v_ids_brutos := coalesce(v_linha -> 'opcao_ids', '[]'::jsonb);
      if jsonb_typeof(v_ids_brutos) <> 'array' then
        v_cod := 'opcao_invalida'; v_msg := 'Opções inválidas.';
      elsif jsonb_array_length(v_ids_brutos) > 20 then
        v_cod := 'muitas_opcoes'; v_msg := 'Opções demais neste item.';
      else
        for v_elem in select value from jsonb_array_elements(v_ids_brutos) loop
          if jsonb_typeof(v_elem) <> 'string' or (v_elem #>> '{}') !~ c_uuid then
            v_cod := 'opcao_invalida'; v_msg := 'Opções inválidas.';
            exit;
          end if;
          if (v_elem #>> '{}')::uuid = any(v_ids) then
            v_cod := 'opcao_duplicada'; v_msg := 'Opção repetida.';
            exit;
          end if;
          v_ids := v_ids || (v_elem #>> '{}')::uuid;
        end loop;
      end if;
    end if;

    -- Item do cadastro real, da barraca, ativo e não esgotado.
    if v_cod is null then
      select * into v_item from public.itens i where i.id = v_item_id and i.barraca_id = p_barraca_id;
      if not found or not v_item.ativo or v_item.esgotado then
        v_cod := 'item_indisponivel';
        v_msg := coalesce(v_item.nome, 'Item') || ' está indisponível.';
      end if;
    end if;

    if v_cod is null then
      v_n := coalesce(cardinality(v_ids), 0);
      v_unit := v_item.preco_centavos;

      if not v_habilitado then
        if v_n > 0 then
          v_cod := 'opcoes_desabilitadas'; v_msg := 'Esta loja não usa opções nos itens.';
        end if;
      else
        -- Escolhas existem, ligadas ao item por grupo ativo?
        select count(*) into v_vinculadas
          from public.opcoes o
          join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
          join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
         where o.id = any(v_ids) and o.barraca_id = p_barraca_id and gr.ativo;
        select count(*) into v_disponiveis
          from public.opcoes o
          join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
          join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
         where o.id = any(v_ids) and o.barraca_id = p_barraca_id and gr.ativo and o.ativo and not o.esgotado;

        if v_vinculadas < v_n then
          v_cod := 'opcao_invalida'; v_msg := 'Uma das opções não existe neste item.';
        elsif v_disponiveis < v_n then
          v_cod := 'opcao_indisponivel'; v_msg := 'Uma das opções escolhidas está indisponível.';
        end if;

        -- Regras por grupo (mínimo/máximo, grupo obrigatório sem opção disponível).
        if v_cod is null then
          for g in
            select gr.id, gr.nome, gr.min_escolhas, gr.max_escolhas,
                   (select count(*) from public.opcoes o
                     where o.grupo_id = gr.id and o.ativo and not o.esgotado) as disp,
                   (select count(*) from public.opcoes o
                     where o.grupo_id = gr.id and o.id = any(v_ids)) as escolhidas
              from public.itens_grupos ig
              join public.grupos_opcoes gr on gr.id = ig.grupo_id and gr.barraca_id = ig.barraca_id
             where ig.item_id = v_item.id and gr.ativo
             order by ig.ordem, gr.ordem, gr.id
          loop
            if g.min_escolhas >= 1 and g.disp = 0 then
              v_cod := 'grupo_sem_opcao_disponivel';
              v_msg := v_item.nome || ' está indisponível: "' || g.nome || '" não tem opção disponível.';
              exit;
            elsif g.escolhidas < g.min_escolhas then
              v_cod := 'grupo_minimo';
              v_msg := 'Escolha pelo menos ' || g.min_escolhas || ' em "' || g.nome || '".';
              exit;
            elsif g.max_escolhas is not null and g.escolhidas > g.max_escolhas then
              v_cod := 'grupo_maximo';
              v_msg := 'Escolha no máximo ' || g.max_escolhas || ' em "' || g.nome || '".';
              exit;
            end if;
          end loop;
        end if;

        -- Snapshot e preço: variação substitui o preço base; adicionais somam.
        if v_cod is null and v_n > 0 then
          select jsonb_agg(jsonb_build_object(
                   'grupo_id', gr.id, 'grupo_nome', gr.nome, 'tipo', gr.tipo,
                   'opcao_id', o.id, 'nome', o.nome, 'preco_centavos', o.preco_centavos, 'quantidade', 1)
                 order by ig.ordem, gr.ordem, gr.id, o.ordem, o.id)
            into v_opcoes
            from public.opcoes o
            join public.grupos_opcoes gr on gr.id = o.grupo_id and gr.barraca_id = o.barraca_id
            join public.itens_grupos ig on ig.grupo_id = gr.id and ig.item_id = v_item.id
           where o.id = any(v_ids) and o.barraca_id = p_barraca_id;

          select coalesce(
                   (select (e ->> 'preco_centavos')::bigint
                      from jsonb_array_elements(v_opcoes) e where e ->> 'tipo' = 'variacao' limit 1),
                   v_item.preco_centavos)
                 + coalesce((select sum((e ->> 'preco_centavos')::bigint)
                      from jsonb_array_elements(v_opcoes) e where e ->> 'tipo' = 'adicional'), 0)
            into v_unit;
        end if;
      end if;

      if v_cod is null and (v_unit <= 0 or v_unit > 99999999) then
        v_cod := case when v_unit <= 0 then 'item_indisponivel' else 'preco_invalido' end;
        v_msg := v_item.nome || ' está indisponível.';
      end if;
    end if;

    if v_cod is not null then
      v_erros := v_erros || jsonb_build_object(
        'linha', v_idx, 'item_id', v_item_id, 'codigo', v_cod, 'mensagem', v_msg);
    else
      v_obs := nullif(left(btrim(coalesce(v_linha ->> 'observacao', '')), 120), '');
      v_linhas := v_linhas || jsonb_build_object(
        'item_id', v_item.id,
        'nome_item', v_item.nome,
        'quantidade', v_qtd,
        'preco_centavos_unitario', v_unit,
        'opcoes', v_opcoes,
        'observacao', v_obs);
      v_total := v_total + v_unit * v_qtd;
    end if;
  end loop;

  if jsonb_array_length(v_erros) > 0 then
    return jsonb_build_object('ok', false, 'erros', v_erros);
  end if;
  return jsonb_build_object('ok', true, 'linhas', v_linhas, 'total_centavos', v_total);
end;
$$;

-- Interna: só as edge functions (papel de serviço). O app do operador usa snapshot do aparelho.
revoke all on function public.resolver_carrinho(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.resolver_carrinho(uuid, jsonb) to service_role;
