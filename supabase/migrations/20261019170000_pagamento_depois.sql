-- "Pagar depois" (Fase 1: Retirada e Entrega). ADITIVA; depende de 20261010100000 (definir_metodo_pagamento) e de
-- 20260926170000 (pedidos.nfce_status). Spec: docs/superpowers/specs/2026-10-08-pagar-depois-e-dividido-design.md.
--
--  * barracas.pagamento_depois_habilitado (padrão false): interruptor por barraca. Desligado, o app se comporta
--    exatamente como antes. Nenhuma função existente muda.
--  * corrigir_metodo_pagamento(p_pedido_id, p_metodo): troca a forma de pagamento de um pedido JÁ definido (o
--    definir_metodo_pagamento nunca sobrescreve). Regras:
--      - só authenticated, só o DONO da barraca (papel 'dono'); mesma resposta para "não existe" e "sem acesso";
--      - só dinheiro | debito | credito | pix (a forma real; "a receber" é o 'na_entrega' de sempre);
--      - só enquanto NÃO existe nota válida: nfce_status nulo, 'erro' ou 'erro_autorizacao'. Autorizada, em
--        processamento ou qualquer outro status trava ('nfce_emitida'): mudar depois é fluxo fiscal de cancelamento;
--      - nunca em pedido cancelado; pedido grátis ('gratis') não se corrige;
--      - idempotente (repetir o mesmo método devolve ok sem novo registro);
--      - registra quem e quando (pedidos.metodo_corrigido_em/por) e guarda o histórico de cada troca
--        (pedidos_metodo_historico), que o dono da barraca consegue ler.
--
-- Rollback: drop function public.corrigir_metodo_pagamento(uuid, text); drop table public.pedidos_metodo_historico;
--   alter table public.pedidos drop column metodo_corrigido_em, drop column metodo_corrigido_por;
--   alter table public.barracas drop column pagamento_depois_habilitado.

alter table public.barracas
  add column if not exists pagamento_depois_habilitado boolean not null default false;

alter table public.pedidos
  add column if not exists metodo_corrigido_em timestamptz,
  add column if not exists metodo_corrigido_por uuid;

create table if not exists public.pedidos_metodo_historico (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  metodo_antes text,
  metodo_depois text not null,
  por uuid,
  em timestamptz not null default now()
);
create index if not exists pedidos_metodo_historico_pedido on public.pedidos_metodo_historico (pedido_id, em);
alter table public.pedidos_metodo_historico enable row level security;
revoke all on public.pedidos_metodo_historico from anon;

drop policy if exists "dono le historico de pagamento" on public.pedidos_metodo_historico;
create policy "dono le historico de pagamento"
  on public.pedidos_metodo_historico for select
  to authenticated
  using (public.usuario_tem_acesso_barraca(barraca_id));

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

  if v_pedido.nfce_status is not null and v_pedido.nfce_status not in ('erro', 'erro_autorizacao') then
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
