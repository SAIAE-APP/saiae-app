-- SAI-010a, etapa 1b: valida as linhas antigas da constraint criada NOT VALID em
-- 20261015100000. Migration própria de propósito: o VALIDATE só pega lock fraco
-- (SHARE UPDATE EXCLUSIVE) quando roda fora da transação do ADD CONSTRAINT.
-- Todas as linhas antigas têm opcoes = '[]' (default), então a validação sempre passa.
alter table public.itens_do_pedido validate constraint itens_do_pedido_opcoes_valido;
