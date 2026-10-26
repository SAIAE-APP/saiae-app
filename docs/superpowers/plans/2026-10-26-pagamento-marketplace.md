# Pagamento online no cardápio (Mercado Pago marketplace, Pix e cartão, taxa Sai aê) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pix e cartão à vista no cardápio digital via Mercado Pago em modo marketplace, com R$ 0,99 de taxa do Sai aê por pedido pago online, cada barraca conectada por OAuth.

**Architecture:** O adaptador `mercadopago.ts` atrás da interface `ProvedorPix` ganha `application_fee`, cobrança por cartão (token de cartão gerado no navegador com a chave pública do Sai aê) e estorno. O token por barraca passa a vir de OAuth (cifrado, com renovação) em vez do token colado. Todo valor segue calculado no servidor e o webhook continua consultando o provedor de volta antes de criar o pedido.

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), React + Vite + TypeScript, SDK JS do Mercado Pago no front.

**Spec:** `docs/superpowers/specs/2026-10-26-pagamento-marketplace-design.md` (ler antes; ler também o `CLAUDE.md` do repositório, seções de Pix, cupons e centavos).

**Onde trabalhar:** clone de `https://github.com/SAIAE-APP/saiae-app.git` (commit de referência `9fe6760`), em branch própria. A pasta `C:\Users\AORUS\saiae-app` não é repositório git.

## Global Constraints

- Provedor: só Mercado Pago. Meios: Pix e cartão de crédito. Sem parcelamento: parcelas sempre 1.
- Taxa do Sai aê: R$ 0,99 = 99 centavos, em Pix e cartão, só em pagamento online. "Pagar na entrega" e pedido grátis (total 0) não levam taxa.
- Dinheiro em centavos inteiros no código e no banco; converter para decimal só na chamada do Mercado Pago (`centavosParaDecimal`).
- Preço, desconto de cupom, taxa de entrega e taxa Sai aê são calculados só no servidor; o cliente envia `total_esperado_centavos` e recebe 409 com o novo total se divergir.
- Dados de cartão nunca passam pelo servidor do Sai aê nem entram em log ou banco: só `card_token`.
- Segredos cifrados com `_shared/segredoCifrado.ts`, sem policy de leitura no front.
- Toda barraca precisa de OAuth ativo para receber online depois do corte (`CORTE_TOKEN_MP_ISO`); antes do corte o token colado ainda vale, sem taxa.
- Migrações aditivas. `criar_pedido`, RLS atuais e fila offline não mudam.
- A taxa Sai aê nunca entra em faturamento, NFC-e nem `nfce_taxa_servico_centavos`. Nome no código: `taxa_plataforma_centavos`; texto na tela: "Taxa de serviço Sai aê".
- Estorno devolve itens, taxa de entrega e os R$ 0,99. Chargeback é da barraca.

## Review Focus

1. Notificação repetida de um pagamento já aprovado: um só pedido (teste na Task 2 e na Task 7).
2. Cartão recusado ou em análise: nenhum pedido, e o mesmo `client_uuid` pode tentar de novo sem cobrança duplicada (Task 6).
3. Valor pago ou comissão diferente do gravado no pendente: não cria pedido, registra conciliação (Tasks 2 e 7).
4. Token OAuth vencido durante a cobrança ou renovação falhando: barraca vira "desconectada", cardápio oferece só "pagar na entrega", sem erro 500 (Tasks 4 e 6).
5. Cupom de 100% ou total zero: sem taxa e sem chamar o provedor (Task 2).
6. Estorno recusado por saldo insuficiente da barraca: erro claro ao dono, pedido não é marcado como estornado (Task 8).

---

### Task 1: Spike no sandbox (portão de viabilidade)

**Files:**
- Create: `scripts/spike-mp-marketplace.mjs` (descartável, não vai para produção)
- Modify: `docs/superpowers/specs/2026-10-26-pagamento-marketplace-design.md` (seção "Resultado do spike")

**Interfaces:**
- Produces: registro no spec de (a) se `application_fee` funciona em Pix e em cartão com token OAuth de vendedor de teste, (b) o nome exato do campo onde o Mercado Pago devolve a comissão no pagamento (ex.: dentro de `fee_details`), (c) o escopo e a redirect URI exigidos pelo OAuth, (d) o formato da URL de autorização. As Tasks 4, 5 e 7 usam estes valores.

