-- Price IDs do modo LIVE da Stripe, 2026-10-01 — conta real ativada,
-- produtos "Sai aê Essencial" (prod_VMXNinH0kEdggd) e "Sai aê Pro"
-- (prod_VMXPbqaBTUgln7), webhook saiae-assinaturas-producao
-- (we_1ULoS1QFnZaBIrpvPmpPgPFN) apontando pra webhook-stripe. Os
-- price_ids de Teste (migration 20261001140000) deixam de valer a partir
-- daqui — troca dos secrets (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET)
-- pros de Live é o corte literal (função única, ver CLAUDE.md).

update public.assinatura_ofertas set stripe_price_id = 'price_1ULoIOQFnZaBIrpvZNIZYIjZ'
where plano = 'essencial' and ciclo = 'mensal';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULoIOQFnZaBIrpv2nklf2hk'
where plano = 'essencial' and ciclo = 'anual';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULoLAQFnZaBIrpvzoI1EJH6'
where plano = 'pro' and ciclo = 'mensal';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULoLAQFnZaBIrpvrstuVblZ'
where plano = 'pro' and ciclo = 'anual';
