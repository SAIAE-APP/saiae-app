-- Story 2 do sprint 2: Pix online com Entrega no cardápio público.
--
-- A cobrança Pix nasce em `pagamentos_pendentes` e o pedido de verdade só é
-- criado pelo webhook quando o Mercado Pago confirma. Para pedido de Entrega
-- o pendente precisa guardar, no momento da cobrança, TUDO o que o webhook vai
-- passar ao `criar_pedido`: tipo, endereço estruturado e a taxa de entrega
-- calculada no servidor (snapshot). O webhook NUNCA recalcula a taxa: o valor
-- pago é conferido contra itens + taxa DESTE snapshot, então mudar a taxa da
-- barraca no meio do caminho não afeta uma cobrança já emitida.
--
-- 100% ADITIVA e retrocompatível: colunas nullable ou com DEFAULT; pendente
-- antigo (sem entrega) fica com taxa 0 e o webhook segue idêntico ao de hoje.
-- Nenhuma função do banco é alterada. Constraints consultadas antes (sprint
-- 1: um CHECK barrou 'na_entrega'): `pagamentos_pendentes_status_check` só
-- toca `status` (inalterado) e `pedidos_metodo_pagamento_check` já aceita
-- 'pix'; `pedidos_tipo_atendimento_valido` já aceita 'entrega'.

alter table public.pagamentos_pendentes
  add column if not exists tipo_atendimento text,
  -- { nome, telefone, rua, numero, bairro, referencia, consentimento_lgpd_em }
  add column if not exists entrega jsonb,
  -- Taxa de entrega em centavos inteiros, calculada no servidor por
  -- taxa_entrega_do_bairro no momento da cobrança.
  add column if not exists taxa_entrega_centavos integer not null default 0,
  add column if not exists cliente_nome text;

alter table public.pagamentos_pendentes
  drop constraint if exists pagamentos_pendentes_tipo_atendimento_valido;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_tipo_atendimento_valido check (
    tipo_atendimento is null
    or tipo_atendimento in ('mesa', 'balcao', 'retirada', 'entrega')
  );

alter table public.pagamentos_pendentes
  drop constraint if exists pagamentos_pendentes_taxa_entrega_valida;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_taxa_entrega_valida check (
    taxa_entrega_centavos >= 0 and taxa_entrega_centavos <= 99999999
  );

-- Taxa só existe junto de entrega, e entrega é sempre um objeto JSON.
alter table public.pagamentos_pendentes
  drop constraint if exists pagamentos_pendentes_entrega_coerente;
alter table public.pagamentos_pendentes
  add constraint pagamentos_pendentes_entrega_coerente check (
    (entrega is null or jsonb_typeof(entrega) = 'object')
    and (taxa_entrega_centavos = 0 or tipo_atendimento = 'entrega')
  );
