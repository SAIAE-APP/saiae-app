-- SAI-010b: o link do entregador (/e/:token) passa a mostrar as opções de cada item (variação e
-- adicionais). Só os NOMES das opções vão ao entregador (sem preço, sem ids). Resto da função
-- idêntico à 20261006150000; assinatura e grants não mudam. Depende de 20261015100000
-- (coluna itens_do_pedido.opcoes). Rollback: recriar a função da 20261006150000.
create or replace function public.entregador_pedido(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_barraca text;
  v_itens jsonb;
  v_total_itens integer;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('estado', 'invalido');
  end if;
  if public._entregador_bloqueado() then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  select * into v_pedido from public.pedidos where entrega_token = p_token;
  if not found then
    perform public._entregador_registrar_falha();
    return jsonb_build_object('estado', 'invalido');
  end if;

  select nome into v_barraca from public.barracas where id = v_pedido.barraca_id;

  if v_pedido.entrega_confirmada_em is not null or v_pedido.status = 'entregue' then
    return jsonb_build_object('estado', 'ja_confirmado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;
  if v_pedido.status = 'cancelado' then
    return jsonb_build_object('estado', 'cancelado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;
  if v_pedido.criado_em < now() - interval '24 hours' then
    return jsonb_build_object('estado', 'expirado', 'senha', v_pedido.senha, 'barraca_nome', v_barraca);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'nome_item', i.nome_item,
      'quantidade', i.quantidade,
      'observacao', i.observacao,
      'opcoes', coalesce((
        select jsonb_agg(o.value ->> 'nome')
        from jsonb_array_elements(case when jsonb_typeof(i.opcoes) = 'array' then i.opcoes else '[]'::jsonb end) o
        where jsonb_typeof(o.value) = 'object' and coalesce(o.value ->> 'nome', '') <> ''
      ), '[]'::jsonb)
    )), '[]'::jsonb),
    coalesce(sum(i.quantidade * i.preco_centavos_unitario), 0)
  into v_itens, v_total_itens
  from public.itens_do_pedido i
  where i.pedido_id = v_pedido.id and not i.removido;

  return jsonb_build_object(
    'estado', 'ok',
    'senha', v_pedido.senha,
    'barraca_nome', v_barraca,
    'status', v_pedido.status,
    'cliente_nome', v_pedido.entrega_nome,
    'telefone', v_pedido.entrega_telefone,
    'rua', v_pedido.entrega_rua,
    'numero', v_pedido.entrega_numero,
    'bairro', v_pedido.entrega_bairro,
    'referencia', v_pedido.entrega_referencia,
    'observacao', v_pedido.observacao,
    'itens', v_itens,
    'taxa_entrega_centavos', coalesce(v_pedido.taxa_entrega_centavos, 0),
    'total_centavos', v_total_itens + coalesce(v_pedido.taxa_entrega_centavos, 0),
    'metodo_pagamento', v_pedido.metodo_pagamento,
    -- Só quem escolheu "pagar na entrega" tem o método definido pelo entregador;
    -- pedido já pago online (ou com método definido no balcão) não muda.
    'metodo_definivel', v_pedido.metodo_pagamento = 'na_entrega'
  );
end;
$$;

revoke all on function public.entregador_pedido(text) from public;
grant execute on function public.entregador_pedido(text) to anon, authenticated;
