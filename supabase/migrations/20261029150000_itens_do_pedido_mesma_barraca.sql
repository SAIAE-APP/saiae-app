-- Auditoria de segurança (2026-10-23, achado "estoque entre barracas"): a política de INSERT de itens_do_pedido só
-- conferia o acesso à barraca do PEDIDO, não a do ITEM. O gatilho de estoque (SECURITY DEFINER) baixa o saldo pelo
-- item_id, então um membro de uma barraca podia gravar um item_id de OUTRA barraca e baixar ou esgotar o estoque dela.
-- Aditiva: só um gatilho de validação. Linhas existentes não são tocadas (conferido: 0 itens de pedido apontando para
-- item de outra barraca em staging e produção).
--
-- Regra: item_id, quando preenchido, precisa pertencer à mesma barraca do pedido. item_id nulo (item apagado depois da
-- venda, `on delete set null`) continua válido. O gatilho roda ANTES de trg_estoque_venda (ordem alfabética: "a" < "t"),
-- então a baixa de estoque nunca acontece com item de outra barraca.
--
-- Rollback: drop trigger trg_a_itens_do_pedido_mesma_barraca on public.itens_do_pedido;
--           drop function public._trg_itens_do_pedido_mesma_barraca();

create or replace function public._trg_itens_do_pedido_mesma_barraca()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.item_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.pedidos p
      join public.itens i on i.id = new.item_id
     where p.id = new.pedido_id
       and i.barraca_id = p.barraca_id
  ) then
    raise exception 'item_de_outra_barraca' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public._trg_itens_do_pedido_mesma_barraca() from public, anon, authenticated;

drop trigger if exists trg_a_itens_do_pedido_mesma_barraca on public.itens_do_pedido;
create trigger trg_a_itens_do_pedido_mesma_barraca
  before insert or update of item_id, pedido_id on public.itens_do_pedido
  for each row execute function public._trg_itens_do_pedido_mesma_barraca();
