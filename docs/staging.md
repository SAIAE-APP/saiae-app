# Staging

Projeto Supabase **`qzcqwovbbylqxljcrqhk`** ("Sai ae staging", sa-east-1). Tem o schema `public` da produção e **nenhum dado real**. Produção é `vimjwzumjggrlvlxdejr`: **nunca** use para teste, deploy de teste ou escrita de experimento.

## Regras
- Só dados fictícios. Pagamento só com **credenciais de sandbox** do Mercado Pago (token de teste); Stripe só com chaves de teste; NFC-e só em homologação.
- Segredos só em variáveis de ambiente / arquivos `*.local` (gitignored) / `supabase secrets`. A senha do banco de staging fica fora do repositório.
- Migration entra primeiro no staging e só depois na produção.

## Como NÃO apontar para produção
- O build/dev de staging usa `vite --mode staging` e lê **`.env.staging.local`**, nunca `.env`.
- `scripts/verificar-env-staging.mjs` roda antes de `dev:staging` e `build:staging` e **aborta** se a URL for a de produção ou qualquer projeto diferente do de staging.
- Os comandos `supabase` abaixo passam `--project-ref qzcqwovbbylqxljcrqhk` explicitamente. Confira `supabase/.temp/project-ref` antes de qualquer `db push`; se não for o de staging, rode `supabase link --project-ref qzcqwovbbylqxljcrqhk`.
- Não rode `npm run android:sync` com `.env.staging.local`: o build Android usa o env de produção (`scripts/verificar-env-build.mjs`).

## Subir o app apontando para o staging
1. `cp .env.staging.example .env.staging.local`
2. Preencha `VITE_SUPABASE_ANON_KEY` (Dashboard do projeto de staging → Settings → API; é a chave anon/publishable).
3. `npm run dev:staging` (ou `npm run build:staging`).

## Preparar o banco de staging (uma vez)
A CLI precisa estar logada (`supabase login`) e linkada ao staging: `supabase link --project-ref qzcqwovbbylqxljcrqhk`.

1. **Marcar as migrations existentes como aplicadas** (o schema já foi carregado; sem isso o `db push` tentaria reaplicar tudo):
   ```
   supabase migration repair --status applied $(ls supabase/migrations | sed 's/_.*//') --linked
   supabase migration list --linked   # todas com Local e Remote preenchidos
   ```
   Daqui em diante, migration nova: `supabase db push --linked` (com o link no staging).
2. **Publicar as edge functions** (as públicas, chamadas sem JWT de usuário, usam `--no-verify-jwt`):
   ```
   R=qzcqwovbbylqxljcrqhk
   for f in criar-pagamento-pix criar-pedido-cardapio webhook-mercadopago webhook-stripe; do supabase functions deploy $f --project-ref $R --no-verify-jwt; done
   for f in emitir-nfce excluir-conta reportar-bug criar-checkout-stripe cancelar-assinatura-stripe; do supabase functions deploy $f --project-ref $R; done
   ```
3. **Secrets do staging** (só sandbox/teste). as variáveis padrão do Supabase (URL, chave anon e chave de service role) já existem em toda edge function. Opcionais:
   ```
   supabase secrets set --project-ref $R STRIPE_SECRET_KEY=<chave de TESTE> STRIPE_WEBHOOK_SECRET=<segredo do webhook de TESTE>
   supabase secrets set --project-ref $R RESEND_API_KEY=<...> BUG_REPORT_EMAIL_DESTINO=<e-mail de teste>
   ```
   O token do Mercado Pago **não** é secret global: cada barraca grava o seu em Ajustes → Pagamento (tabela `barracas_pagamento_token`). Use o token de **teste** de uma conta de teste do Mercado Pago, na barraca de staging.
4. **Seed fictício** (1 barraca, 1 usuário dono, categorias, itens e bairros):
   ```
   node scripts/seed-staging.mjs
   ```
   Imprime uma vez a senha do usuário `dono@staging.saiae.invalid`. É idempotente e só roda contra o projeto de staging.

## Webhooks
A URL de notificação do Pix é montada por pagamento a partir de `SUPABASE_URL` da própria função, então no staging ela já aponta para o staging. Não configure nada no painel do Mercado Pago apontando para produção.
