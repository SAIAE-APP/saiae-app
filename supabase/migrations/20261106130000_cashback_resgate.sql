-- Cashback do cardápio digital, M4: avaliar, reservar, confirmar e liberar o uso do saldo.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (§7.5, §16). Mesmo desenho de cupom_avaliar/cupom_reservar/
-- cupom_confirmar/cupom_liberar (20261018110000 e 20261018140000). Todas só do papel de serviço.
-- Rollback: drop das cinco funções abaixo e recriar cupom_liberar como em 20261018110000 (language sql).

-- Só leitura: quanto o cliente poderia usar neste pedido. Não exige cashback_habilitado: o saldo já concedido segue
-- usável com o recurso desligado.
-- SUPOSIÇÃO-CASHBACK-2 (spec §20.2): desligar a função só para novos créditos.
create or replace function public.cashback_avaliar_resgate(p_barraca_id uuid, p_cliente_id uuid, p_itens_centavos integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teto integer;
  s record;
  v_resgate integer;
begin
  if p_cliente_id is null or not exists (
    select 1 from public.clientes_finais cf
     where cf.id = p_cliente_id and cf.barraca_id = p_barraca_id and cf.telefone_confirmado_em is not null
  ) then
    return jsonb_build_object('ok', false, 'erro', 'sem_cliente');
  end if;
  select b.cashback_teto_uso_pct into v_teto from public.barracas b where b.id = p_barraca_id;
  if v_teto is null then
    return jsonb_build_object('ok', false, 'erro', 'sem_saldo');
  end if;
  select * into s from public.cashback_saldo(p_barraca_id, p_cliente_id);
  if s.disponivel_centavos <= 0 then
    return jsonb_build_object('ok', false, 'erro', 'sem_saldo');
  end if;
  v_resgate := public.cashback_calcular_resgate(s.disponivel_centavos, p_itens_centavos, v_teto);
  if v_resgate <= 0 then
    return jsonb_build_object('ok', false, 'erro', 'itens_baixos');
  end if;
  return jsonb_build_object(
    'ok', true, 'resgate_centavos', v_resgate, 'saldo_centavos', s.saldo_centavos,
    'disponivel_centavos', s.disponivel_centavos, 'vence_em', s.vence_em
  );
end;
$$;

-- Reserva o saldo durante o Pix aberto. Idempotente por cobrança: a linha existente é reavaliada (a própria reserva
-- não conta contra o disponível) e atualizada. As reservas de OUTRAS cobranças do mesmo cliente continuam contando,
-- então dois checkouts simultâneos nunca gastam o mesmo saldo duas vezes. A pendente precisa existir (FK).
create or replace function public.cashback_reservar(
  p_barraca_id uuid, p_cliente_id uuid, p_itens_centavos integer, p_pendente_id uuid, p_reservado_ate timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teto integer;
  v_uso uuid;
  v_estado text;
  v_valor_atual integer;
  s record;
  v_resgate integer;
begin
  if p_cliente_id is null or p_pendente_id is null or not exists (
    select 1 from public.clientes_finais cf
     where cf.id = p_cliente_id and cf.barraca_id = p_barraca_id and cf.telefone_confirmado_em is not null
  ) then
    return jsonb_build_object('ok', false, 'erro', 'sem_cliente');
  end if;

  perform public.cashback_travar(p_barraca_id, p_cliente_id);
  perform public.cashback_expirar_se_vencido(p_barraca_id, p_cliente_id);

  select id, estado, valor_centavos into v_uso, v_estado, v_valor_atual
    from public.cashback_resgates where pagamento_pendente_id = p_pendente_id for update;
  if v_uso is not null then
    if v_estado = 'confirmado' then
      return jsonb_build_object('ok', true, 'uso_id', v_uso, 'resgate_centavos', v_valor_atual);
    end if;
    update public.cashback_resgates set estado = 'liberado' where id = v_uso and estado = 'reservado';
  end if;

  select b.cashback_teto_uso_pct into v_teto from public.barracas b where b.id = p_barraca_id;
  select * into s from public.cashback_saldo(p_barraca_id, p_cliente_id);
  v_resgate := case when v_teto is null then 0
    else public.cashback_calcular_resgate(s.disponivel_centavos, p_itens_centavos, v_teto) end;

  if v_resgate <= 0 then
    update public.pagamentos_pendentes set cashback_usado_centavos = 0, cashback_uso_id = null where id = p_pendente_id;
    return jsonb_build_object('ok', false, 'erro', case when s.disponivel_centavos <= 0 then 'sem_saldo' else 'itens_baixos' end);
  end if;

  if v_uso is not null then
    update public.cashback_resgates
       set estado = 'reservado', cliente_id = p_cliente_id, valor_centavos = v_resgate, reservado_ate = p_reservado_ate
     where id = v_uso;
  else
    insert into public.cashback_resgates (barraca_id, cliente_id, pagamento_pendente_id, estado, valor_centavos, reservado_ate)
    values (p_barraca_id, p_cliente_id, p_pendente_id, 'reservado', v_resgate, p_reservado_ate)
    returning id into v_uso;
  end if;
  update public.pagamentos_pendentes set cashback_usado_centavos = v_resgate, cashback_uso_id = v_uso where id = p_pendente_id;
  return jsonb_build_object('ok', true, 'uso_id', v_uso, 'resgate_centavos', v_resgate);
end;
$$;

-- Pagamento aprovado: confirma MESMO com a reserva vencida ou liberada (o dinheiro entrou, o cliente já pagou menos).
-- Não olha cashback_habilitado nem reservado_ate. Grava o resgate no razão pelo que o saldo vigente ainda cobre e guarda
-- a diferença em excedente_centavos (saldo gasto em outro pedido: a barraca absorve). O razão nunca fica negativo.
-- O pedido guarda o desconto cheio em cashback_usado_centavos. Idempotente.
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
  select * into r from public.cashback_resgates where id = p_uso_id for update;
  if not found or r.estado = 'confirmado' then
    return;
  end if;

  -- Cliente apagado (LGPD): não há conta para debitar; o desconto já foi dado, tudo vira excedente.
  if r.cliente_id is not null then
    perform public.cashback_travar(r.barraca_id, r.cliente_id);
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

-- Pix expirado, rejeitado ou cobrança recriada: devolve a reserva. Nunca mexe em resgate confirmado.
create or replace function public.cashback_liberar(p_pendente_id uuid) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cashback_resgates set estado = 'liberado'
   where pagamento_pendente_id = p_pendente_id and estado = 'reservado';
$$;

-- Checkout refeito: libera as reservas abertas do cliente (e a do Pix anterior, se o front informar) antes de avaliar.
create or replace function public.cashback_liberar_abandonadas(
  p_barraca_id uuid, p_cliente_id uuid, p_pendente_anterior_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.cashback_resgates
     set estado = 'liberado'
   where barraca_id = p_barraca_id
     and estado = 'reservado'
     and (
       (p_pendente_anterior_id is not null and pagamento_pendente_id = p_pendente_anterior_id)
       or (p_cliente_id is not null and cliente_id = p_cliente_id)
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Os pontos que já chamam cupom_liberar (criar-pagamento-pix e webhook) passam a liberar também o saldo, sem
-- edição de código nas functions. Acoplamento deliberado: a assinatura e as permissões de cupom_liberar não mudam.
create or replace function public.cupom_liberar(p_pendente_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.cupom_usos set estado = 'liberado'
   where pagamento_pendente_id = p_pendente_id and estado = 'reservado';
  perform public.cashback_liberar(p_pendente_id);
end;
$$;

revoke all on function public.cashback_avaliar_resgate(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.cashback_reservar(uuid, uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.cashback_confirmar_resgate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cashback_liberar(uuid) from public, anon, authenticated;
revoke all on function public.cashback_liberar_abandonadas(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cupom_liberar(uuid) from public, anon, authenticated;
grant execute on function public.cashback_avaliar_resgate(uuid, uuid, integer) to service_role;
grant execute on function public.cashback_reservar(uuid, uuid, integer, uuid, timestamptz) to service_role;
grant execute on function public.cashback_confirmar_resgate(uuid, uuid) to service_role;
grant execute on function public.cashback_liberar(uuid) to service_role;
grant execute on function public.cashback_liberar_abandonadas(uuid, uuid, uuid) to service_role;
grant execute on function public.cupom_liberar(uuid) to service_role;
