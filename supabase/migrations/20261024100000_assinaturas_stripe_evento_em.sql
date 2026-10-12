-- webhook-stripe: ignora evento ATRASADO (fora de ordem). A Stripe não garante ordem de entrega: um
-- invoice.payment_failed que chega depois do invoice.paid mais novo não pode devolver a conta para past_due.
-- Guarda o `created` do último evento aplicado; o update só vale se o evento novo for igual ou mais recente.
--
-- ADITIVA e reexecutável: coluna nullable, sem default (linha antiga = NULL = aceita qualquer evento).
-- APLICAR ANTES do deploy da versão nova de `webhook-stripe` (ela escreve esta coluna).

alter table public.assinaturas
  add column if not exists stripe_evento_em timestamptz;

comment on column public.assinaturas.stripe_evento_em is
  'created (UTC) do último evento Stripe aplicado a esta assinatura; webhook-stripe descarta evento mais antigo.';
