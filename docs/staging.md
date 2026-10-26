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
  - **abortam** se `supabase/.temp/project-ref` e `linked-project.json` não forem o de staging: produção, outro projeto, link ausente ou ilegível (`supabase link --project-ref qzcqwovbbylqxljcrqhk` corrige).
  - **Cuidado:** `supabase link` muda o link da CLI **daquela pasta**. Em outra cópia do repositório (a pasta de trabalho do dono, por exemplo), isso troca o projeto padrão dos comandos `--linked`. Prefira um clone/worktree separado para staging.
- O seed ainda aborta no próprio SQL se existir qualquer barraca diferente da de seed ou qualquer usuário com e-mail que não termine em `.invalid`. Consequência: o staging é só para dados fictícios; se alguém criar usuário com e-mail real lá, o re-seed passa a abortar.
- O app em modo staging (`dev:staging`, `build:staging`) lê **`.env.staging.local`**, nunca `.env`. `scripts/verificar-env-staging.mjs` roda antes e **aborta** se a URL ou a chave anon (o `ref` dentro do JWT) forem da produção ou de outro projeto.
- Não rode `npm run android:sync` com env de staging: o build Android exige o env de produção (`scripts/verificar-env-build.mjs`).
- Nunca rode `supabase db push`, `migration repair` ou `functions deploy` "na mão" sem `--project-ref`; use os scripts.

## Subir o app apontando para o staging
1. `cp .env.staging.example .env.staging.local`
2. Preencha `VITE_SUPABASE_ANON_KEY` (Dashboard do projeto de staging → Settings → API; é a chave anon/publishable).
3. `npm run dev:staging` (ou `npm run build:staging`).

## Preparar o banco de staging (uma vez)
Precisa da CLI logada (`supabase login`), do executável `supabase` no PATH e do link da pasta no staging (`supabase link --project-ref qzcqwovbbylqxljcrqhk`).

| Passo | Comando | O que faz |
|---|---|---|
| 1 | `npm run staging:repair` | Marca as migrations existentes como aplicadas (o schema já foi carregado; sem isso o `push` tentaria reaplicar tudo). Depois, `npm run staging:list` deve mostrar Local e Remote preenchidos. |
| 2 | `npm run staging:deploy` | Publica as edge functions. As públicas (`criar-pagamento-pix`, `criar-pedido-cardapio`, `webhook-mercadopago`, `webhook-stripe`, `mp-oauth-callback`) vão com `--no-verify-jwt`. |
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

## Pagamento marketplace (Mercado Pago OAuth, Pix e cartão com taxa Sai aê)
Arquitetura em `CLAUDE.md` (seção "Pagamento marketplace") e na spec `docs/superpowers/specs/2026-10-26-pagamento-marketplace-design.md`. Em resumo: a barraca conecta a própria conta por OAuth, a cobrança (`POST /v1/payments`) usa o token OAuth dela com `application_fee` de R$ 0,99, o cartão é tokenizado no navegador com a chave pública do VENDEDOR (buscada pela action `chave_publica` de `criar-pagamento-pix`), o webhook confirma cartão e Pix, e `estornar-pagamento` faz estorno total (a taxa volta junto).

### Secrets novos (somente conta de teste no staging)
```
supabase secrets set --project-ref qzcqwovbbylqxljcrqhk MP_CLIENT_ID=<client_id da aplicação de TESTE> MP_CLIENT_SECRET=<client_secret> MP_OAUTH_REDIRECT_URI=<URL cadastrada na aplicação, idêntica, com a barra final> CORTE_TOKEN_MP_ISO=<data ISO do corte>
supabase secrets set --project-ref qzcqwovbbylqxljcrqhk APP_PUBLIC_URL=<URL pública do app>   # opcional
```
- `MP_OAUTH_REDIRECT_URI` precisa ser IGUAL, caractere a caractere, à URL de redirecionamento cadastrada na aplicação do Mercado Pago, inclusive a barra final (`https://example.com/` e `https://example.com` são URLs diferentes para o Mercado Pago).
- `CORTE_TOKEN_MP_ISO` (secret das functions) e `VITE_CORTE_TOKEN_MP_ISO` (variável do build do front, em `.env.staging.local`) devem ter o MESMO valor: a primeira decide no servidor, a segunda só ajusta avisos e textos da tela. Sem a variável, o corte não chegou.
- `VITE_MP_PUBLIC_KEY` NÃO é usada: a chave pública do cartão é a do vendedor e vem do backend.
- Nunca grave esses valores no repositório.

### Ordem de deploy
1. Migration `20261104100000_pagamento_marketplace.sql` (`npm run staging:push`).
2. Functions: `mp-oauth-callback` com `--no-verify-jwt` (é aberta pelo redirecionamento do navegador, sem JWT), mais `mp-oauth-iniciar`, `estornar-pagamento` (com JWT), `criar-pagamento-pix`, `webhook-mercadopago` e `salvar-credencial`. O `npm run staging:deploy` já cobre essa lista.
3. Front (`npm run build:staging`).

### Procedimento de corte do token antigo
1. Confirmar quantas barracas usam Pix hoje e que conectaram por OAuth.
2. Avisar as barracas com antecedência (sugestão: 14 dias; decisão do dono).
3. Definir a mesma data em `CORTE_TOKEN_MP_ISO` (secret) e `VITE_CORTE_TOKEN_MP_ISO` (build) e publicar o front.
4. Depois da data, a barraca sem OAuth deixa de cobrar Pix online (cai para "pagar na entrega") e `salvar-credencial` recusa token colado novo.

### Sandbox do Mercado Pago: o que a spike ensinou
- São necessárias TRÊS contas de teste: a dona da aplicação (marketplace), a vendedora (a barraca) e a compradora.
- A aplicação precisa ser criada PELA conta de teste do marketplace. Criada na conta real, o Mercado Pago mistura produção e teste e devolve erros como 2034 / `user_allowed_only_in_test`.
- O login de conta de teste usa só o nome de usuário (sem `@testuser.com`). Para a vendedora, autorize o OAuth em janela anônima.
- A chave pública de teste fica em "Credenciais de produção" da própria conta de teste (credenciais `APP_USR`).
- O redirect salvo na aplicação exige correspondência exata (barra final incluída).
- Pix com `application_fee` foi aceito (pagamento criado, pendente). O campo da comissão não aparece no pagamento pendente e o estorno só funciona depois de aprovado.
- Cartão com token OAuth devolveu HTTP 500 (`internal_error`) no sandbox, com e sem `application_fee` e com o cartão de teste oficial: NÃO provado. Com a chave pública errada o erro é 2006 ("Card Token not found"); com a do vendedor a tokenização funciona.
- Risco de longo prazo: o Mercado Pago avisa que a API de Payments será descontinuada.

### Verificação ponta a ponta (pendente)
Falta rodar no staging, com contas de teste: conectar a barraca por OAuth, pagar Pix e cartão com taxa, conferir no painel que R$ 0,99 foi para o Sai aê e o resto para a barraca, repetir a notificação do webhook (um só pedido), forçar cartão recusado, estornar (taxa devolvida) e expirar o token OAuth (a barraca cai para "pagar na entrega").