- [ ] **Step 1:** Com o dono, criar a aplicação do Sai aê no painel do Mercado Pago (client_id, client_secret, redirect URI da função `mp-oauth-callback`) e duas contas de teste (marketplace e vendedor). Registrar no spec quem criou e quando.
- [ ] **Step 2:** Escrever `scripts/spike-mp-marketplace.mjs` que, com o access token OAuth do vendedor de teste, cria um pagamento Pix e um de cartão (token gerado pelo SDK no sandbox) com `application_fee: 0.99` e `transaction_amount: 10.00`, e imprime o JSON completo da resposta e do `GET /v1/payments/{id}`.
- [ ] **Step 3:** Rodar: `node scripts/spike-mp-marketplace.mjs`. Esperado: os dois pagamentos criados e `application_fee` aceito. **Se o Pix rejeitar `application_fee`, parar e voltar ao dono: o desenho do Pix muda.**
- [ ] **Step 4:** Registrar no spec, em "Resultado do spike", os itens (a) a (d) e o comportamento de estorno parcial/total (`POST /v1/payments/{id}/refunds`).
- [ ] **Step 5: Commit** (`docs: resultado do spike de marketplace`).

### Task 2: Regras puras da taxa e da conciliação

**Files:**
- Create: `supabase/functions/_shared/pagamento/taxaPlataforma.ts`
- Modify: `supabase/functions/_shared/pagamento/conciliacao.ts`
- Test: `supabase/functions/_shared/pagamento/pagamento.test.ts`

**Interfaces:**
- Produces: `export const TAXA_PLATAFORMA_CENTAVOS = 99`; `export function aplicarTaxaPlataforma(totalSemTaxaCentavos: number): { taxaPlataformaCentavos: number; totalCentavos: number }`; `totalEsperadoDoPendente(itens, taxaEntregaCentavos, descontoCupomCentavos = 0, taxaPlataformaCentavos = 0): number`; `decidirAprovado` ganha o parâmetro `comissaoPagaCentavos: number | null` e `taxaPlataformaEsperadaCentavos: number`.

