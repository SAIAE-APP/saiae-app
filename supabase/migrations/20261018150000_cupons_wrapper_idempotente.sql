-- Cupons v2 — re-revisão (aorus-19) do #92.
--  I1  criar_pedido_com_cupom: se o pedido já existia (mesmo client_uuid) e já tem cupom gravado, o uso NOVO
--      é liberado em vez de confirmado: uma compra conta um uso só.
--  S3  uso inexistente ou de outra loja vira erro (a transação desfaz tudo), nunca "pedido sem desconto".
-- Rollback: recriar a função da 20261018140000.

create or replace function public.criar_pedido_com_cupom(
  p_uso_id uuid,
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
) returns table(pedido_id uuid, senha integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido uuid;
  v_senha integer;
  v_ja_tem_cupom boolean;
begin
  if not exists (select 1 from public.cupom_usos where id = p_uso_id and barraca_id = p_barraca_id) then
    raise exception 'Uso de cupom inexistente para esta loja';
  end if;

  select r.pedido_id, r.senha into v_pedido, v_senha
    from public.criar_pedido(
      p_barraca_id, p_mesa, p_viagem, p_observacao, p_client_uuid, p_metodo_pagamento, p_itens,
      p_tipo_atendimento, p_entrega, p_taxa_entrega_centavos, p_cliente_nome, p_cliente_telefone
    ) r;

  -- Reenvio do mesmo client_uuid: criar_pedido devolve o pedido que já existe. Se aquele pedido já foi
  -- confirmado com cupom, este uso novo não pode contar de novo.
  select (cupom_id is not null) into v_ja_tem_cupom from public.pedidos where id = v_pedido;
  if coalesce(v_ja_tem_cupom, false) then
    update public.cupom_usos set estado = 'liberado' where id = p_uso_id and estado = 'reservado';
  else
    perform public.cupom_confirmar(p_uso_id, v_pedido);
  end if;
  return query select v_pedido, v_senha;
end;
$$;
revoke all on function public.criar_pedido_com_cupom(uuid, uuid, text, boolean, text, text, text, jsonb, text, jsonb, integer, text, text) from public, anon, authenticated;
grant execute on function public.criar_pedido_com_cupom(uuid, uuid, text, boolean, text, text, text, jsonb, text, jsonb, integer, text, text) to service_role;
