-- Modos de atendimento configuráveis por barraca (Sprint 2 do backlog PDV):
-- Mesa, Balcão, Retirada (antigo "viagem") e Entrega. O lojista liga só o
-- que usa; a tela de Lançar mostra só os modos ativos.
--
-- Compatibilidade de propósito: `pedidos.viagem` continua existindo e
-- significando "não consome no local" (Retirada OU Entrega) — relatórios,
-- cozinha e o webhook do cardápio digital seguem funcionando sem mudança.
-- `tipo_atendimento` é o dado novo e mais fino; NULL em pedido antigo ou
-- criado por quem não manda o campo (cardápio digital), e o app deriva do
-- par mesa/viagem nesse caso (ver src/lib/atendimento.ts).

alter table public.barracas
  add column if not exists modos_atendimento text[] not null
    default array['mesa', 'balcao', 'retirada']::text[];

alter table public.barracas
  drop constraint if exists barracas_modos_atendimento_valido;
alter table public.barracas
  add constraint barracas_modos_atendimento_valido check (
    cardinality(modos_atendimento) >= 1
    and modos_atendimento <@ array['mesa', 'balcao', 'retirada', 'entrega']::text[]
  );

alter table public.pedidos
  add column if not exists tipo_atendimento text;

alter table public.pedidos
  drop constraint if exists pedidos_tipo_atendimento_valido;
alter table public.pedidos
  add constraint pedidos_tipo_atendimento_valido check (
    tipo_atendimento is null
    or tipo_atendimento in ('mesa', 'balcao', 'retirada', 'entrega')
  );

-- v5 de criar_pedido: aceita p_tipo_atendimento (opcional, default NULL).
-- A assinatura antiga (7 args) sai pra não ficar sobrecarga ambígua com a
-- nova (8 args, último com default): quem ainda chama com 7 args — fila
-- offline de aparelho desatualizado, webhook-mercadopago — continua
-- resolvendo na função nova.
drop function if exists public.criar_pedido(uuid, text, boolean, text, text, text, jsonb);

create or replace function public.criar_pedido(
  p_barraca_id uuid,
  p_mesa text,
  p_viagem boolean,
  p_observacao text,
  p_client_uuid text,
  p_metodo_pagamento text,
  p_itens jsonb,
  p_tipo_atendimento text default null
)
returns table(pedido_id uuid, senha integer)
language plpgsql
set search_path = public, pg_temp
as $$
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
