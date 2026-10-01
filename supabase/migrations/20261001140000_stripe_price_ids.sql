-- Price IDs reais criados no painel da Stripe (modo Teste), 2026-10-01 —
-- 2 produtos separados ("Sai aê Essencial"/"Sai aê Pro"), mas o código
-- (webhook-stripe) identifica plano/ciclo pelo price_id, não pelo
-- produto, então isso não afeta nada aqui.

update public.assinatura_ofertas set stripe_price_id = 'price_1ULmo28w38ckKPuBG7ShMCsz'
where plano = 'essencial' and ciclo = 'mensal';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULmo18w38ckKPuB1IUGVUmw'
where plano = 'essencial' and ciclo = 'anual';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULmq78w38ckKPuB601gVZF4'
where plano = 'pro' and ciclo = 'mensal';

update public.assinatura_ofertas set stripe_price_id = 'price_1ULmq78w38ckKPuBM1ogbYad'
where plano = 'pro' and ciclo = 'anual';
