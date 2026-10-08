-- Horário de funcionamento validado no servidor (edge functions públicas do cardápio).
--
-- `fuso`: fuso da barraca, para saber que dia e hora são "agora" lá. Até hoje o
-- horário usava o relógio do visitante. Padrão America/Sao_Paulo; a lista oferecida
-- em Ajustes cobre os fusos do Brasil. Valor inválido cai em America/Sao_Paulo no código.
--
-- `bloquear_fora_do_horario`: interruptor POR BARRACA, padrão DESLIGADO = comportamento
-- de hoje (o cardápio só mostra o selo "Aberto/Fechado"). Ligado, criar-pedido-cardapio
-- e a criação de NOVA cobrança em criar-pagamento-pix recusam com 422 quando a barraca
-- está fechada. Nunca no webhook, em retry de cobrança já emitida ou no pedido do operador.
--
-- ADITIVA: duas colunas com default; nenhuma função alterada.

alter table public.barracas
  add column if not exists fuso text not null default 'America/Sao_Paulo';

alter table public.barracas
  add column if not exists bloquear_fora_do_horario boolean not null default false;

alter table public.barracas
  drop constraint if exists barracas_fuso_valido;
alter table public.barracas
  add constraint barracas_fuso_valido
  check (fuso in ('America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha'));
