-- Rollback: drop function public.whatsapp_avisos_salvar(uuid, jsonb);
--           alter table public.barracas drop constraint if exists barracas_whatsapp_avisos_objeto, drop column if exists whatsapp_avisos;
--           e reaplicar a definição de montar_evento_saida de 20261018130000_evento_cupom.sql.
-- Avisos de status por WhatsApp (fase 1): configuração por barraca + `data.avisos` nos eventos `order.*`.
-- `avisos` é anexado DEPOIS do jsonb_strip_nulls para não perder `"texto": null` (= usar o texto padrão).
-- Partindo da definição mais recente de montar_evento_saida (20261018130000); mesma assinatura e grants.
alter table public.barracas add column if not exists whatsapp_avisos jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barracas_whatsapp_avisos_objeto') then
    alter table public.barracas
      add constraint barracas_whatsapp_avisos_objeto
      check (whatsapp_avisos is null or jsonb_typeof(whatsapp_avisos) = 'object');
  end if;
end $$;

create or replace function public.whatsapp_avisos_salvar(p_barraca_id uuid, p_avisos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_chave text;
  v_valor jsonb;
  v_campo text;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if not public.usuario_tem_acesso_barraca(p_barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;
  if p_avisos is null or jsonb_typeof(p_avisos) <> 'object' then
    return jsonb_build_object('estado', 'dados_invalidos');
  end if;
  for v_chave, v_valor in select * from jsonb_each(p_avisos) loop
    if v_chave not in ('recebido', 'pronto', 'saiu_entrega', 'entregue', 'cancelado')
       or jsonb_typeof(v_valor) <> 'object'
       or jsonb_typeof(v_valor -> 'ativo') is distinct from 'boolean'
       or coalesce(jsonb_typeof(v_valor -> 'texto'), 'null') not in ('null', 'string')
       or char_length(coalesce(v_valor ->> 'texto', '')) > 500 then
      return jsonb_build_object('estado', 'dados_invalidos');
    end if;
    for v_campo in select jsonb_object_keys(v_valor) loop
      if v_campo not in ('ativo', 'texto') then
        return jsonb_build_object('estado', 'dados_invalidos');
      end if;
    end loop;
  end loop;
  update public.barracas set whatsapp_avisos = p_avisos where id = p_barraca_id;
  return jsonb_build_object('estado', 'ok');
end;
$fn$;

revoke all on function public.whatsapp_avisos_salvar(uuid, jsonb) from public, anon;
grant execute on function public.whatsapp_avisos_salvar(uuid, jsonb) to authenticated;

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
  v_desconto integer;
  v_avisos jsonb;
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

  select nome, whatsapp_avisos into v_barraca_nome, v_avisos from public.barracas where id = p.barraca_id;
  v_taxa := coalesce(p.taxa_entrega_centavos, 0);
  v_desconto := coalesce(p.desconto_cupom_centavos, 0);
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
      -- Com cupom, o total é o que o cliente pagou (itens − desconto + taxa). Sem cupom, a conta de sempre.
      'total_centavos', v_soma - v_desconto + v_taxa,
      'cupom_codigo', case when v_desconto > 0 then p.cupom_codigo end,
      'desconto_cupom_centavos', case when v_desconto > 0 then v_desconto end,
      'metodo_pagamento', p.metodo_pagamento,
      'cliente', case when v_cliente = '{}'::jsonb then null else v_cliente end
    )) || case
      when e.tipo like 'order.%' and v_avisos is not null then jsonb_build_object('avisos', v_avisos)
      else '{}'::jsonb
    end
  );
end;
$function$;
