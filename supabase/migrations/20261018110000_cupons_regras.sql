-- Cupons por código (v2) — Task 2: TODA a regra no banco, só executável pelo papel de serviço.
--   cupom_regras (interna)  validação e cálculo em um lugar só
--   cupom_avaliar           consulta sem gravar nem travar (tela)
--   cupom_reservar          trava a linha do cupom, reconta e reserva (atômico)
--   cupom_confirmar         pagamento aprovado: uso vira confirmado e o pedido recebe cupom/desconto
--   cupom_liberar           Pix expirado/rejeitado: devolve a vaga
--   cupom_registrar_tentativa  limite de tentativas de adivinhar código
--   cupom_apagar            dono apaga cupom SEM uso (única função liberada a authenticated)
-- Valores em centavos inteiros. Desconto só sobre os itens; itens cobrados nunca abaixo de 100 centavos.

-- Núcleo das regras (spec, Parte 2, nesta ordem). Não grava nada; quem chama decide travar ou não.
create or replace function public.cupom_regras(
  p_cupom public.cupons, p_subtotal_centavos integer, p_cliente_id uuid, p_agora timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usos integer;
  v_desc bigint;
begin
  if p_cupom.inicio_em is not null and p_agora < p_cupom.inicio_em then
    return jsonb_build_object('ok', false, 'erro', 'nao_comecou');
  end if;
  if p_cupom.fim_em is not null and p_agora > p_cupom.fim_em then
    return jsonb_build_object('ok', false, 'erro', 'venceu');
  end if;
  if p_subtotal_centavos < p_cupom.pedido_minimo_centavos then
    return jsonb_build_object('ok', false, 'erro', 'minimo', 'minimo_centavos', p_cupom.pedido_minimo_centavos);
  end if;
  if p_cupom.limite_usos is not null then
    select count(*) into v_usos from public.cupom_usos
     where cupom_id = p_cupom.id
       and (estado = 'confirmado' or (estado = 'reservado' and reservado_ate > p_agora));
    if v_usos >= p_cupom.limite_usos then
      return jsonb_build_object('ok', false, 'erro', 'esgotou');
    end if;
  end if;
  if p_cupom.uma_por_cliente then
    if p_cliente_id is null then
      return jsonb_build_object('ok', false, 'erro', 'precisa_login');
    end if;
    if exists (
      select 1 from public.cupom_usos
       where cupom_id = p_cupom.id and cliente_id = p_cliente_id
         and (estado = 'confirmado' or (estado = 'reservado' and reservado_ate > p_agora))
    ) then
      return jsonb_build_object('ok', false, 'erro', 'ja_usou');
    end if;
  end if;

  -- percentual: floor(subtotal * valor / 100) (divisão inteira de positivos); fixo: o valor.
  v_desc := case p_cupom.tipo
              when 'percentual' then (p_subtotal_centavos::bigint * p_cupom.valor) / 100
              else p_cupom.valor
            end;
  v_desc := greatest(0, least(v_desc, p_subtotal_centavos - 100));
  return jsonb_build_object('ok', true, 'cupom_id', p_cupom.id, 'codigo', p_cupom.codigo, 'desconto_centavos', v_desc::integer);
end;
$$;

-- Consulta da tela: sem gravar e sem travar.
create or replace function public.cupom_avaliar(
  p_barraca_id uuid, p_codigo text, p_subtotal_centavos integer, p_cliente_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.cupons;
begin
  select * into c from public.cupons
   where barraca_id = p_barraca_id and codigo = upper(btrim(p_codigo))
     and exists (select 1 from public.barracas b where b.id = p_barraca_id and b.cupons_habilitado);
  if not found or not c.ativo then
    return jsonb_build_object('ok', false, 'erro', 'invalido');
  end if;
  return public.cupom_regras(c, p_subtotal_centavos, p_cliente_id, now());
end;
$$;

-- Reserva atômica: `for update` na linha do cupom serializa a disputa pelo último uso (a 2ª chamada espera
-- a 1ª terminar e já enxerga a reserva). Reserva vencida (reservado_ate < now) é ignorada na contagem,
-- então não depende de cron para liberar.
create or replace function public.cupom_reservar(
  p_barraca_id uuid, p_codigo text, p_subtotal_centavos integer, p_cliente_id uuid,
  p_pendente_id uuid, p_reservado_ate timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.cupons;
  v_agora timestamptz := now();
  v_uso uuid;
  v_uso_cupom uuid;
  v_uso_desc integer;
  v_uso_estado text;
  v_res jsonb;
begin
  select * into c from public.cupons
   where barraca_id = p_barraca_id and codigo = upper(btrim(p_codigo))
     and exists (select 1 from public.barracas b where b.id = p_barraca_id and b.cupons_habilitado)
   for update;
  if not found or not c.ativo then
    return jsonb_build_object('ok', false, 'erro', 'invalido');
  end if;

  -- Uma linha de uso por cobrança (índice único). Se a cobrança já tem uso:
  --   confirmado            -> devolve como está (nada a reservar)
  --   reservado, mesmo cupom -> reaproveita (retry idempotente)
  --   outro cupom / liberado -> depois de validar o novo, a MESMA linha é reaproveitada para ele
  --                            (se o novo for inválido, a reserva antiga é liberada e o erro volta).
  if p_pendente_id is not null then
    select id, cupom_id, desconto_centavos, estado into v_uso, v_uso_cupom, v_uso_desc, v_uso_estado
      from public.cupom_usos where pagamento_pendente_id = p_pendente_id for update;
    if v_uso is not null then
      if v_uso_estado = 'confirmado' or (v_uso_estado = 'reservado' and v_uso_cupom = c.id) then
        return jsonb_build_object('ok', true, 'uso_id', v_uso, 'cupom_id', v_uso_cupom, 'codigo', c.codigo, 'desconto_centavos', v_uso_desc);
      end if;
    end if;
  end if;

  v_res := public.cupom_regras(c, p_subtotal_centavos, p_cliente_id, v_agora);
  if not (v_res ->> 'ok')::boolean then
    if v_uso is not null then
      update public.cupom_usos set estado = 'liberado' where id = v_uso and estado = 'reservado';
    end if;
    return v_res;
  end if;

  if v_uso is not null then
    update public.cupom_usos
       set cupom_id = c.id, cliente_id = p_cliente_id, estado = 'reservado',
           desconto_centavos = (v_res ->> 'desconto_centavos')::integer, reservado_ate = p_reservado_ate
     where id = v_uso;
  else
    insert into public.cupom_usos (cupom_id, barraca_id, cliente_id, pagamento_pendente_id, estado, desconto_centavos, reservado_ate)
    values (c.id, p_barraca_id, p_cliente_id, p_pendente_id, 'reservado', (v_res ->> 'desconto_centavos')::integer, p_reservado_ate)
    returning id into v_uso;
  end if;
  return v_res || jsonb_build_object('uso_id', v_uso);
end;
$$;

-- Pagamento aprovado: confirma MESMO se a reserva já venceu ou foi liberada (o dinheiro entrou; pagamento
-- aprovado vale mais que a validade). Segunda chamada é no-op (webhook duplicado / corrida).
create or replace function public.cupom_confirmar(p_uso_id uuid, p_pedido_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  u public.cupom_usos;
  v_codigo text;
begin
  update public.cupom_usos
     set estado = 'confirmado', pedido_id = p_pedido_id
   where id = p_uso_id and estado <> 'confirmado'
  returning * into u;
  if not found then
    return;
  end if;
  select codigo into v_codigo from public.cupons where id = u.cupom_id;
  update public.pedidos
     set cupom_id = u.cupom_id, cupom_codigo = v_codigo, desconto_cupom_centavos = u.desconto_centavos
   where id = p_pedido_id;
end;
$$;

-- Pix expirado/rejeitado: devolve a vaga. Nunca mexe em uso confirmado.
create or replace function public.cupom_liberar(p_pendente_id uuid) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cupom_usos set estado = 'liberado'
   where pagamento_pendente_id = p_pendente_id and estado = 'reservado';
$$;

-- Limite de tentativas de adivinhar código: grava e devolve false se passou de 15 inválidas/h por IP+loja
-- ou de 100 inválidas/h por loja. Tentativa válida não conta (mas IP já bloqueado continua bloqueado).
create or replace function public.cupom_registrar_tentativa(p_barraca_id uuid, p_ip_hash text, p_valida boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ip integer;
  v_loja integer;
begin
  delete from public.cupom_tentativas_log where barraca_id = p_barraca_id and criado_em < now() - interval '2 days';
  insert into public.cupom_tentativas_log (barraca_id, ip_hash, valida) values (p_barraca_id, p_ip_hash, coalesce(p_valida, false));
  select count(*) into v_ip from public.cupom_tentativas_log
   where barraca_id = p_barraca_id and ip_hash = p_ip_hash and not valida and criado_em >= now() - interval '1 hour';
  select count(*) into v_loja from public.cupom_tentativas_log
   where barraca_id = p_barraca_id and not valida and criado_em >= now() - interval '1 hour';
  return v_ip <= 15 and v_loja <= 100;
end;
$$;

-- Dono apaga cupom que nunca foi usado (com uso, só pausa).
create or replace function public.cupom_apagar(p_cupom_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
begin
  select barraca_id into v_barraca from public.cupons where id = p_cupom_id;
  if v_barraca is null or not public.usuario_tem_acesso_barraca(v_barraca) then
    raise exception 'sem acesso a este cupom';
  end if;
  if exists (select 1 from public.cupom_usos where cupom_id = p_cupom_id) then
    raise exception 'cupom_com_uso';
  end if;
  delete from public.cupons where id = p_cupom_id;
end;
$$;

revoke all on function public.cupom_regras(public.cupons, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.cupom_avaliar(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.cupom_reservar(uuid, text, integer, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.cupom_confirmar(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cupom_liberar(uuid) from public, anon, authenticated;
revoke all on function public.cupom_registrar_tentativa(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.cupom_apagar(uuid) from public, anon;
grant execute on function public.cupom_avaliar(uuid, text, integer, uuid) to service_role;
grant execute on function public.cupom_reservar(uuid, text, integer, uuid, uuid, timestamptz) to service_role;
grant execute on function public.cupom_confirmar(uuid, uuid) to service_role;
grant execute on function public.cupom_liberar(uuid) to service_role;
grant execute on function public.cupom_registrar_tentativa(uuid, text, boolean) to service_role;
grant execute on function public.cupom_apagar(uuid) to authenticated;
