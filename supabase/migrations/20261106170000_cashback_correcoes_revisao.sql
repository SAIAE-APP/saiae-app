-- Cashback do cardápio digital, M8: correções da revisão independente (2026-10-27). ADITIVA: só recria funções.
-- Rollback: reaplicar as versões de 20261106130000 (cashback_confirmar_resgate, cashback_liberar_abandonadas) e de
-- 20261106140000 (cashback_creditar_pedido, cashback_estornar_pedido).
--
-- 1. cashback_liberar_abandonadas: libera SÓ a reserva do Pix anterior informado e SÓ se for do mesmo cliente. Antes liberava
--    todas as reservas do cliente, e quem gerava dois Pix em paralelo podia usar o mesmo saldo duas vezes (a barraca
--    absorveria a diferença). Agora a segunda reserva enxerga a primeira e recebe só o que sobrou.
-- 2. cashback_confirmar_resgate: pega o advisory lock da conta ANTES de travar a linha do resgate, na mesma ordem de
--    cashback_reservar (evita deadlock entre confirmar e reservar do mesmo pendente).
-- 3. cashback_creditar_pedido: não credita pedido já estornado; e acha o cliente também pela cobrança aprovada se o vínculo
--    best-effort pedidos.cliente_id falhou (assim o crédito não se perde por esse motivo).
-- 4. cashback_estornar_pedido: mesmo fallback do cliente, pelo razão ou pela cobrança, para devolver o saldo usado.

create or replace function public.cashback_liberar_abandonadas(
  p_barraca_id uuid, p_cliente_id uuid, p_pendente_anterior_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
begin
  if p_pendente_anterior_id is null or p_cliente_id is null then
    return 0;
  end if;
  update public.cashback_resgates
     set estado = 'liberado'
   where barraca_id = p_barraca_id
     and estado = 'reservado'
     and pagamento_pendente_id = p_pendente_anterior_id
     and cliente_id = p_cliente_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.cashback_confirmar_resgate(p_uso_id uuid, p_pedido_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.cashback_resgates;
  v_saldo integer := 0;
  v_debito integer := 0;
begin
  -- Mesma ordem de cashback_reservar: primeiro o lock da conta, depois a linha do resgate.
  select * into r from public.cashback_resgates where id = p_uso_id;
  if not found then
    return;
  end if;
  if r.cliente_id is not null then
    perform public.cashback_travar(r.barraca_id, r.cliente_id);
  end if;
  select * into r from public.cashback_resgates where id = p_uso_id for update;
  if r.estado = 'confirmado' then
    return;
  end if;

  -- Cliente apagado (LGPD): não há conta para debitar; o desconto já foi dado, tudo vira excedente.
  if r.cliente_id is not null then
    select s.saldo_centavos into v_saldo from public.cashback_saldo(r.barraca_id, r.cliente_id) s;
    v_debito := least(r.valor_centavos, coalesce(v_saldo, 0));
    if v_debito > 0 then
      insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, pagamento_pendente_id)
      values (r.barraca_id, r.cliente_id, 'resgate', -v_debito, p_pedido_id, r.pagamento_pendente_id)
      on conflict (pagamento_pendente_id) where tipo = 'resgate' do nothing;
    end if;
  end if;

  update public.cashback_resgates
     set estado = 'confirmado', pedido_id = p_pedido_id, excedente_centavos = r.valor_centavos - v_debito
   where id = r.id;
  update public.pedidos set cashback_usado_centavos = r.valor_centavos where id = p_pedido_id;
end;
$$;

create or replace function public.cashback_creditar_pedido(p_pedido_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  b record;
  v_cliente uuid;
  v_existente integer;
  v_itens bigint;
  v_base integer;
  v_credito integer;
begin
  select id, barraca_id, cliente_id, desconto_cupom_centavos, cashback_usado_centavos, cashback_estornado_em
    into p from public.pedidos where id = p_pedido_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'pedido_inexistente');
  end if;
  -- O vínculo pedidos.cliente_id é best-effort no webhook; a cobrança aprovada guarda o mesmo cliente.
  v_cliente := coalesce(p.cliente_id, (
    select pp.cliente_id from public.pagamentos_pendentes pp
     where pp.pedido_id = p_pedido_id and pp.status = 'aprovado' and pp.cliente_id is not null limit 1));
  if v_cliente is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_cliente');
  end if;
  if not exists (
    select 1 from public.clientes_finais cf
     where cf.id = v_cliente and cf.barraca_id = p.barraca_id and cf.telefone_confirmado_em is not null
  ) then
    return jsonb_build_object('ok', false, 'erro', 'telefone_nao_confirmado');
  end if;

  -- Repetição (webhook reenviado): devolve o valor já gravado, sem checar o interruptor de hoje.
  select valor_centavos into v_existente from public.cashback_lancamentos
   where pedido_id = p_pedido_id and tipo = 'credito';
  if found then
    return jsonb_build_object('ok', true, 'credito_centavos', v_existente);
  end if;

  -- Pedido já estornado: um crédito retardatário ressuscitaria saldo de um pagamento devolvido.
  if p.cashback_estornado_em is not null then
    return jsonb_build_object('ok', false, 'erro', 'estornado');
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

  perform public.cashback_travar(p.barraca_id, v_cliente);
  -- Saldo vencido e ainda não materializado vira expiração ANTES do crédito novo (que renova o prazo do saldo todo).
  perform public.cashback_expirar_se_vencido(p.barraca_id, v_cliente);

  select coalesce(sum(i.preco_centavos_unitario::bigint * i.quantidade), 0) into v_itens
    from public.itens_do_pedido i
   where i.pedido_id = p_pedido_id and coalesce(i.removido, false) = false;
  v_base := greatest(0, v_itens - p.desconto_cupom_centavos - p.cashback_usado_centavos)::integer;
  v_credito := public.cashback_calcular_credito(v_base, b.cashback_percentual_bp);
  if v_credito <= 0 then
    return jsonb_build_object('ok', true, 'credito_centavos', 0);
  end if;

  insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, expira_em)
  values (p.barraca_id, v_cliente, 'credito', v_credito, p_pedido_id, now() + make_interval(days => b.cashback_validade_dias))
  on conflict (pedido_id) where tipo = 'credito' do nothing;
  select valor_centavos into v_credito from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'credito';

  update public.pedidos set cashback_gerado_centavos = v_credito where id = p_pedido_id;
  return jsonb_build_object('ok', true, 'credito_centavos', v_credito);
