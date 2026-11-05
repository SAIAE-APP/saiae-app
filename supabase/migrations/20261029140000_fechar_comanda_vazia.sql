-- Comanda sem rodada ativa também fecha (correção da revisão final do plano comanda aberta).
-- Antes (20261029110000_fechar_comanda.sql) a comanda cujas rodadas foram todas canceladas devolvia `sem_itens` e
-- ficava aberta para sempre: listada em Mesas, com um "Fechar comanda" que sempre falhava, e segurando a mesa.
-- Esta migration só recria a função (create or replace, idempotente); a anterior não é editada.
--
-- Mudanças em relação à 20261029110000:
--  * sem rodada ativa (todas canceladas ou nenhuma): fecha com subtotal 0, taxa 0, taxa_servico_bps 0 e
--    metodo_pagamento NULL (não houve cobrança). A forma de pagamento NÃO é exigida (p_metodo pode ser null) e,
--    se vier, é ignorada. Resposta: ok com metodo null e totais 0;
--  * comanda já fechada VAZIA (metodo_pagamento null): qualquer reenvio devolve ok com totais 0 (a fila pode
--    reenviar com ou sem método);
--  * p_metodo null só é recusado (metodo_invalido) quando há rodada ativa; método fora da lista continua
--    recusado logo no início;
--  * `sem_itens` não é mais devolvido (o app ainda o entende, para o caso de servidor antigo).
-- Todo o resto (trava da comanda antes dos pedidos, acesso, idempotência, cálculo da taxa) é igual.
--
-- Rollback: reaplicar supabase/migrations/20261029110000_fechar_comanda.sql (volta a devolver sem_itens).

create or replace function public.fechar_comanda(p_comanda_id uuid, p_metodo text, p_cobrar_taxa_servico boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comanda public.comandas%rowtype;
  v_subtotal bigint;
  v_bps integer := 0;
  v_taxa bigint := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if p_metodo is not null and p_metodo not in ('dinheiro', 'debito', 'credito', 'pix') then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  -- ORDEM DAS TRAVAS: comanda primeiro, pedidos depois (ver 20261029110000_fechar_comanda.sql).
  select * into v_comanda from public.comandas where id = p_comanda_id for update;

  if not found or not public.usuario_tem_acesso_barraca(v_comanda.barraca_id) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  -- Soma dos itens não removidos das rodadas não canceladas (mesma regra de subtotalDaComanda).
  select coalesce(sum(i.quantidade::bigint * i.preco_centavos_unitario), 0) into v_subtotal
    from public.pedidos p
    join public.itens_do_pedido i on i.pedido_id = p.id and not coalesce(i.removido, false)
   where p.comanda_id = v_comanda.id and p.status::text <> 'cancelado';

  if v_comanda.status = 'fechada' then
    -- Fechada vazia (sem cobrança): qualquer reenvio é ok.
    if v_comanda.metodo_pagamento is null then
      return jsonb_build_object('estado', 'ok', 'metodo', null, 'subtotal_centavos', 0,
        'taxa_servico_centavos', 0, 'total_centavos', 0);
    end if;
    if v_comanda.metodo_pagamento = p_metodo then
      return jsonb_build_object('estado', 'ok', 'metodo', p_metodo, 'subtotal_centavos', v_subtotal,
        'taxa_servico_centavos', v_comanda.taxa_servico_centavos,
        'total_centavos', v_subtotal + v_comanda.taxa_servico_centavos);
    end if;
    return jsonb_build_object('estado', 'ja_fechada', 'metodo', v_comanda.metodo_pagamento);
  end if;

  if not exists (select 1 from public.pedidos p where p.comanda_id = v_comanda.id and p.status::text <> 'cancelado') then
    update public.comandas
       set status = 'fechada',
           fechada_em = now(),
           fechada_por = auth.uid(),
           metodo_pagamento = null,
           taxa_servico_bps = 0,
           taxa_servico_centavos = 0
     where id = v_comanda.id;
    return jsonb_build_object('estado', 'ok', 'metodo', null, 'subtotal_centavos', 0,
      'taxa_servico_centavos', 0, 'total_centavos', 0);
  end if;

  if p_metodo is null then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  if coalesce(p_cobrar_taxa_servico, false) then
    select case when b.taxa_servico_habilitada then b.taxa_servico_bps else 0 end into v_bps
      from public.barracas b where b.id = v_comanda.barraca_id;
    v_bps := coalesce(v_bps, 0);
    if v_bps > 0 and v_subtotal > 0 then
      v_taxa := (v_subtotal * v_bps + 5000) / 10000; -- inteiros positivos: divisão = floor
    end if;
  end if;

  update public.pedidos
     set metodo_pagamento = p_metodo,
         metodo_definido_em = now(),
         metodo_definido_por = auth.uid()
   where comanda_id = v_comanda.id
     and status::text <> 'cancelado'
     and metodo_pagamento = 'na_entrega';

  update public.comandas
     set status = 'fechada',
         fechada_em = now(),
         fechada_por = auth.uid(),
         metodo_pagamento = p_metodo,
         taxa_servico_bps = v_bps,
         taxa_servico_centavos = v_taxa
   where id = v_comanda.id;

  return jsonb_build_object('estado', 'ok', 'metodo', p_metodo, 'subtotal_centavos', v_subtotal,
    'taxa_servico_centavos', v_taxa, 'total_centavos', v_subtotal + v_taxa);
end;
$$;

revoke all on function public.fechar_comanda(uuid, text, boolean) from public, anon;
grant execute on function public.fechar_comanda(uuid, text, boolean) to authenticated;
