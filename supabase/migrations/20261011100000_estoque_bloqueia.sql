-- Estoque por item: o dono escolhe se a venda é BLOQUEADA acima do saldo.
--
-- Decisão do João (2026-10-07): com a opção LIGADA o sistema bloqueia a venda além
-- do saldo (Lançar Pedido e cardápio digital); DESLIGADA (padrão) não bloqueia,
-- só avisa. O bloqueio é só na hora de adicionar/enviar com o saldo conhecido:
-- pedido que já está na fila offline ou sendo sincronizado NUNCA é recusado por
-- estoque, e criar_pedido NÃO muda (nenhuma função do banco é alterada aqui).
--
-- ADITIVA: 1 coluna com default. Padrão false = comportamento de hoje.

alter table public.barracas
  add column if not exists estoque_bloqueia boolean not null default false;
