-- Taxa Sai aê (R$ 0,99) opcional para o cliente do cardápio. ADITIVA: só colunas com default.
--
-- Até aqui "taxa > 0" era o único sinal de que a cobrança saiu pelo OAuth do vendedor (webhook,
-- retry do Pix, estorno). Com a taxa opcional, uma cobrança OAuth pode ter taxa 0, então o sinal
-- passa a ser explícito.
--
-- Deploy: migration -> functions -> front.

-- 1) Cobrança emitida pelo OAuth do vendedor (true) ou pelo token colado (false).
alter table public.pagamentos_pendentes
  add column if not exists via_oauth boolean not null default false;

-- Cobranças anteriores: taxa > 0 só existia no OAuth.
update public.pagamentos_pendentes
   set via_oauth = true
 where taxa_plataforma_centavos > 0
   and via_oauth = false;

-- 2) Pedido pago online pelo OAuth (habilita o estorno no Histórico mesmo sem taxa).
alter table public.pedidos
  add column if not exists pago_online_oauth boolean not null default false;

update public.pedidos
   set pago_online_oauth = true
 where taxa_plataforma_centavos > 0
   and pago_online_oauth = false;
