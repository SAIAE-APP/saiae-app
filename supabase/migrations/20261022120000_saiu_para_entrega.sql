-- "Saiu para entrega" (PR 1/4): colunas, interruptor por barraca e evento order.out_for_delivery.
-- Spec: docs/superpowers/specs/2026-10-19-saiu-para-entrega-design.md (seções 5 e 6).
--
-- ADITIVA. `pedidos.status` é texto sem CHECK: o valor novo `saiu_entrega` entra sem mudar constraint.
-- O interruptor `barracas.saiu_entrega_habilitado` nasce DESLIGADO: nenhuma loja muda de comportamento até o dono
-- ligar (e só depois de atualizar todos os aparelhos). `entregador_confirmar` já leva o pedido a Entregue de
-- qualquer estado não cancelado, então não muda.
--
-- Rollback (só se nenhum pedido estiver em saiu_entrega):
--   restaurar o CHECK e o gatilho de 20261016110000 e
--   alter table public.pedidos drop column if exists saiu_entrega_em;
--   alter table public.barracas drop column if exists saiu_entrega_habilitado;

alter table public.pedidos add column if not exists saiu_entrega_em timestamptz;
alter table public.barracas add column if not exists saiu_entrega_habilitado boolean not null default false;

-- Novo tipo de evento no outbox (aditivo; consumidores que ignoram tipos desconhecidos seguem funcionando).
alter table public.eventos_saida drop constraint if exists eventos_saida_tipo_check;
alter table public.eventos_saida
  add constraint eventos_saida_tipo_check
  check (tipo in ('order.created', 'order.paid', 'order.status_changed', 'order.ready', 'order.cancelled', 'order.out_for_delivery'));

-- Gatilho de status: igual ao de 20261016110000, mais o evento de saída para entrega.
create or replace function public.trg_pedido_evento_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._emitir_evento_saida(new.id, 'order.status_changed', new.status::text);
  if new.status = 'pronto' then
    perform public._emitir_evento_saida(new.id, 'order.ready', new.status::text);
  elsif new.status = 'cancelado' then
    perform public._emitir_evento_saida(new.id, 'order.cancelled', new.status::text);
  elsif new.status = 'saiu_entrega' then
    perform public._emitir_evento_saida(new.id, 'order.out_for_delivery', new.status::text);
  end if;
  return null;
exception when others then
  raise warning 'trg_pedido_evento_status: %', sqlerrm;
  return null;
end;
$$;
