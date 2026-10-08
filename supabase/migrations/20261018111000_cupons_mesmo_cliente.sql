-- Cupons v2 — Task 4: "uma vez por cliente" não pode travar quem refaz o checkout.
--
-- Caso: o cliente aplica o cupom, gera o Pix, volta, muda o carrinho e gera OUTRO Pix (client_uuid novo).
-- A reserva do primeiro Pix ainda está vigente e, como contava para o limite do cliente, bloquearia o
-- segundo ("Você já usou este cupom"). Nova regra:
--   * só uso CONFIRMADO conta para "uma vez por cliente";
--   * ao reservar de novo para o mesmo cliente, as reservas dele ainda abertas no MESMO cupom (de outras
--     cobranças) são liberadas — vale a mais recente.
-- Consequência assumida: se o cliente pagar os DOIS Pix, o 2º também confirma (pagamento aprovado nunca é
-- recusado) e ele leva o desconto duas vezes; cada Pix foi cobrado pelo valor que ele viu.
-- Só `create or replace` das duas funções da 20261018110000 (mesmas assinaturas e grants).

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
    -- Só confirmado: a reserva aberta do próprio cliente é substituída em cupom_reservar.
    if exists (
      select 1 from public.cupom_usos
       where cupom_id = p_cupom.id and cliente_id = p_cliente_id and estado = 'confirmado'
    ) then
      return jsonb_build_object('ok', false, 'erro', 'ja_usou');
    end if;
  end if;

  v_desc := case p_cupom.tipo
              when 'percentual' then (p_subtotal_centavos::bigint * p_cupom.valor) / 100
              else p_cupom.valor
            end;
  v_desc := greatest(0, least(v_desc, p_subtotal_centavos - 100));
  return jsonb_build_object('ok', true, 'cupom_id', p_cupom.id, 'codigo', p_cupom.codigo, 'desconto_centavos', v_desc::integer);
end;
$$;

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
  --   confirmado             -> devolve como está
  --   reservado, mesmo cupom -> reaproveita (retry idempotente)
  --   outro cupom / liberado -> depois de validar o novo, a MESMA linha passa para ele
  --                             (se o novo for inválido, a reserva antiga é liberada e o erro volta).
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

  -- Cliente refazendo o checkout: as outras reservas abertas DELE neste cupom são liberadas.
  if c.uma_por_cliente and p_cliente_id is not null then
    update public.cupom_usos set estado = 'liberado'
     where cupom_id = c.id and cliente_id = p_cliente_id and estado = 'reservado'
       and id is distinct from v_uso;
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
