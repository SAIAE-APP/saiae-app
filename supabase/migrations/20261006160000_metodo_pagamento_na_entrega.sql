-- "Pagar na entrega" (cardápio digital, PR #14): o pedido nasce com
-- metodo_pagamento = 'na_entrega' (forma real definida depois, pelo entregador ou
-- pelo operador). A constraint antiga só aceitava dinheiro/debito/credito/pix e
-- fazia o criar_pedido falhar com 23514 (a edge function respondia 500).
--
-- Aditiva e retrocompatível: só acrescenta um valor permitido; NULL continua
-- permitido (CHECK não barra NULL) e as 4 formas antigas seguem válidas.
alter table public.pedidos
  drop constraint if exists pedidos_metodo_pagamento_check;

alter table public.pedidos
  add constraint pedidos_metodo_pagamento_check
  check (metodo_pagamento in ('dinheiro', 'debito', 'credito', 'pix', 'na_entrega'));
