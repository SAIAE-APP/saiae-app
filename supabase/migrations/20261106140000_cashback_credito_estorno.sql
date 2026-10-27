-- Cashback do cardápio digital, M5: crédito por pedido pago e reversão no estorno.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (§7.3, §7.4, §7.7). Só papel de serviço.
-- ADITIVA. O razão é só-inserção: este arquivo não faz update nem delete em cashback_lancamentos.
-- Rollback: drop function das duas funções abaixo; alter table public.pedidos drop column cashback_estornado_em.

-- Marca o pedido cujo estorno de cashback já foi processado. Sem isso, um estorno repetido, depois de um primeiro
-- estorno que não encontrou saldo para reverter (sem linha no razão), poderia levar um saldo ganho depois.
alter table public.pedidos add column if not exists cashback_estornado_em timestamptz;

-- Credita o cashback de um pedido pago online. Idempotente pelo índice único (um crédito por pedido).
-- Base = itens ativos − cupom − saldo usado (nunca entrega nem taxas). 0 = nada a creditar, sem linha no razão.
-- Falha aqui NUNCA deve derrubar o pedido: o chamador trata o erro (pagamento aprovado nunca é recusado).
-- SUPOSIÇÃO-CASHBACK-1 (spec §20.1): a barraca financia, o crédito sai do bolso dela.
-- SUPOSIÇÃO-CASHBACK-4 (spec §20.4): o saldo usado também sai da base, para não gerar saldo sobre saldo.
create or replace function public.cashback_creditar_pedido(p_pedido_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  b record;
  v_existente integer;
  v_itens bigint;
  v_base integer;
  v_credito integer;
begin
  select id, barraca_id, cliente_id, desconto_cupom_centavos, cashback_usado_centavos
    into p from public.pedidos where id = p_pedido_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'pedido_inexistente');
  end if;
  if p.cliente_id is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_cliente');
  end if;
  if not exists (
    select 1 from public.clientes_finais cf
     where cf.id = p.cliente_id and cf.barraca_id = p.barraca_id and cf.telefone_confirmado_em is not null
  ) then
    return jsonb_build_object('ok', false, 'erro', 'telefone_nao_confirmado');
  end if;

  -- Repetição (webhook reenviado): devolve o valor já gravado, sem checar o interruptor de hoje.
  select valor_centavos into v_existente from public.cashback_lancamentos
   where pedido_id = p_pedido_id and tipo = 'credito';
  if found then
    return jsonb_build_object('ok', true, 'credito_centavos', v_existente);
  end if;

  if not exists (
    select 1 from public.pagamentos_pendentes pp where pp.pedido_id = p_pedido_id and pp.status = 'aprovado'
  ) then
    return jsonb_build_object('ok', false, 'erro', 'nao_pago_online');
  end if;

  select cashback_habilitado, cashback_percentual_bp, cashback_validade_dias into b
    from public.barracas where id = p.barraca_id;
  if not coalesce(b.cashback_habilitado, false) then
    return jsonb_build_object('ok', false, 'erro', 'desligado');
  end if;

  perform public.cashback_travar(p.barraca_id, p.cliente_id);
  -- Saldo vencido e ainda não materializado vira expiração ANTES do crédito novo (que renova o prazo do saldo todo).
  perform public.cashback_expirar_se_vencido(p.barraca_id, p.cliente_id);

  select coalesce(sum(i.preco_centavos_unitario::bigint * i.quantidade), 0) into v_itens
    from public.itens_do_pedido i
   where i.pedido_id = p_pedido_id and coalesce(i.removido, false) = false;
  v_base := greatest(0, v_itens - p.desconto_cupom_centavos - p.cashback_usado_centavos)::integer;
  v_credito := public.cashback_calcular_credito(v_base, b.cashback_percentual_bp);
  if v_credito <= 0 then
    return jsonb_build_object('ok', true, 'credito_centavos', 0);
  end if;

  insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, expira_em)
  values (p.barraca_id, p.cliente_id, 'credito', v_credito, p_pedido_id, now() + make_interval(days => b.cashback_validade_dias))
  on conflict (pedido_id) where tipo = 'credito' do nothing;
  select valor_centavos into v_credito from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'credito';

  update public.pedidos set cashback_gerado_centavos = v_credito where id = p_pedido_id;
  return jsonb_build_object('ok', true, 'credito_centavos', v_credito);
end;
$$;

-- Estorno TOTAL do pagamento (único gatilho: estornar-pagamento). Idempotente.
--  1. Reverte o crédito do pedido até o saldo vigente atual (o que já foi gasto a barraca absorve; nunca negativo).
--  2. Devolve o que o resgate debitou do razão (não o excedente), com a validade renovada a partir de agora.
-- Cancelar sem estornar não chama esta função e não mexe no saldo.
create or replace function public.cashback_estornar_pedido(p_pedido_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v_credito integer;
  v_saldo integer;
  v_reverter integer := 0;
  v_debitado integer;
  v_dias integer;
begin
  select id, barraca_id, cliente_id, cashback_estornado_em into p from public.pedidos where id = p_pedido_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'pedido_inexistente');
  end if;
  if p.cliente_id is null then
    return jsonb_build_object('ok', true, 'credito_revertido_centavos', 0, 'saldo_devolvido_centavos', 0);
  end if;

  perform public.cashback_travar(p.barraca_id, p.cliente_id);
  -- Repetição: devolve o que já foi gravado.
  if p.cashback_estornado_em is not null then
    return jsonb_build_object(
      'ok', true,
      'credito_revertido_centavos', coalesce((select -sum(valor_centavos) from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'estorno_credito'), 0),
      'saldo_devolvido_centavos', coalesce((select sum(valor_centavos) from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'estorno_resgate'), 0)
    );
  end if;

  -- Antes de qualquer lançamento com validade nova: o estorno do resgate renovaria um saldo vencido.
  perform public.cashback_expirar_se_vencido(p.barraca_id, p.cliente_id);

  select valor_centavos into v_credito from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'credito';
  if found then
    select s.saldo_centavos into v_saldo from public.cashback_saldo(p.barraca_id, p.cliente_id) s;
    v_reverter := least(v_credito, coalesce(v_saldo, 0));
    if v_reverter > 0 then
      insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id)
      values (p.barraca_id, p.cliente_id, 'estorno_credito', -v_reverter, p_pedido_id)
      on conflict (pedido_id, tipo) where tipo in ('estorno_credito', 'estorno_resgate') do nothing;
    end if;
  end if;

  select coalesce(-sum(valor_centavos), 0)::integer into v_debitado
    from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'resgate';
  if v_debitado > 0 then
    select cashback_validade_dias into v_dias from public.barracas where id = p.barraca_id;
    insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, expira_em)
    values (p.barraca_id, p.cliente_id, 'estorno_resgate', v_debitado, p_pedido_id, now() + make_interval(days => coalesce(v_dias, 60)))
    on conflict (pedido_id, tipo) where tipo in ('estorno_credito', 'estorno_resgate') do nothing;
  end if;

  update public.pedidos set cashback_estornado_em = now() where id = p_pedido_id;
  return jsonb_build_object('ok', true, 'credito_revertido_centavos', v_reverter, 'saldo_devolvido_centavos', v_debitado);
end;
$$;

revoke all on function public.cashback_creditar_pedido(uuid) from public, anon, authenticated;
revoke all on function public.cashback_estornar_pedido(uuid) from public, anon, authenticated;
grant execute on function public.cashback_creditar_pedido(uuid) to service_role;
grant execute on function public.cashback_estornar_pedido(uuid) to service_role;
