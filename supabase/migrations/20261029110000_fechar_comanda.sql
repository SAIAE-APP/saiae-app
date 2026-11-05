-- Fechar a comanda aberta da Mesa (Task 6 do plano). ADITIVA: só uma função nova.
-- Spec: docs/superpowers/specs/2026-10-23-comanda-aberta-mesa-design.md (mecanismo de "pagar depois" reaproveitado:
-- 20261010100000_definir_metodo_pagamento.sql). Nome 20261029110000 (e não 20261026110000, como no plano): precisa
-- vir depois de 20261029100000_comanda_aberta.sql, que cria a tabela comandas.
--
-- fechar_comanda(p_comanda_id, p_metodo, p_cobrar_taxa_servico) -> jsonb com `estado`:
--  * ok: comanda fechada (ou já estava fechada com o MESMO método: a fila pode reenviar). Traz subtotal_centavos,
--    taxa_servico_centavos e total_centavos;
--  * ja_fechada: já fechada com OUTRO método (nunca sobrescreve);
--  * metodo_invalido: só dinheiro | debito | credito | pix;
--  * sem_itens: nenhuma rodada ativa (todas canceladas ou nenhuma); a comanda continua aberta;
--  * sem_acesso: mesma resposta para "não existe" e "de outra barraca" (não revela existência);
--  * nao_autenticado.
-- Cada rodada não cancelada que ainda está 'na_entrega' recebe o método (+ metodo_definido_em/por); o trigger SAI-001
-- existente (pedidos_evento_pago_na_entrega) dispara sozinho ao sair de 'na_entrega'. Rodada que já tinha método
-- definido (Histórico) não é sobrescrita, mesma regra de definir_metodo_pagamento.
-- Taxa de serviço SEMPRE calculada aqui (nunca vem do cliente): só se p_cobrar_taxa_servico e a barraca tem
-- taxa_servico_habilitada; arredonda ao centavo mais próximo (metade sobe), igual a taxaServicoCentavos
-- (src/lib/comandaAberta.ts). A taxa fica à parte, gravada só na comanda, nunca nos itens.
--
-- Rollback: drop function public.fechar_comanda(uuid, text, boolean);

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
  if p_metodo is null or p_metodo not in ('dinheiro', 'debito', 'credito', 'pix') then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  -- ORDEM DAS TRAVAS: comanda primeiro, pedidos depois (a mesma do trigger pedidos_atribuir_comanda, que pega
  -- for share na comanda ao anexar uma rodada). Assim um lançamento simultâneo ou termina antes (e a rodada entra
  -- neste fechamento, porque cada comando abaixo vê o que já commitou) ou espera e abre uma comanda nova. Nunca
  -- travar linhas de pedidos antes desta linha. Dois fechamentos concorrentes: o segundo espera e cai no
  -- "já fechada" abaixo.
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
    if v_comanda.metodo_pagamento = p_metodo then
      return jsonb_build_object('estado', 'ok', 'metodo', p_metodo, 'subtotal_centavos', v_subtotal,
        'taxa_servico_centavos', v_comanda.taxa_servico_centavos,
        'total_centavos', v_subtotal + v_comanda.taxa_servico_centavos);
    end if;
    return jsonb_build_object('estado', 'ja_fechada', 'metodo', v_comanda.metodo_pagamento);
  end if;

  if not exists (select 1 from public.pedidos p where p.comanda_id = v_comanda.id and p.status::text <> 'cancelado') then
    return jsonb_build_object('estado', 'sem_itens');
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

-- Supabase concede execute a anon por padrão em funções novas do schema public: revoga explicitamente.
revoke all on function public.fechar_comanda(uuid, text, boolean) from public, anon;
grant execute on function public.fechar_comanda(uuid, text, boolean) to authenticated;
