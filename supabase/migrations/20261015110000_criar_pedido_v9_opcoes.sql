-- SAI-010a, etapa 2: criar_pedido v9 = v8 + grava o snapshot das opções de cada item.
-- Spec: docs/superpowers/specs/2026-10-07-sai-010-adicionais-design.md (§3).
--
-- MESMA assinatura da v8 (12 args): sem DROP, sem sobrecarga, sem degrau novo no
-- useSincronizacao/PGRST202. As escolhas viajam em `p_itens[].opcoes` (jsonb); servidor sem
-- esta v9 ignora a chave, e o preço unitário final já vem somado (preco_centavos_unitario).
--
-- Operador e fila offline: o snapshot do aparelho vale, igual ao preço hoje; aqui só se
-- SANEIA (formato, tamanho, chaves conhecidas) e nunca se recusa. O caminho público e o Pix já
-- chegam resolvidos pelo resolver_carrinho. Item sem `opcoes` grava '[]' (comportamento de antes).
--
-- Depende de 20261015100000 (coluna itens_do_pedido.opcoes). Rollback: recriar a v8
-- (20261008120000_aviso_pedido_pronto.sql); a coluna e a função auxiliar ficam inertes.

-- Saneia o snapshot: só array de objetos válidos, até 20, apenas chaves conhecidas,
-- quantidade fixa em 1 na v1. Elemento malformado é descartado (nunca levanta erro).
create or replace function public.sanear_opcoes_pedido(p_opcoes jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.o order by x.ord), '[]'::jsonb)
    from (
      select e.ord,
             jsonb_build_object(
               'grupo_id', e.v ->> 'grupo_id',
               'grupo_nome', left(btrim(e.v ->> 'grupo_nome'), 60),
               'tipo', e.v ->> 'tipo',
               'opcao_id', e.v ->> 'opcao_id',
               'nome', left(btrim(e.v ->> 'nome'), 60),
               'preco_centavos', (e.v ->> 'preco_centavos')::integer,
               'quantidade', 1
             ) as o
        from jsonb_array_elements(
               case when jsonb_typeof(p_opcoes) = 'array' then p_opcoes else '[]'::jsonb end
             ) with ordinality as e(v, ord)
       where jsonb_typeof(e.v) = 'object'
         and (e.v ->> 'grupo_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (e.v ->> 'opcao_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (e.v ->> 'tipo') in ('variacao', 'adicional')
         and btrim(coalesce(e.v ->> 'nome', '')) <> ''
         and btrim(coalesce(e.v ->> 'grupo_nome', '')) <> ''
         and (e.v ->> 'preco_centavos') ~ '^[0-9]{1,8}$'
       order by e.ord
       limit 20
    ) x;
$$;

create or replace function public.criar_pedido(
  p_barraca_id uuid,
  p_mesa text,
  p_viagem boolean,
  p_observacao text,
  p_client_uuid text,
  p_metodo_pagamento text,
  p_itens jsonb,
  p_tipo_atendimento text default null,
  p_entrega jsonb default null,
  p_taxa_entrega_centavos integer default 0,
  p_cliente_nome text default null,
  p_cliente_telefone text default null
)
RETURNS TABLE(pedido_id uuid, senha integer)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
declare
  v_id uuid;
  v_senha int;
  v_item jsonb;
  v_entrega_direta boolean;
  v_total_itens int;
  v_itens_entrega_direta int;
  v_pedido_todo_entrega_direta boolean;
  v_telefone text := public.normalizar_telefone_aviso(p_cliente_telefone);
begin
  -- Idempotência via client_uuid (protege contra duplo toque)
  select p.id, p.senha into v_id, v_senha
    from pedidos p
   where p.client_uuid = p_client_uuid;
  if found then
    return query select v_id, v_senha;
    return;
  end if;

  -- Descobre se TODOS os itens são entrega direta
  select
    count(*)::int,
    count(*) filter (where coalesce((elem->>'entrega_direta')::boolean, false))::int
  into v_total_itens, v_itens_entrega_direta
  from jsonb_array_elements(p_itens) as elem;

  v_pedido_todo_entrega_direta := (v_total_itens > 0 and v_itens_entrega_direta = v_total_itens);

  insert into pedidos (
    barraca_id,
    mesa,
    viagem,
    tipo_atendimento,
    entrega_nome,
    entrega_telefone,
    entrega_rua,
    entrega_numero,
    entrega_bairro,
    entrega_referencia,
    taxa_entrega_centavos,
    cliente_nome,
    cliente_telefone,
    observacao,
    client_uuid,
    metodo_pagamento,
    status,
    pronto_em,
    entregue_em
  )
  values (
    p_barraca_id,
    p_mesa,
    p_viagem,
    p_tipo_atendimento,
    nullif(trim(p_entrega->>'nome'), ''),
    nullif(regexp_replace(coalesce(p_entrega->>'telefone', ''), '[^0-9]', '', 'g'), ''),
    nullif(trim(p_entrega->>'rua'), ''),
    nullif(trim(p_entrega->>'numero'), ''),
    nullif(trim(p_entrega->>'bairro'), ''),
    nullif(trim(p_entrega->>'referencia'), ''),
    greatest(coalesce(p_taxa_entrega_centavos, 0), 0),
    -- Nome opcional em qualquer modo; na Entrega cai no nome do formulário.
    coalesce(nullif(trim(p_cliente_nome), ''), nullif(trim(p_entrega->>'nome'), '')),
    -- Telefone opcional só pra avisar "pedido pronto"; inválido vira NULL (nunca derruba o pedido).
    v_telefone,
    p_observacao,
    p_client_uuid,
    p_metodo_pagamento,
    case when v_pedido_todo_entrega_direta then 'entregue' else 'a_fazer' end,
    case when v_pedido_todo_entrega_direta then now() else null end,
    case when v_pedido_todo_entrega_direta then now() else null end
  )
  returning id, pedidos.senha into v_id, v_senha;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_entrega_direta := coalesce((v_item->>'entrega_direta')::boolean, false);

    insert into itens_do_pedido (
      pedido_id,
      barraca_id,
      item_id,
      nome_item,
      quantidade,
      preco_centavos_unitario,
      entrega_direta,
      entregue,
      entregue_em,
      observacao,
      opcoes
    )
    values (
      v_id,
      p_barraca_id,
      (v_item->>'item_id')::uuid,
      v_item->>'nome_item',
      (v_item->>'quantidade')::int,
      coalesce((v_item->>'preco_centavos_unitario')::int, 0),
      v_entrega_direta,
      v_entrega_direta,
      case when v_entrega_direta then now() else null end,
      nullif(v_item->>'observacao', ''),
      -- v9: escolhas do cliente (snapshot). Sanitizado e NUNCA recusa: pedido da fila offline não falha por isso.
      public.sanear_opcoes_pedido(v_item->'opcoes')
    );
  end loop;

  return query select v_id, v_senha;
end;
$$;
-- Grants: create or replace mantém os da v8 (padrão do Postgres). Conferir depois de aplicar:
-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'criar_pedido';
