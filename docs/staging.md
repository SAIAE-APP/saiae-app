# Staging

Projeto Supabase **`qzcqwovbbylqxljcrqhk`** ("Sai ae staging", sa-east-1). Tem o schema `public` da produção e **nenhum dado real**. Produção é `vimjwzumjggrlvlxdejr`: **nunca** use para teste, deploy de teste ou escrita de experimento.

## Regras
- Só dados fictícios. Pagamento só com **credenciais de sandbox** do Mercado Pago (token de teste); Stripe só com chaves de teste; NFC-e só em homologação.
- Segredos só em variáveis de ambiente, arquivos `.env.*` locais (gitignored) ou `supabase secrets`. A senha do banco de staging fica fora do repositório.
- Migration entra primeiro no staging e só depois na produção.

## Como NÃO apontar para produção
- **Atenção ao link da CLI:** a pasta `supabase/.temp` guarda o projeto "linkado" da CLI, e comandos com `--linked` usam ele. Num clone que já foi linkado à produção, `--linked` cai na **produção**. Por isso nada aqui usa `--linked` sozinho.
- Todo comando que escreve no Supabase passa pelos scripts `npm run staging:*` (`scripts/staging.mjs`). Eles:
  - passam `--project-ref qzcqwovbbylqxljcrqhk` explícito (nunca confiam no link local);
  - **abortam** se `supabase/.temp/project-ref` ou `linked-project.json` apontarem para a produção (`supabase link --project-ref qzcqwovbbylqxljcrqhk` corrige).
- O seed ainda aborta no próprio SQL se o banco tiver pedidos e não tiver a barraca de seed (não é um staging virgem).
- O app em modo staging (`dev:staging`, `build:staging`) lê **`.env.staging.local`**, nunca `.env`. `scripts/verificar-env-staging.mjs` roda antes e **aborta** se a URL ou a chave anon (o `ref` dentro do JWT) forem da produção ou de outro projeto.
- Não rode `npm run android:sync` com env de staging: o build Android exige o env de produção (`scripts/verificar-env-build.mjs`).
- Nunca rode `supabase db push`, `migration repair` ou `functions deploy` "na mão" sem `--project-ref`; use os scripts.

## Subir o app apontando para o staging
1. `cp .env.staging.example .env.staging.local`
2. Preencha `VITE_SUPABASE_ANON_KEY` (Dashboard do projeto de staging → Settings → API; é a chave anon/publishable).
3. `npm run dev:staging` (ou `npm run build:staging`).

## Preparar o banco de staging (uma vez)
Precisa da CLI logada (`supabase login`).

| Passo | Comando | O que faz |
|---|---|---|
| 1 | `npm run staging:repair` | Marca as migrations existentes como aplicadas (o schema já foi carregado; sem isso o `push` tentaria reaplicar tudo). Depois, `npm run staging:list` deve mostrar Local e Remote preenchidos. |
| 2 | `npm run staging:deploy` | Publica as edge functions. As públicas (`criar-pagamento-pix`, `criar-pedido-cardapio`, `webhook-mercadopago`, `webhook-stripe`) vão com `--no-verify-jwt`. |
| 3 | secrets (abaixo) | Só sandbox/teste. |
| 4 | `npm run staging:seed` | 1 barraca, 1 usuário dono, categorias, itens e bairros fictícios. Imprime a senha do `dono@staging.saiae.invalid` uma única vez, e só se o usuário foi criado agora. Idempotente. |

Migration nova depois disso: `npm run staging:push`.

### Secrets do staging
As variáveis padrão do Supabase (URL, chave anon e chave de service role) já existem em toda edge function. Opcionais, sempre de teste:
```
supabase secrets set --project-ref qzcqwovbbylqxljcrqhk STRIPE_SECRET_KEY=<chave de TESTE> STRIPE_WEBHOOK_SECRET=<segredo do webhook de TESTE>
supabase secrets set --project-ref qzcqwovbbylqxljcrqhk RESEND_API_KEY=<...> BUG_REPORT_EMAIL_DESTINO=<e-mail de teste>
```
O token do Mercado Pago **não** é secret global: cada barraca grava o seu em Ajustes → Pagamento online (tabela `barracas_pagamento_token`). Use o token de **teste** de uma conta de teste do Mercado Pago, na barraca de staging.

## Webhooks
A URL de notificação do Pix é montada por pagamento a partir de `SUPABASE_URL` da própria função, então no staging ela já aponta para o staging. Não configure nada no painel do Mercado Pago apontando para produção.
