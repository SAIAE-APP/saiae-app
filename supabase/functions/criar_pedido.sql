-- Versão v2 (Fase 4): aceita entrega_direta por item + pedido
-- 100% entrega direta vai direto pro Histórico
--
-- Mudanças em relação à versão v1:
-- 1. Aceita campo `entrega_direta` (boolean) no JSON de cada item
-- 2. Persiste esse campo em itens_do_pedido
-- 3. Marca itens com entrega_direta=true como entregues no ato
--    (entregue = true, entregue_em = now())
-- 4. Se TODOS os itens são entrega_direta, o pedido nasce direto
--    com status='entregue' + pronto_em + entregue_em preenchidos
--    (não aparece em Cozinha nem Chamada, vai direto pro Histórico)
-- 5. Nesse caso, o trigger set_senha_pedido pula geração de senha
--    e deixa senha=NULL (não precisa chamar cliente)
--
-- IMPORTANTE: p_client_uuid é `text`, não `uuid`. A coluna
-- pedidos.client_uuid no banco é text — mantido pra bater com o
-- código do frontend, que sempre enviou string.
--
-- v3 (2026-09-18): aceita `observacao` (text) por item em p_itens, além
-- do p_observacao geral do pedido que já existia — ver migração
-- 20260918130000_add_observacao_item_pedido.sql.
--
-- v4 (2026-09-27): grava barraca_id em cada item (mesmo p_barraca_id do
-- pedido pai) — ver migração 20260927120000_add_barraca_id_itens_pedido.sql.
-- Corrige a única tabela sem barraca_id do projeto, o que permite filtrar
-- a subscription Realtime de itens_do_pedido no servidor em vez de
-- transmitir toda mudança de item de qualquer barraca pra todo cliente
-- conectado (useRealtimePedidos.ts).

--
-- v5 (2026-10-04): aceita p_tipo_atendimento (opcional, default NULL) e grava
-- em pedidos.tipo_atendimento — ver migração 20261004120000_modos_atendimento.sql.
-- Aquela migração derruba a assinatura de 7 args; chamadas com 7 args seguem
-- resolvendo nesta (o 8º tem default).
-- v6 (2026-10-04): aceita p_entrega (jsonb: nome, telefone, rua, numero,
-- bairro, referencia) e p_taxa_entrega_centavos e grava em pedidos.entrega_* e
-- pedidos.taxa_entrega_centavos — ver migração 20261004140000_criar_pedido_v6_entrega.sql.
-- Aquela migração derruba a assinatura de 8 args.
-- v7 (2026-10-06): aceita p_cliente_nome (opcional, todos os modos) e grava em
-- pedidos.cliente_nome — ver migração 20261006120000_criar_pedido_v7_cliente_nome.sql.
-- Aquela migração derruba a assinatura de 10 args.
-- v8 (2026-10-08): aceita p_cliente_telefone (opcional, só pra avisar "pedido pronto")
-- e grava em pedidos.cliente_telefone — ver 20261008120000_aviso_pedido_pronto.sql.
-- Aquela migração derruba a assinatura de 11 args.

CREATE OR REPLACE FUNCTION public.criar_pedido(
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
    coalesce(nullif(trim(p_cliente_nome), ''), nullif(trim(p_entrega->>'nome'), '')),
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