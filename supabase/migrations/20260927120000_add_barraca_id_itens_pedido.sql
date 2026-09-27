-- itens_do_pedido era a única tabela sem barraca_id, quebrando a regra de
-- multi-tenant do projeto ("toda tabela tem barraca_id, toda query filtra
-- por ele" — ver CLAUDE.md). Na prática isso fazia a subscription Realtime
-- dessa tabela em useRealtimePedidos.ts não ter como filtrar no servidor:
-- toda mudança de item de QUALQUER barraca era transmitida pra TODO
-- cliente conectado no sistema inteiro, e descartada no client. Discutido
-- com o dono do produto em 2026-09-27 como correção de custo/escala antes
-- de crescer a base de clientes (o volume de mensagens Realtime cresce com
-- o quadrado do número de barracas ativas simultaneamente sem esse filtro).

alter table public.itens_do_pedido
  add column barraca_id uuid references public.barracas(id);

update public.itens_do_pedido i
   set barraca_id = p.barraca_id
  from public.pedidos p
 where p.id = i.pedido_id
   and i.barraca_id is null;

alter table public.itens_do_pedido
  alter column barraca_id set not null;

create index if not exists itens_do_pedido_barraca_id_idx
  on public.itens_do_pedido (barraca_id);

-- v4 de criar_pedido (ver supabase/functions/criar_pedido.sql): grava
-- barraca_id em cada item, usando o mesmo p_barraca_id do pedido pai.
CREATE OR REPLACE FUNCTION public.criar_pedido(
  p_barraca_id uuid,
  p_mesa text,
  p_viagem boolean,
  p_observacao text,
  p_client_uuid text,
  p_metodo_pagamento text,
  p_itens jsonb
)
RETURNS TABLE(pedido_id uuid, senha integer)
LANGUAGE plpgsql
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
