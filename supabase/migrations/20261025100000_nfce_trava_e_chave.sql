-- NFC-e: trava de emissão + correção de pagamento não libera pedido com chave de nota (auditoria A2).
--  * pedidos.nfce_trava_em: quem reivindica a emissão grava a hora; outra chamada só assume depois de 2 min
--    (emitir-nfce, TRAVA_NFCE_MS). Aditiva, nullable, sem default.
--  * corrigir_metodo_pagamento: igual à de 20261019170000, MAIS a regra nova: pedido com nfce_chave preenchida
--    (nota que existe na SEFAZ, mesmo com nfce_status 'erro') devolve 'nfce_emitida' e não troca o método.
-- ORDEM: aplicar esta migration ANTES do deploy da edge function emitir-nfce (ela usa nfce_trava_em).
-- Rollback: alterar a função de volta para a versão de 20261019170000; alter table public.pedidos drop column nfce_trava_em;

alter table public.pedidos add column if not exists nfce_trava_em timestamptz;

create or replace function public.corrigir_metodo_pagamento(p_pedido_id uuid, p_metodo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('estado', 'nao_autenticado');
  end if;
  if p_metodo is null or p_metodo not in ('dinheiro', 'debito', 'credito', 'pix') then
    return jsonb_build_object('estado', 'metodo_invalido');
  end if;

  select * into v_pedido from public.pedidos where id = p_pedido_id for update;

  -- Mesma resposta para "não existe", "sem acesso" e "não é o dono": não revela pedido de outra barraca.
  if not found
     or not public.usuario_tem_acesso_barraca(v_pedido.barraca_id)
     or not exists (
       select 1 from public.usuarios_barracas ub
        where ub.usuario_id = auth.uid() and ub.barraca_id = v_pedido.barraca_id and ub.papel = 'dono'
     ) then
    return jsonb_build_object('estado', 'sem_acesso');
  end if;

  if v_pedido.metodo_pagamento = p_metodo then
    return jsonb_build_object('estado', 'ok', 'metodo', p_metodo);
  end if;

  if v_pedido.status = 'cancelado' then
    return jsonb_build_object('estado', 'cancelado');
  end if;

  if v_pedido.metodo_pagamento = 'gratis' then
    return jsonb_build_object('estado', 'nao_corrigivel');
  end if;

  if v_pedido.nfce_chave is not null
     or (v_pedido.nfce_status is not null and v_pedido.nfce_status not in ('erro', 'erro_autorizacao')) then
    return jsonb_build_object('estado', 'nfce_emitida', 'metodo', v_pedido.metodo_pagamento);
  end if;

  update public.pedidos
     set metodo_pagamento = p_metodo,
         metodo_definido_em = coalesce(metodo_definido_em, now()),
         metodo_definido_por = coalesce(metodo_definido_por, auth.uid()),
         metodo_corrigido_em = now(),
         metodo_corrigido_por = auth.uid()
   where id = v_pedido.id;

  insert into public.pedidos_metodo_historico (pedido_id, barraca_id, metodo_antes, metodo_depois, por)
  values (v_pedido.id, v_pedido.barraca_id, v_pedido.metodo_pagamento, p_metodo, auth.uid());

  return jsonb_build_object('estado', 'ok', 'metodo', p_metodo);
end;
$$;

revoke all on function public.corrigir_metodo_pagamento(uuid, text) from public, anon;
grant execute on function public.corrigir_metodo_pagamento(uuid, text) to authenticated;
