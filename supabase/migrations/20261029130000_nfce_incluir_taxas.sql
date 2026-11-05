-- Interruptor "incluir as taxas na NFC-e" (Task 10 do plano da comanda aberta). ADITIVA.
-- Spec: docs/superpowers/specs/2026-10-23-comanda-aberta-mesa-design.md, seção 5.
-- Nome 20261029130000 (e não 20261026130000, como no plano): precisa ficar depois de 20261029120000.
--
--  * barracas.nfce_incluir_taxas (padrão false = taxas FORA da nota, como sempre foi). Ligado, a NFC-e de cada rodada
--    de uma comanda fechada com taxa de serviço leva a sua parte da taxa (rateio entre as rodadas não canceladas,
--    em `valor_outras_despesas` por item na FocusNFe). O contador do restaurante decide; o sistema não dá parecer
--    fiscal. A taxa de entrega NÃO entra nesta fase.
--  * pedidos.nfce_taxa_servico_centavos: parte da taxa que foi na nota autorizada (NULL = nenhuma). O cupom fiscal
--    impresso usa este valor para o total bater com a nota. Gravado só por emitir-nfce (service role).
--
-- Rollback: alter table public.pedidos drop column nfce_taxa_servico_centavos;
--   alter table public.barracas drop column nfce_incluir_taxas;

alter table public.barracas
  add column if not exists nfce_incluir_taxas boolean not null default false;

alter table public.pedidos
  add column if not exists nfce_taxa_servico_centavos integer check (nfce_taxa_servico_centavos >= 0);
