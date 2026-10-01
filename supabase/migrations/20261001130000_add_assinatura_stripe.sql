-- Substitui a Kirvano pela Stripe como processadora da assinatura SaaS
-- (cobrança dono da barraca → Sai aê). Decisão do dono do produto,
-- 2026-10-01: "substitua tudo da Kirvano".
--
-- Não apaga nada da Kirvano (tabelas, colunas, funções) — histórico de
-- quem já pagou por ela continua legível, e processar_webhook_kirvano
-- fica inofensivo (só não recebe mais eventos novos depois que o
-- destino de webhook for desativado no painel da Kirvano). O que muda é
-- o CAMINHO NOVO: /assinar passa a criar uma Checkout Session da Stripe
-- (edge function `criar-checkout-stripe`) em vez de redirecionar pra um
-- link estático; webhook-stripe (edge function, verifica assinatura
-- HMAC — por isso é function, não RPC via PostgREST como a Kirvano
-- era) processa os eventos e atualiza esta mesma tabela `assinaturas`.
--
-- assinatura_tem_acesso()/barraca_assinatura_ativa()/assinatura_da_barraca()
-- não mudam — são genéricas de status/timestamp, não sabem qual provedor
-- gerou a linha.

alter table public.assinaturas
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

-- assinatura_ofertas trocava plano/ciclo → link estático da Kirvano; agora
-- trocam plano/ciclo → price_id da Stripe (usado por criar-checkout-stripe
-- pra montar a Checkout Session). checkout_url vira legado/nullable —
-- Stripe não usa link fixo, a URL de checkout é criada na hora por
-- sessão. price_id começa nulo: preencher depois que os 4 Preços forem
-- criados no painel da Stripe (ver comentário no fim do arquivo).
alter table public.assinatura_ofertas
  add column if not exists stripe_price_id text unique,
  alter column checkout_url drop not null;

-- Log bruto + idempotência de cada evento recebido da Stripe — mesmo
-- padrão de eventos_webhook_kirvano, mas dedupe pelo id do evento da
-- Stripe (já vem garantidamente único, não precisa compor chave).
create table if not exists public.eventos_webhook_stripe (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event text,
  subscription_id text,
  payload jsonb not null,
  error text,
  received_at timestamptz not null default now()
);

alter table public.eventos_webhook_stripe enable row level security;
-- sem policies: só a Edge Function (service role) grava/lê

-- ---------------------------------------------------------------------
-- Depois de aplicar esta migration:
--
-- 1. Criar os 4 Preços recorrentes no painel da Stripe (Essencial/Pro ×
--    mensal/anual) e preencher o price_id de cada linha:
--      update public.assinatura_ofertas set stripe_price_id = 'price_xxx'
--      where plano = 'essencial' and ciclo = 'mensal';
--      -- repetir pros outros 3
--
-- 2. Configurar secrets da function (supabase secrets set):
--      STRIPE_SECRET_KEY        (chave secreta da API, sk_... )
--      STRIPE_WEBHOOK_SECRET    (assinatura do webhook, whsec_...)
--
-- 3. Deploy: supabase functions deploy criar-checkout-stripe
--            supabase functions deploy webhook-stripe --no-verify-jwt
--    (--no-verify-jwt porque quem chama é a Stripe, sem JWT do Supabase
--    Auth — a autenticação de verdade é a assinatura HMAC verificada
--    dentro da function)
-- ---------------------------------------------------------------------
