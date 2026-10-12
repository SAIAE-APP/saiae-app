-- Auditoria B10: a Kirvano não é mais usada (cobrança é Stripe desde 20261001130000;
-- o dono confirmou em 2026-10-12). Remove a superfície pública legada.
--
-- A rota Cloudflare functions/api/webhooks/kirvano.ts foi apagada no mesmo PR.
-- processar_webhook_kirvano era executável por anon e comparava o token em texto
-- puro (configuracao_webhook_kirvano). Nada mais as referencia.
--
-- Mantidos de propósito (histórico de quem pagou pela Kirvano continua legível):
--   * eventos_webhook_kirvano (RLS ligado, sem policy)
--   * colunas assinaturas.kirvano_* e assinatura_ofertas

do $$
begin
  if to_regprocedure('public.processar_webhook_kirvano(jsonb, text)') is not null then
    revoke all on function public.processar_webhook_kirvano(jsonb, text) from public, anon, authenticated;
  end if;
end;
$$;

drop function if exists public.processar_webhook_kirvano(jsonb, text);

-- Guardava o token do webhook em texto puro.
drop table if exists public.configuracao_webhook_kirvano;
