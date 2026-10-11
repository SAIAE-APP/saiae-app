-- Apagar item do cardápio mesmo já vendido (pedido do João, 2026-10-10): o histórico dos pedidos antigos fica,
-- porque itens_do_pedido já guarda nome_item e preco_centavos_unitario no próprio pedido. Só falta o banco
-- soltar a ligação (item_id vira NULL) em vez de recusar o DELETE. item_id já é nullable e o app (relatório,
-- "mais pedidos", NFC-e) já trata item_id nulo.
--
-- Aditiva e retrocompatível: o app antigo continua tentando DELETE e, se o banco recusar, desativa o item;
-- com esta migration o DELETE passa a funcionar. Rollback (se precisar voltar à regra antiga):
--   alter table public.itens_do_pedido drop constraint itens_do_pedido_item_id_fkey;
--   alter table public.itens_do_pedido add constraint itens_do_pedido_item_id_fkey
--     foreign key (item_id) references public.itens(id);

alter table public.itens_do_pedido drop constraint if exists itens_do_pedido_item_id_fkey;
-- NOT VALID + VALIDATE: não trava a tabela de pedidos por muito tempo (as linhas já existentes já respeitam a ligação).
alter table public.itens_do_pedido
  add constraint itens_do_pedido_item_id_fkey
  foreign key (item_id) references public.itens(id) on delete set null not valid;
alter table public.itens_do_pedido validate constraint itens_do_pedido_item_id_fkey;
