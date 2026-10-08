-- O evento de pedido passa a usar o nome e o telefone do PERFIL do cliente (clientes_finais, via pedidos.cliente_id)
-- quando o pedido não trouxe cliente_telefone/entrega_telefone. Sem isso, quem pede logado no cardápio não recebia aviso.
-- Aditiva: create or replace da mesma função, mesma assinatura; só muda como v_nome e v_tel são escolhidos.
CREATE OR REPLACE FUNCTION public.montar_evento_saida(p_evento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  e public.eventos_saida%rowtype;
  p public.pedidos%rowtype;
  v_itens jsonb;
  v_soma bigint;
  v_taxa integer;
  v_tel text;
  v_nome text;
  v_consente boolean;
  v_cliente jsonb;
  v_barraca_nome text;
begin
  select * into e from public.eventos_saida where id = p_evento_id;
  if not found then
    return null;
  end if;
  select * into p from public.pedidos where id = e.pedido_id;
  if not found then
    return null;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'nome', i.nome_item,
        'quantidade', i.quantidade,
        'preco_centavos', i.preco_centavos_unitario,
        'observacao', i.observacao,
        'opcoes', case when jsonb_typeof(i.opcoes) = 'array' and jsonb_array_length(i.opcoes) > 0 then i.opcoes else null end
      )) order by i.id
    ), '[]'::jsonb),
    coalesce(sum(i.quantidade::bigint * i.preco_centavos_unitario), 0)
  into v_itens, v_soma
  from public.itens_do_pedido i
  where i.pedido_id = p.id and not i.removido;

  select nome into v_barraca_nome from public.barracas where id = p.barraca_id;
  v_taxa := coalesce(p.taxa_entrega_centavos, 0);
  v_nome := nullif(btrim(coalesce(p.cliente_nome, p.entrega_nome, (select c.nome from public.clientes_finais c where c.id = p.cliente_id), '')), '');
  v_tel := coalesce(p.cliente_telefone, p.entrega_telefone, (select c.telefone from public.clientes_finais c where c.id = p.cliente_id));
  if v_tel is not null and v_tel !~ '^[0-9]{8,15}$' then
    v_tel := null;
  end if;

  v_consente := false;
  if v_tel is not null then
    select exists (
      select 1 from public.clientes_finais c
       where c.barraca_id = p.barraca_id and c.telefone = v_tel and c.consentimento_marketing_em is not null
    ) into v_consente;
  end if;

  v_cliente := jsonb_strip_nulls(jsonb_build_object(
    'nome', v_nome,
    'telefone', v_tel,
    'consentimento_contato', v_consente
  ));

  return jsonb_build_object(
    'id', e.id,
    'type', e.tipo,
    'version', 1,
    'occurred_at', to_char(e.ocorrido_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'barraca_id', e.barraca_id,
    'sequence', e.sequence,
    'data', jsonb_strip_nulls(jsonb_build_object(
      'pedido_id', p.id,
      'barraca_nome', v_barraca_nome,
      'senha', p.senha,
      'status', e.status_pedido,
      'tipo_atendimento', coalesce(
        p.tipo_atendimento,
        case when p.viagem then 'retirada' when coalesce(p.mesa, '') <> '' then 'mesa' else 'balcao' end
      ),
      'itens', v_itens,
      'taxa_entrega_centavos', v_taxa,
      'total_centavos', v_soma + v_taxa,
      'metodo_pagamento', p.metodo_pagamento,
      'cliente', case when v_cliente = '{}'::jsonb then null else v_cliente end
    ))
  );
end;
$function$;
