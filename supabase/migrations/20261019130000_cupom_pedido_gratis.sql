-- Cupons: pedido GRÁTIS de verdade (decisão do João, 2026-10-09). ADITIVA; só `create or replace` de uma função.
--
-- Antes, o desconto nunca passava de `subtotal - 100`: os itens cobrados ficavam com no mínimo R$ 1,00 (o Pix não
-- aceita valor zero e "pedido grátis" estava fora do escopo). Isso fazia um cupom de 100% sobre um item de R$ 2,10
-- cobrar R$ 1,00 e o dono estranhou. REGRA NOVA: o desconto vai até o subtotal INTEIRO dos itens.
--
--   total cobrado = itens − desconto + taxa de entrega        (a taxa NUNCA é descontada)
--
-- Total cobrado 0 (cupom cobre tudo e não há taxa) = pedido grátis: o servidor não chama o provedor de Pix (ver
-- criar-pagamento-pix). Se sobrar taxa de entrega, o Pix é só da taxa, como já era.
--
-- `cupom_avaliar` e `cupom_reservar` delegam o cálculo a `cupom_regras`, então só ela muda; assinatura, grants e
-- todas as outras regras (validade, mínimo, limite de usos, uma vez por cliente só com uso CONFIRMADO) ficam iguais
-- à 20261018111000. Reservas e usos já gravados não mudam.
--
-- Rollback: recriar `cupom_regras` da 20261018111000 (volta o piso de R$ 1,00).

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

  -- percentual: floor(subtotal * valor / 100); fixo: o valor. Teto: o subtotal inteiro dos itens (pedido grátis).
  v_desc := case p_cupom.tipo
              when 'percentual' then (p_subtotal_centavos::bigint * p_cupom.valor) / 100
              else p_cupom.valor
            end;
  v_desc := greatest(0, least(v_desc, p_subtotal_centavos));
  return jsonb_build_object('ok', true, 'cupom_id', p_cupom.id, 'codigo', p_cupom.codigo, 'desconto_centavos', v_desc::integer);
end;
$$;
