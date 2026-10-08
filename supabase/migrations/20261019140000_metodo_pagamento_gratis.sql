-- Cupom de 100% = pedido GRÁTIS de verdade (decisão do dono do produto). O pedido que o cupom cobre por
-- inteiro (sem taxa de entrega a pagar) nasce com metodo_pagamento = 'gratis': não é Pix (ninguém pagou nada
-- ao provedor) e não entra como dinheiro/Pix nos relatórios. Aditiva: só acrescenta um valor permitido; NULL e
-- os cinco valores anteriores seguem válidos.
-- Rollback: recriar a constraint sem 'gratis' (antes, apagar/migrar os pedidos 'gratis').
alter table public.pedidos
  drop constraint if exists pedidos_metodo_pagamento_check;

alter table public.pedidos
  add constraint pedidos_metodo_pagamento_check
  check (metodo_pagamento in ('dinheiro', 'debito', 'credito', 'pix', 'na_entrega', 'gratis'));
