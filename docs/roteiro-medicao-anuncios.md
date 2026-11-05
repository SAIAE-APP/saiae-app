# Medição de anúncios (UTM, Pixel do Meta, GA4, Purchase pelo servidor)

PRs: A (UTM), B (Pixel/GA4 no navegador + aviso de cookies + CSP), C (Purchase pelo servidor). Nada disto vale em produção até o João aplicar as migrations e criar os secrets.

## Ordem para ligar
1. Aplicar `20261107100000_origem_cadastro_utm.sql` e `20261107110000_consentimento_marketing_purchase.sql` (o app tolera a falta delas).
2. Secrets do Supabase (por clipboard, nunca no chat):
   - `META_CAPI_TOKEN` — token da Conversions API (Gerenciador de Eventos > Pixel 442066388679102 > Configurações).
   - `GA4_API_SECRET` — GA4 > Admin > Fluxos de dados > Measurement Protocol (propriedade de G-R72CK0Q5DV).
   - opcional `META_TEST_EVENT_CODE` — só para testar no "Eventos de teste" da Meta; remover depois.
3. Reimplantar `webhook-stripe` (`--no-verify-jwt`, como sempre). Sem os dois secrets o envio fica desligado.

## Como conferir
- Cadastro: abrir `app.saiae.com.br/cadastro?utm_source=meta&utm_campaign=teste`, criar a conta e ver `utm_*`/`cadastro_origem_em` em `assinaturas`.
- Cookies: sem aceitar, a aba Rede não deve chamar `connect.facebook.net` nem `googletagmanager.com`. Aceitando, aparecem; `CompleteRegistration` (Meta) e `sign_up` (GA4) saem ao criar a conta.
- Compra: com cookies aceitos e `consentimento_marketing = true` na conta, a 1ª cobrança paga envia `Purchase` (event_id = id da fatura Stripe `in_...`) à Meta e `purchase` ao GA4. Renovação e reentrega não repetem (`purchase_enviado_em`).