- [ ] **Step 1: Write the failing tests** em `pagamento.test.ts`: `aplicarTaxaPlataforma(1500)` devolve `{ taxaPlataformaCentavos: 99, totalCentavos: 1599 }`; `aplicarTaxaPlataforma(0)` devolve `{ taxaPlataformaCentavos: 0, totalCentavos: 0 }` (pedido grátis); `totalEsperadoDoPendente` com taxa 99, itens 1500, entrega 300, cupom 200 = 1699; sem o 4º argumento o resultado é o de hoje; `decidirAprovado` com status `aprovado`, comissão paga 50 e esperada 99 devolve `{ acao: 'conciliar_valor' }`; com status `aprovado` (já processado) devolve `{ acao: 'ignorar' }`; pendente antigo sem taxa (esperada 0, comissão null) segue como hoje.
- [ ] **Step 2:** Rodar `node --experimental-strip-types supabase/functions/_shared/pagamento/pagamento.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** Implementar as funções acima. A comparação de comissão só vale quando `taxaPlataformaEsperadaCentavos > 0`.
- [ ] **Step 4:** Rodar o mesmo comando. Esperado: PASS, incluindo os testes antigos.
- [ ] **Step 5: Commit** (`feat: regras puras da taxa Sai aê e conciliação com comissão`).

### Task 3: Migration (dados da taxa, OAuth e estados)

**Files:**
- Create: `supabase/migrations/<timestamp posterior à última do repositório>_pagamento_marketplace.sql`
- Test: `tests/pagamentoMarketplaceMigration.test.ts` (mesmo estilo dos `tests/*Migration.test.ts`: lê o SQL e confere por texto)

**Interfaces:**
- Produces: `pagamentos_pendentes.estornado_em timestamptz` (nulo = não estornado, usado na Task 8); `pagamentos_pendentes.taxa_plataforma_centavos integer not null default 0` e `pedidos.taxa_plataforma_centavos integer not null default 0` (ambos `check >= 0`); tabela `barracas_mp_oauth(barraca_id uuid primary key references barracas, access_token_cifrado text, refresh_token_cifrado text, mp_user_id text, expira_em timestamptz, status text check (status in ('conectada','desconectada')), atualizado_em timestamptz)` com RLS ligada e **nenhuma policy**; tabela `mp_oauth_estados(state uuid primary key, barraca_id uuid, usuario_id uuid, expira_em timestamptz)` também sem policy; RPC `mp_oauth_status(p_barraca_id uuid) returns table(conectada boolean, atualizado_em timestamptz)` com `security definer` que confere `usuario_tem_acesso_barraca(p_barraca_id)` e erro genérico caso contrário.

- [ ] **Step 1: Write the failing test** conferindo no SQL: as duas colunas com default 0, RLS ligada sem `create policy` nas duas tabelas novas, e que `mp_oauth_status` chama `usuario_tem_acesso_barraca`.
- [ ] **Step 2:** `npm test -- --test-name-pattern="pagamentoMarketplace"`. Esperado: FAIL (arquivo não existe).
- [ ] **Step 3:** Escrever a migration conforme as Interfaces.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS. Aplicar no staging seguindo `docs/staging.md` e conferir que as barracas atuais continuam lendo o cardápio.
- [ ] **Step 5: Commit.**

### Task 4: OAuth da barraca (conectar, renovar, estado desconectada)

**Files:**
- Create: `supabase/functions/_shared/pagamento/oauthMercadoPago.ts`, `supabase/functions/mp-oauth-iniciar/index.ts`, `supabase/functions/mp-oauth-callback/index.ts`
- Modify: `supabase/functions/_shared/pagamento/token.ts`
- Test: `supabase/functions/_shared/pagamento/pagamento.test.ts`

**Interfaces:**
- Consumes: segredos `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_OAUTH_REDIRECT_URI`; `cifrar`/`lerSegredo` de `_shared/segredoCifrado.ts`; formato da URL e escopos registrados na Task 1.
- Produces: `montarUrlAutorizacao(p: { clientId: string; redirectUri: string; state: string }): string`; `trocarCodigo(p: { clientId; clientSecret; redirectUri; code }): Promise<TokensMp>`; `renovar(p: { clientId; clientSecret; refreshToken }): Promise<TokensMp>`; `type TokensMp = { accessToken: string; refreshToken: string; expiraEmSegundos: number; userId: string }`; `precisaRenovar(expiraEmIso: string, agora: Date, folgaMinutos = 60): boolean`; em `token.ts`: `obterTokenVendedor(supabase: unknown, barracaId: string, env?: EnvMinimo): Promise<{ ok: true; token: string } | { ok: false; motivo: 'nao_conectada' | 'renovacao_falhou' }>`.

- [ ] **Step 1: Write the failing tests:** `precisaRenovar` verdadeiro a 30 min do vencimento e falso a 2 h; `montarUrlAutorizacao` contém `client_id`, `redirect_uri` e `state` codificados; `obterTokenVendedor` com cliente Supabase falso: token válido devolve `ok: true` sem chamar renovação, token vencido renova e grava os novos tokens cifrados, renovação com erro marca `status = 'desconectada'` e devolve `{ ok: false, motivo: 'renovacao_falhou' }`, sem linha devolve `nao_conectada`.
- [ ] **Step 2:** Rodar o teste de funções. Esperado: FAIL.
- [ ] **Step 3:** Implementar `oauthMercadoPago.ts` e `obterTokenVendedor`. Duas requisições simultâneas de renovação não podem invalidar o refresh token uma da outra: usar `update ... where atualizado_em = <leitura>` e reler se perder a corrida. `mp-oauth-iniciar`: exige JWT, confere dono da barraca, grava linha em `mp_oauth_estados` (validade 10 min) e devolve `{ url }`. `mp-oauth-callback` (sem JWT, como `webhook-mercadopago` em `supabase/config.toml`): consome o `state` (uso único, apaga a linha), troca o código, grava tokens cifrados com `status = 'conectada'` e redireciona para `/ajustes?mp=ok` ou `?mp=erro`. Nenhum token em log.
- [ ] **Step 4:** Rodar de novo. Esperado: PASS. Teste manual no sandbox: conectar uma conta vendedora de teste e ver a linha cifrada.
- [ ] **Step 5: Commit.**

### Task 5: Adaptador Mercado Pago (comissão, cartão, estorno)

**Files:**
- Modify: `supabase/functions/_shared/pagamento/tipos.ts`, `supabase/functions/_shared/pagamento/mercadopago.ts`
- Test: `supabase/functions/_shared/pagamento/pagamento.test.ts`

**Interfaces:**
- Produces em `tipos.ts`: `ParamsCobranca` ganha `taxaPlataformaCentavos?: number`; `type ParamsCobrancaCartao = Omit<ParamsCobranca, 'expiraEm'> & { cardToken: string; paymentMethodId: string; issuerId?: string; emailPagador: string }`; `type ResultadoCartao = { idExterno: string; status: StatusPagamento; statusDetalhe: string | null }`; `ConsultaPagamento` ganha `comissaoCentavos: number | null`; `ProvedorPix` ganha opcionais `criarCobrancaCartao?(p: ParamsCobrancaCartao): Promise<ResultadoCartao>` e `estornar?(p: { token: string; idExterno: string }): Promise<{ ok: true } | { ok: false; motivo: 'saldo_insuficiente' | 'outro' }>`.
- Produces em `mercadopago.ts`: `montarCorpoCobrancaCartaoMercadoPago(p: ParamsCobrancaCartao): Record<string, unknown>` (com `installments: 1`, `token`, `payment_method_id`, `application_fee`).

- [ ] **Step 1: Write the failing tests:** `montarCorpoCobrancaMercadoPago` com `taxaPlataformaCentavos: 99` inclui `application_fee: 0.99`; sem a taxa não inclui o campo; o corpo do cartão tem `installments: 1`, `transaction_amount` decimal, `application_fee: 0.99` e **não** contém nenhum campo com dado de cartão além de `token`; `statusDoMercadoPago('in_process')` continua `pendente`; leitura da comissão usa o campo registrado na Task 1.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar. `X-Idempotency-Key` do cartão = `referencia` (retry não cobra duas vezes). `consultarPagamento` preenche `comissaoCentavos` (null quando o campo não existe, para pendente antigo). `estornar` chama `POST /v1/payments/{id}/refunds` e mapeia a recusa por saldo para `saldo_insuficiente`.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5: Commit.**

### Task 6: `criar-pagamento-pix` com taxa, OAuth e cartão

**Files:**
- Modify: `supabase/functions/criar-pagamento-pix/index.ts` (cálculo do total em torno das linhas 360-420; cobrança em torno de 540-590)
- Test: `tests/criarPagamentoMarketplace.test.ts` (estilo dos testes de função existentes, ver `tests/carrinhoEdge.test.ts`)

**Interfaces:**
- Consumes: `aplicarTaxaPlataforma` (Task 2), `obterTokenVendedor` (Task 4), `criarCobrancaCartao` (Task 5).
- Produces: corpo aceito ganha `meio?: 'pix' | 'cartao'` (padrão `'pix'`), `card_token?: string`, `payment_method_id?: string`, `issuer_id?: string`, `email_pagador?: string`. Resposta ganha `taxa_plataforma_centavos`; para cartão devolve `{ pendente_id, status: 'aprovado' | 'pendente' | 'rejeitado', total_centavos, taxa_plataforma_centavos }` (sem `qr_code`).

- [ ] **Step 1: Write the failing tests:** total gravado = itens − cupom + entrega + 99; `total_esperado_centavos` sem os 99 devolve 409 com `total_centavos` já com a taxa; total zero (cupom 100%) não chama o provedor e grava taxa 0; `meio: 'cartao'` sem `card_token` devolve 422; barraca sem OAuth depois do corte devolve 409 com `codigo: 'mp_nao_conectado'`; antes do corte usa o token colado, grava taxa 0 e não manda `application_fee`; o `card_token` não aparece em nenhum `console.*` do arquivo (teste lê o código-fonte).
- [ ] **Step 2:** `npm test -- --test-name-pattern="criarPagamentoMarketplace"`. Esperado: FAIL.
- [ ] **Step 3:** Implementar. Gravar `taxa_plataforma_centavos` no pendente (insert e update do reaproveitado). Ler `CORTE_TOKEN_MP_ISO`; sem a variável o corte é "já passou". Cartão com status `rejeitado` não consome o cupom (usar o mesmo `cupom_liberar` do erro de provedor). Retry com o mesmo `client_uuid` reaproveita o pendente (mecanismo existente) e a idempotência do provedor evita cobrança dupla.
- [ ] **Step 4:** Rodar. Esperado: PASS, e `npm test` inteiro sem regressão.
- [ ] **Step 5: Commit.**

### Task 7: `webhook-mercadopago` com taxa, comissão e OAuth

**Files:**
- Modify: `supabase/functions/webhook-mercadopago/index.ts` (token em ~132, total em ~162, criação do pedido em ~244-280)
- Test: `supabase/functions/_shared/pagamento/pagamento.test.ts`

**Interfaces:**
- Consumes: `totalEsperadoDoPendente` e `decidirAprovado` novos (Task 2), `consultarPagamento.comissaoCentavos` (Task 5), `obterTokenVendedor` (Task 4).

- [ ] **Step 1: Write the failing tests** (funções puras): pendente com taxa 99 e pago valor sem a taxa conclui `conciliar_valor`; comissão ≠ 99 conclui `conciliar_valor`; pendente antigo (taxa 0) segue `criar_pedido`.
- [ ] **Step 2:** Rodar o teste de funções. Esperado: FAIL.
- [ ] **Step 3:** Implementar: buscar o token com `obterTokenVendedor` quando o pendente tem `taxa_plataforma_centavos > 0` (cobrança nova) e com `buscarTokenDoProvedor` caso contrário (pendente anterior ao corte continua confirmando até expirar); passar taxa e comissão para a decisão; depois de `criar_pedido` gravar `pedidos.taxa_plataforma_centavos` com `update` (mesmo padrão do `cliente_id`, em ~280; falha só vai para log, nunca desfaz o pedido). Renovação falhando devolve 500 (o provedor reenvia).
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Estorno do pedido pago online

**Files:**
- Create: `supabase/functions/estornar-pagamento/index.ts`
- Modify: `src/pages/Historico.tsx` (ação do dono ao cancelar pedido pago online; ler antes a ação de cancelar existente)
- Test: `tests/estornarPagamento.test.ts`

**Interfaces:**
- Produces: `POST estornar-pagamento` com JWT do dono, corpo `{ pedido_id: string }`, resposta `{ ok: true }` ou `{ erro: string, codigo: 'saldo_insuficiente' | 'nao_pago_online' | 'ja_estornado' }`; grava `pagamentos_pendentes.estornado_em` (coluna criada na Task 3).

- [ ] **Step 1: Write the failing tests:** pedido sem pagamento online devolve `nao_pago_online`; chamada repetida devolve `ja_estornado` sem chamar o provedor de novo; provedor devolvendo `saldo_insuficiente` responde com esse código e **não** grava `estornado_em`; dono de outra barraca recebe erro genérico.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar a função (localiza o pendente por `pedido_id`, token via `obterTokenVendedor`, chama `estornar`) e o botão no Histórico com a mensagem explicando saldo insuficiente e que o caso vai para o suporte.
- [ ] **Step 4:** Rodar. Esperado: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Checkout do cliente (taxa na tela e cartão)

**Files:**
- Create: `src/lib/taxaPlataforma.ts`, `src/components/CartaoMercadoPago.tsx`
- Modify: `src/pages/CardapioPublico.tsx` (resumo e `pagarPixEntrega`/fluxo do Pix em ~967-1390, botões em ~1725-1770), `package.json` (SDK do Mercado Pago; confirmar nome e API atual na documentação oficial)
- Test: `tests/taxaPlataforma.test.ts`

**Interfaces:**
- Produces: `TAXA_PLATAFORMA_CENTAVOS = 99` e `totalComTaxaPlataforma(totalSemTaxaCentavos: number): number` (0 quando o total é 0) em `src/lib/taxaPlataforma.ts`; componente `CartaoMercadoPago({ aoGerarToken, desabilitado }: { aoGerarToken: (d: { cardToken: string; paymentMethodId: string; issuerId?: string; email: string }) => void; desabilitado: boolean })`. Chave pública do Sai aê em `VITE_MP_PUBLIC_KEY`.

- [ ] **Step 1: Write the failing tests:** `totalComTaxaPlataforma(1500) === 1599`, `totalComTaxaPlataforma(0) === 0`, e o valor da constante do front é igual ao de `supabase/functions/_shared/pagamento/taxaPlataforma.ts` (teste lê os dois arquivos).
- [ ] **Step 2:** `npm test -- --test-name-pattern="taxaPlataforma"`. Esperado: FAIL.
- [ ] **Step 3:** Implementar o helper. No resumo do pedido mostrar a linha "Taxa de serviço Sai aê: R$ 0,99" quando o meio é Pix ou cartão (não em "pagar na entrega"), e enviar `total_esperado_centavos` com a taxa. Adicionar a escolha "Pix" ou "Cartão" no checkout; o cartão usa `CartaoMercadoPago` dentro da tela, sem seletor de parcelas, e envia o resultado para `criar-pagamento-pix` com `meio: 'cartao'`. Mensagens para aprovado (segue o fluxo atual de pedido confirmado), em análise, e recusado (permite tentar de novo ou trocar para Pix). Tratar o 409 com `codigo: 'mp_nao_conectado'` como "pagamento online indisponível, escolha pagar na entrega".
- [ ] **Step 4:** Rodar `npm test`, `npm run lint` e `npm run build`. Esperado: tudo passa. Conferir no navegador com a barraca de teste: Pix, cartão aprovado e cartão recusado.
- [ ] **Step 5: Commit.**

### Task 10: Ajustes (conectar Mercado Pago, aviso e corte)

**Files:**
- Modify: `src/pages/Ajustes.tsx` (`SecaoPagamentoOnline`, ~2105), `src/lib/provedoresPix.ts`, `supabase/functions/_shared/salvarCredencial.ts` (tipo `pagamento` deixa de aceitar token novo depois do corte), onboarding (`supabase/migrations/20261020100000_onboarding_config.sql` e a tela que cola token: localizar com busca por `definir_token_pagamento`)
- Test: `tests/ajustesMercadoPago.test.ts`

**Interfaces:**
- Consumes: `mp-oauth-iniciar` e `mp_oauth_status` (Tasks 3 e 4).

- [ ] **Step 1: Write the failing tests** (lógica pura extraída para `src/lib/estadoMercadoPago.ts`): `estadoMercadoPago({ conectada, tokenAntigoConfigurado, agora, corte })` devolve `'conectada'`, `'desconectada'`, `'aviso_corte'` (token antigo, antes do corte), `'bloqueada'` (token antigo, depois do corte) e `'nao_configurada'`, com os casos de cada um.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar o helper e a tela: botão "Conectar Mercado Pago" (chama `mp-oauth-iniciar` e abre a `url`), estado e botão de desconectar/reconectar, banner de `aviso_corte` com a data do corte, e texto explicando que Pix cai na hora e cartão só depois da liquidação (cerca de 30 dias, a confirmar com o Mercado Pago antes de publicar o número). `pagamento_online_habilitado` só liga com conexão ativa. O campo de token colado some depois do corte.
- [ ] **Step 4:** Rodar `npm test`, `npm run lint`, `npm run build`. Esperado: passam.
- [ ] **Step 5: Commit.**

### Task 11: Verificação ponta a ponta e entrega

**Files:**
- Modify: `CLAUDE.md` do repositório (seção de pagamento) e `docs/staging.md` (variáveis novas)

- [ ] **Step 1:** No staging com contas de teste: conectar barraca por OAuth, pagar Pix e cartão com taxa, conferir no painel do Mercado Pago que R$ 0,99 foi para a conta do Sai aê e o resto para a barraca de teste, repetir a notificação do webhook (um só pedido), forçar cartão recusado, estornar um pedido (taxa devolvida junto) e expirar o token OAuth (barraca cai para "pagar na entrega").
- [ ] **Step 2:** Documentar no `CLAUDE.md` as decisões e os segredos novos (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_OAUTH_REDIRECT_URI`, `VITE_MP_PUBLIC_KEY`, `CORTE_TOKEN_MP_ISO`) e o procedimento de corte.
- [ ] **Step 3:** Definir com o dono a data do corte e o aviso às barracas (sugestão de 14 dias, ver spec) antes de produção.
- [ ] **Step 4: Commit.**
