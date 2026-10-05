-- v6 de criar_pedido: aceita os dados de entrega (p_entrega jsonb) e a taxa
-- de entrega cobrada (p_taxa_entrega_centavos), e grava nas colunas de
-- pedidos criadas em 20261004130000_entrega_taxa_clientes.sql.
--
-- p_entrega: {nome, telefone, rua, numero, bairro, referencia} ou NULL.
-- Parte da v5 (8 args) de 20261004120000_modos_atendimento.sql. A assinatura
-- de 8 args sai pra não ficar sobrecarga ambígua com a de 10 (os 2 novos têm
-- default): quem chama com 7 ou 8 args continua resolvendo na função nova.
-- Sem SECURITY DEFINER (igual à v5): a RLS segue valendo.

drop function if exists public.criar_pedido(uuid, text, boolean, text, text, text, jsonb, text);

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
  p_taxa_entrega_centavos integer default 0
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
      observacao
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
      nullif(v_item->>'observacao', '')
    );
  end loop;

  return query select v_id, v_senha;
end;
$$;