end;
$$;

create or replace function public.cashback_estornar_pedido(p_pedido_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p record;
  v_cliente uuid;
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
  -- Cliente: o vínculo do pedido; se ele falhou, o do razão deste pedido ou o da cobrança aprovada.
  v_cliente := coalesce(
    p.cliente_id,
    (select l.cliente_id from public.cashback_lancamentos l where l.pedido_id = p_pedido_id and l.cliente_id is not null limit 1),
    (select pp.cliente_id from public.pagamentos_pendentes pp where pp.pedido_id = p_pedido_id and pp.cliente_id is not null limit 1)
  );
  if v_cliente is null then
    return jsonb_build_object('ok', true, 'credito_revertido_centavos', 0, 'saldo_devolvido_centavos', 0);
  end if;

  perform public.cashback_travar(p.barraca_id, v_cliente);
  -- Repetição: devolve o que já foi gravado.
  if p.cashback_estornado_em is not null then
    return jsonb_build_object(
      'ok', true,
      'credito_revertido_centavos', coalesce((select -sum(valor_centavos) from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'estorno_credito'), 0),
      'saldo_devolvido_centavos', coalesce((select sum(valor_centavos) from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'estorno_resgate'), 0)
    );
  end if;

  -- Antes de qualquer lançamento com validade nova: o estorno do resgate renovaria um saldo vencido.
  perform public.cashback_expirar_se_vencido(p.barraca_id, v_cliente);

  select valor_centavos into v_credito from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'credito';
  if found then
    select s.saldo_centavos into v_saldo from public.cashback_saldo(p.barraca_id, v_cliente) s;
    v_reverter := least(v_credito, coalesce(v_saldo, 0));
    if v_reverter > 0 then
      insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id)
      values (p.barraca_id, v_cliente, 'estorno_credito', -v_reverter, p_pedido_id)
      on conflict (pedido_id, tipo) where tipo in ('estorno_credito', 'estorno_resgate') do nothing;
    end if;
  end if;

  select coalesce(-sum(valor_centavos), 0)::integer into v_debitado
    from public.cashback_lancamentos where pedido_id = p_pedido_id and tipo = 'resgate';
  if v_debitado > 0 then
    select cashback_validade_dias into v_dias from public.barracas where id = p.barraca_id;
    insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, expira_em)
    values (p.barraca_id, v_cliente, 'estorno_resgate', v_debitado, p_pedido_id, now() + make_interval(days => coalesce(v_dias, 60)))
    on conflict (pedido_id, tipo) where tipo in ('estorno_credito', 'estorno_resgate') do nothing;
  end if;

  update public.pedidos set cashback_estornado_em = now() where id = p_pedido_id;
  return jsonb_build_object('ok', true, 'credito_revertido_centavos', v_reverter, 'saldo_devolvido_centavos', v_debitado);
end;
$$;

-- create or replace preserva os grants, mas reafirma: só o papel de serviço executa.
revoke all on function public.cashback_liberar_abandonadas(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cashback_confirmar_resgate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cashback_creditar_pedido(uuid) from public, anon, authenticated;
revoke all on function public.cashback_estornar_pedido(uuid) from public, anon, authenticated;
grant execute on function public.cashback_liberar_abandonadas(uuid, uuid, uuid) to service_role;
grant execute on function public.cashback_confirmar_resgate(uuid, uuid) to service_role;
grant execute on function public.cashback_creditar_pedido(uuid) to service_role;
grant execute on function public.cashback_estornar_pedido(uuid) to service_role;
