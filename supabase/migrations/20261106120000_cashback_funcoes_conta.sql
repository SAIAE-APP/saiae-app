-- Cashback do cardápio digital, M3: fórmulas em SQL, trava por conta, expiração e saldo.
-- Spec: docs/superpowers/specs/2026-10-27-cashback-design.md (§7.3, §7.5, §7.6).
-- As duas fórmulas espelham src/lib/cashbackRegras.ts (calcularCredito e calcularResgate); a paridade é provada
-- pelos vetores de tests/fixtures/cashback-vetores.json (tests/cashbackMigration.test.ts e tests/cashback.staging.mjs).
-- Todas as funções são só do papel de serviço. Rollback: drop function das quatro funções abaixo.

-- Crédito do pedido: floor(itens_líquidos × bp / 10000), limitado a R$ 20,00. Divisão inteira do Postgres = floor
-- para positivos. Os valores intermediários usam bigint para o produto não estourar integer.
create or replace function public.cashback_calcular_credito(p_itens_liquidos integer, p_percentual_bp integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  -- 2000 = CASHBACK_CREDITO_MAX_CENTAVOS (src/lib/cashbackRegras.ts)
  select least(((greatest(p_itens_liquidos, 0)::bigint * greatest(p_percentual_bp, 0)::bigint) / 10000)::integer, 2000);
$$;

-- Resgate: min(saldo, floor(itens × teto%/100), itens − R$ 1,00), nunca negativo.
create or replace function public.cashback_calcular_resgate(p_saldo integer, p_itens integer, p_teto_uso_pct integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  -- 100 = CASHBACK_PISO_ITENS_CENTAVOS (src/lib/cashbackRegras.ts)
  select greatest(
    0,
    least(
      greatest(p_saldo, 0),
      ((greatest(p_itens, 0)::bigint * greatest(p_teto_uso_pct, 0)::bigint) / 100)::integer,
      greatest(p_itens, 0) - 100
    )
  );
$$;

-- Serializa as operações de saldo de um mesmo cliente numa mesma loja (vale até o fim da transação).
create or replace function public.cashback_travar(p_barraca_id uuid, p_cliente_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended(p_barraca_id::text || p_cliente_id::text, 0));
$$;

-- Materializa o vencimento: se o maior expira_em do par já passou e a soma é positiva, grava `expiracao` negativa
-- no valor da soma e devolve o valor expirado. Idempotente (depois da primeira, a soma é zero). Chamada ANTES de
-- qualquer crédito ou reserva, para o saldo vencido não ressuscitar ao somar um crédito novo.
create or replace function public.cashback_expirar_se_vencido(p_barraca_id uuid, p_cliente_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_soma bigint;
  v_max timestamptz;
begin
  perform public.cashback_travar(p_barraca_id, p_cliente_id);
  select coalesce(sum(valor_centavos), 0), max(expira_em) into v_soma, v_max
    from public.cashback_lancamentos
   where barraca_id = p_barraca_id and cliente_id = p_cliente_id;
  if v_max is not null and v_max <= now() and v_soma > 0 then
    insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, motivo)
    values (p_barraca_id, p_cliente_id, 'expiracao', -v_soma::integer, 'saldo vencido');
    return v_soma::integer;
  end if;
  return 0;
end;
$$;

-- Saldo de leitura (não grava): soma do razão se o maior expira_em ainda não passou, senão 0. Vence exatamente no
-- instante de expira_em. `reservado` = reservas abertas e não vencidas; `disponivel` = saldo − reservado (mínimo 0).
create or replace function public.cashback_saldo(p_barraca_id uuid, p_cliente_id uuid)
returns table (saldo_centavos integer, vence_em timestamptz, reservado_centavos integer, disponivel_centavos integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_soma bigint;
  v_max timestamptz;
  v_saldo integer := 0;
  v_vence timestamptz := null;
  v_reservado integer := 0;
begin
  select coalesce(sum(valor_centavos), 0), max(expira_em) into v_soma, v_max
    from public.cashback_lancamentos
   where barraca_id = p_barraca_id and cliente_id = p_cliente_id;
  if v_max is not null and v_max > now() then
    v_saldo := greatest(v_soma, 0)::integer;
    v_vence := v_max;
  end if;
  select coalesce(sum(valor_centavos), 0)::integer into v_reservado
    from public.cashback_resgates
   where barraca_id = p_barraca_id and cliente_id = p_cliente_id
     and estado = 'reservado' and reservado_ate > now();
  return query select v_saldo, v_vence, v_reservado, greatest(0, v_saldo - v_reservado);
end;
$$;

revoke all on function public.cashback_calcular_credito(integer, integer) from public, anon, authenticated;
revoke all on function public.cashback_calcular_resgate(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.cashback_travar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cashback_expirar_se_vencido(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cashback_saldo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cashback_calcular_credito(integer, integer) to service_role;
grant execute on function public.cashback_calcular_resgate(integer, integer, integer) to service_role;
grant execute on function public.cashback_travar(uuid, uuid) to service_role;
grant execute on function public.cashback_expirar_se_vencido(uuid, uuid) to service_role;
grant execute on function public.cashback_saldo(uuid, uuid) to service_role;
