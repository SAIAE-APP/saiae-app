-- Operador define a forma de pagamento de um pedido "A definir na entrega".
--
-- Problema: pedido com metodo_pagamento = 'na_entrega' só ganha o método real
-- pelo link do entregador. Se o entregador nunca abrir o link (ou ele expirar,
-- 24h), o pedido fica 'na_entrega' para sempre e emitir-nfce recusa a nota.
--
-- Esta RPC deixa o operador (usuário autenticado com acesso à barraca) definir
-- o método. Regras:
--  * só ALTERA quando o método atual é 'na_entrega'; qualquer método já definido
--    nunca é sobrescrito (devolve 'ja_definido'); repetir o mesmo método é ok;
--  * só aceita dinheiro | debito | credito | pix (CHECK de pedidos já aceita
--    esses quatro + na_entrega: pedidos_metodo_pagamento_check);
--  * pedido cancelado não muda;
--  * registra quem e quando (colunas aditivas).
-- O entregador_confirmar continua intacto: ele só grava o método quando o atual é
-- 'na_entrega', então se o operador definir antes, o link NÃO sobrescreve.
--
-- ADITIVA: 2 colunas nullable + 1 função nova; nenhuma função existente muda.

alter table public.pedidos
  add column if not exists metodo_definido_em timestamptz,
  add column if not exists metodo_definido_por uuid;

create or replace function public.definir_metodo_pagamento(p_pedido_id uuid, p_metodo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if p_metodo is null or p_metodo not in ('dinheiro', 'debito', 'credito', 'pix') then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  select * into v_pedido from public.pedidos where id = p_pedido_id for update;

  -- Mesma resposta para "não existe" e "sem acesso": não revela pedido de outra barraca.
  if not found or not public.usuario_tem_acesso_barraca(v_pedido.barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  -- Idempotente: repetir o mesmo método (duplo toque, retry) não é erro.
  if v_pedido.metodo_pagamento = p_metodo then
    return jsonb_build_object('estado', 'ok', 'metodo', p_metodo);
  end if;

  if v_pedido.status = 'cancelado' then
    return jsonb_build_object('estado', 'cancelado');
  end if;

  -- Nunca sobrescreve um método já definido (inclusive o escolhido pelo entregador).
  if v_pedido.metodo_pagamento is distinct from 'na_entrega' then
    return jsonb_build_object('estado', 'ja_definido', 'metodo', v_pedido.metodo_pagamento);
  end if;

  update public.pedidos
     set metodo_pagamento = p_metodo,
         metodo_definido_em = now(),
         metodo_definido_por = auth.uid()
   where id = v_pedido.id;

  return jsonb_build_object('estado', 'ok', 'metodo', p_metodo);
end;
$$;

-- Supabase concede execute a anon por padrão em funções novas do schema public:
-- revoga explicitamente. Só usuário autenticado.
revoke all on function public.definir_metodo_pagamento(uuid, text) from public, anon;
grant execute on function public.definir_metodo_pagamento(uuid, text) to authenticated;
