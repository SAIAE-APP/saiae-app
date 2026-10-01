-- Price IDs do modo LIVE da Stripe — preencher assim que os 4 Preços
-- forem criados na conta real (pendente: ativação de Payments/Billing,
-- dados de CNPJ/conta bancária). Os price_ids de Teste (migration
-- 20261001140000) deixam de valer a partir daqui — webhook-stripe passa
-- a usar STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET de Live (corte literal,
-- função única, ver CLAUDE.md).

-- update public.assinatura_ofertas set stripe_price_id = 'price_LIVE_AQUI'
-- where plano = 'essencial' and ciclo = 'mensal';

-- update public.assinatura_ofertas set stripe_price_id = 'price_LIVE_AQUI'
-- where plano = 'essencial' and ciclo = 'anual';

-- update public.assinatura_ofertas set stripe_price_id = 'price_LIVE_AQUI'
-- where plano = 'pro' and ciclo = 'mensal';

-- update public.assinatura_ofertas set stripe_price_id = 'price_LIVE_AQUI'
-- where plano = 'pro' and ciclo = 'anual';
