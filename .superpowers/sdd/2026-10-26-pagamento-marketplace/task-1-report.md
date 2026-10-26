# Task 1 - spike no sandbox (script escrito, NAO executado contra a rede)

Entregue: scripts/spike-mp-marketplace.mjs e scripts/spike-mp-marketplace.README.md.
Subcomandos: auth-url, trocar <code>, pix, cartao, cartao-recusado, estorno <payment_id>. Todos terminam com bloco RESULTADO (a-e).

Verificacao: node --check OK; auth-url com env falsa no processo imprime a URL; pix sem MP_SPIKE_SANDBOX=sim recusa e sai com 1.

Docs usadas (Context7 + WebFetch): URL de autorizacao https://auth.mercadopago.com/authorization?client_id&response_type=code&platform_id=mp&state&redirect_uri; POST /oauth/token (test_token); application_fee em POST /v1/payments; cartoes de teste (Mastercard 5480 8328 0103 3311, CVV 123, 11/30; APRO aprova, OTHE recusa; CPF 12345678909); POST /v1/payments/{id}/refunds.

Nao confirmado nas docs (marcado no codigo e no README):
- corpo de POST /v1/card_tokens?public_key= (usado o padrao do SDK JS);
- caminho da comissao na resposta (script varre chaves/tipos com "fee");
- se o estorno devolve a comissao (API so retorna status; conferir no painel);
- necessidade de test_token no /oauth/token (enviado sempre como 'true');
- pagina OAuth de split-payments deu 404; usada a do Checkout API;
- payment_method_id do cartao fixo em 'master'.

Salvaguardas: exige MP_SPIKE_SANDBOX=sim (nao detecta producao sozinho: tokens de teste tambem sao APP_USR); nunca imprime tokens/QR; tokens gravados em .env.spike (mode 0600 + icacls no Windows, melhor esforco; ACL nao testada).
