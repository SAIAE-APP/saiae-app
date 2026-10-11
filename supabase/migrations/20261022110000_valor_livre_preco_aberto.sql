-- Valor livre ("Preço aberto"), PR 1/4: coluna + cardápio digital que nunca oferece nem aceita o item.
-- Spec: docs/superpowers/specs/2026-10-19-valor-livre-design.md (seções 3 e 7).
--
-- ADITIVA. `itens.preco_aberto` nasce false: nenhuma loja muda de comportamento até o dono ligar
-- (PR 2). `criar_pedido` NÃO muda (o operador já manda o preço no payload).
-- Regra de segurança central: o item de preço aberto NUNCA vai ao cardápio público
-- (`cardapio_publico` o oculta) e o `resolver_carrinho` o recusa, senão o cliente digitaria o preço.
--
-- Rollback (só se nenhum item tiver preco_aberto = true; linhas de pedido já gravadas não dependem da coluna):
--   restaurar cardapio_publico (20261006140000) e resolver_carrinho (20261015100000), depois
--   alter table public.itens drop constraint if exists itens_preco_aberto_coerente;
--   alter table public.itens drop column if exists preco_aberto;

alter table public.itens
  add column if not exists preco_aberto boolean not null default false;

-- Preço de reserva visível em R$ 0,00 e sem controle de estoque (spec seções 2 e 4).
alter table public.itens drop constraint if exists itens_preco_aberto_coerente;
alter table public.itens
  add constraint itens_preco_aberto_coerente
  check (not preco_aberto or (preco_centavos = 0 and estoque_qtd is null));

-- cardapio_publico: igual à 20261006140000, mais "and not i.preco_aberto" no join dos itens.
create or replace function public.cardapio_publico(p_slug text)
returns table(
  barraca_id uuid,
  barraca_nome text,
  barraca_logo_url text,
  barraca_imagem_capa_url text,
  pagamento_online_habilitado boolean,
  barraca_modos_atendimento text[],
  item_id uuid,
  item_nome text,
  item_descricao text,
  item_foto_url text,
  item_preco_centavos int,
  item_esgotado boolean,
  item_popular boolean,
  categoria_nome text,
  categoria_ordem int,
  item_ordem int,
  pedidos_30d int,
  barraca_whatsapp_pedidos text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    b.id,
    b.nome,
    b.logo_url,
    b.imagem_capa_url,
    b.pagamento_online_habilitado,
    b.modos_atendimento,
    i.id,
    i.nome,
    i.descricao,
    i.foto_url,
    i.preco_centavos,
    i.esgotado,
    i.popular,
    c.nome,
    c.ordem,
    i.ordem,
    coalesce(pop.total, 0)::int,
    case when b.pagar_na_entrega_habilitado then b.whatsapp_pedidos else null end
  from barracas b
  join itens i on i.barraca_id = b.id and i.ativo = true and not i.preco_aberto
  left join categorias c on c.id = i.categoria_id
  left join (
    select ip.item_id, sum(ip.quantidade) as total
    from itens_do_pedido ip
    join pedidos p on p.id = ip.pedido_id
    where p.barraca_id = (select id from barracas where slug = p_slug)
      and p.status != 'cancelado'
      and p.criado_em >= now() - interval '30 days'
      and ip.removido = false
    group by ip.item_id
  ) pop on pop.item_id = i.id
  where b.slug = p_slug
  order by c.ordem nulls last, i.ordem;
$$;

grant execute on function public.cardapio_publico(text) to anon, authenticated;

-- resolver_carrinho: igual à 20261015100000, mais a recusa do item de preço aberto.
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
      if coalesce(v_linha ->> 'quantidade', '') !~ '^[0-9]{1,3}$'
         or (v_linha ->> 'quantidade')::integer not between 1 and 99 then
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
      elsif v_item.preco_aberto then
        -- Valor livre é só do operador no balcão: o cliente final digitaria o próprio preço.
        v_cod := 'item_indisponivel';
        v_msg := v_item.nome || ' não está disponível no cardápio digital.';
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
      -- A observação vai para a comanda ESC/POS: sem caracteres de controle nem quebras de linha.
      v_obs := nullif(left(btrim(regexp_replace(
        coalesce(v_linha ->> 'observacao', ''),
        '[[:cntrl:][:space:]' || chr(8232) || chr(8233) || ']+', ' ', 'g')), 120), '');
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

revoke all on function public.resolver_carrinho(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.resolver_carrinho(uuid, jsonb) to service_role;
