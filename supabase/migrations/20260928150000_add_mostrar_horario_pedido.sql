-- Config de exibição do cabeçalho do card de pedido (Cozinha/Detalhe da
-- Comanda, pedido de produto 2026-09-28): dono escolhe entre cronômetro
-- (tempo decorrido, comportamento atual, default) ou horário de envio pra
-- cozinha. Boolean simples, mesmo padrão de itens.esgotado/popular. Não
-- afeta a cor do semáforo (corPorTempo) — isso continua sempre por tempo
-- decorrido, nunca personalizável (regra do CLAUDE.md).
alter table public.barracas
  add column mostrar_horario_pedido boolean not null default false;
