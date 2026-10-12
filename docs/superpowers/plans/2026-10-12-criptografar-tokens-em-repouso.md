# Plano: criptografar em repouso os tokens das lojas (FocusNFe e Pix)

Status: **PROPOSTA — nada implementado. Aguarda aprovação do dono.** Origem: auditoria, seção "O que não revisei".

## 0. Problema

`barracas_fiscal_token` (`token_homologacao`, `token_producao`) e `barracas_pagamento_token` (`access_token`, `segredo_webhook`)
guardam credenciais de terceiros **em texto puro**. A proteção hoje é RLS ligada sem policy: só a service role e as RPCs
`SECURITY DEFINER` chegam lá. Isso protege contra outros usuários do app, **não** contra: vazamento de dump/backup,
acesso indevido ao painel/SQL do Supabase, service role key vazada, SQL injection numa função `SECURITY DEFINER`, ou
log/replica que copie a tabela. Qualquer um desses expõe, de uma vez, o token de emissão fiscal e o de recebimento Pix de
**todas** as lojas.

Observação: `segredo_webhook` (20261014120000) tem a mesma exposição e entra no escopo (é menos grave: só permite forjar
confirmação de pagamento, mas isso já é fraude).

## 1. Onde os tokens são lidos e gravados hoje (inventário)

| Peça | Tabela/coluna | Operação |
|---|---|---|
| RPC `definir_token_fiscal(barraca, ambiente, token)` | `barracas_fiscal_token.token_{homologacao,producao}` | grava (cliente → RPC, **token em claro trafega do navegador ao banco**) |
| RPC `token_fiscal_configurado(barraca)` | idem | só `is not null` |
| RPC `definir_token_pagamento(barraca, token, provedor)` | `barracas_pagamento_token.access_token` | grava |
| RPC `token_pagamento_configurado(barraca, provedor)` | idem | só `exists` |
| RPC `definir_segredo_webhook_pagamento` / `segredo_webhook_configurado` | `segredo_webhook` | grava / `is not null` |
| `emitir-nfce/handler.ts` (~l.210) | `token_*` | **lê** (service role) e manda à FocusNFe |
| `_shared/pagamento/token.ts` (`buscarTokenDoProvedor`, `buscarSegredoWebhook`) | `access_token`, `segredo_webhook` | **lê** com `select('*')` |
| `criar-pagamento-pix/index.ts` (l.158, l.226) | via `token.ts` | usa para criar cobrança e para reconsultar a pendente |
| `webhook-mercadopago/index.ts` (l.114, l.125) | via `token.ts` | segredo (validação da assinatura) + token (consultar o pagamento) |
| "consultar status" do Pix | dentro de `criar-pagamento-pix` / `webhook-mercadopago` | mesma leitura de `token.ts` |
| `excluir_dados_conta` (20260928170000, 20261018140000) | ambas | `delete` — sem impacto |
| `onboarding_config` (20261020100000, l.387) | `barracas_pagamento_token` | `exists` — **precisa de ajuste** se a coluna `access_token` deixar de ser a fonte |
| Acesso do suporte (20261023100000) | — | não lê tokens (só cardápio); manter assim |
| Front (`Ajustes.tsx` l.1771, 1866, 2171, 2249) | RPCs acima | grava/consulta "configurado" — nunca lê o token |

Pontos favoráveis: o front **nunca** recebe o token de volta; só 3 pontos de leitura em Edge Function (`emitir-nfce`,
`token.ts`) — dá para centralizar a decifragem num módulo só.

## 2. Opções (com o que o Supabase oferece hoje)

Verificado na documentação do Supabase (consulta de hoje):
- **pgsodium: "pending deprecation"; o Supabase NÃO recomenda nenhum uso novo**, nem Transparent Column Encryption nem
  Server Key Management (complexidade operacional e risco de má configuração). → **descartado.**
- **Vault** continua suportado e a interface (`vault.create_secret`, `vault.decrypted_secrets`) permanece, mesmo com a
  implementação interna saindo do pgsodium. A tabela de status da documentação o lista como **public alpha**.
- Projetos Supabase já são cifrados em disco por padrão ("at rest"). Isso **não** cobre dump lógico, SQL, service role.

### A) Cifra na aplicação (AES-256-GCM na Edge Function, chave em *secret* da função) — **RECOMENDADA**
Coluna nova `*_cifrado` (formato `v1.<iv>.<ciphertext+tag>` em base64url, `kid` na versão). Chave `TOKENS_CHAVE_V1`
(32 bytes) no *secret* das Edge Functions, **fora do banco**.
- Prós: quem leva o banco (dump, backup, SQL, replica) leva só texto cifrado; a chave nunca está no banco; sem extensão
  em alpha/deprecação; WebCrypto nativo do Deno; testável com o padrão `_shared` + injeção que já usamos (Node
  `crypto.webcrypto` executa o mesmo código); rotação por versão de chave (`v1`, `v2`).
- Contras: precisa de **Edge Function de escrita** (hoje o navegador chama RPC com o token em claro — a RPC não pode
  cifrar sem a chave); quem tiver **a service role + os secrets das funções** ainda decifra (é o limite de qualquer
  esquema em que o servidor precisa usar o token); perder a chave = lojas precisam recadastrar tokens (guardar a chave
  fora do Supabase, p. ex. gerenciador de senhas do dono).

### B) Supabase Vault
Guardar o token em `vault.secrets`, e a tabela só mantém o `secret_id`.
- Prós: sem código de cifra, tudo em SQL; a chave-raiz não fica na tabela.
- Contras: **public alpha**; a descriptografia acontece dentro do Postgres (`vault.decrypted_secrets`) — quem tem SQL
  como `postgres`/service role lê em claro, então protege dump/backup mas **não** SQL/service role comprometidos;
  rotação de chave-raiz é manual e documentada como delicada ("depois da rotação os segredos antigos não decifram" — é
  preciso recriar todos); acoplamento ao Supabase (dificulta migrar); a migração futura do pgsodium para outra
  implementação interna é risco que não controlamos.

### C) pgcrypto (`pgp_sym_encrypt`) com chave passada pela função
A chave trafega por SQL → aparece em `pg_stat_statements`/logs de consulta, e cai no mesmo balaio da B. Pior que A.

**Recomendação: A.** Resolve o cenário que motivou o item (vazamento do banco/backup) com a chave genuinamente separada,
sem depender de recurso alpha. O custo é uma Edge Function de escrita, que também elimina a segunda fraqueza: hoje o token
passa em claro pelo PostgREST/RPC e pode aparecer em logs de consulta.

## 3. Desenho (opção A)

**Módulo único** `supabase/functions/_shared/segredoCifrado.ts` (sem imports Deno; recebe `crypto` por injeção):
`cifrar(texto, {chaves, kidAtual})`, `decifrar(valor, {chaves})`, formato versionado, AAD = `barraca_id|campo`
(impede copiar o cifrado de uma loja para outra). Falha de decifragem = erro explícito (nunca devolver vazio).

**Leitura** (`emitir-nfce`, `token.ts`): `lerSegredo(linha, campo)` → se `*_cifrado` existe, decifra; senão (durante a
transição) usa o texto. Um ponto só, com teste.

**Escrita**: nova Edge Function `salvar-credencial` (autentica o JWT, confere `usuario_tem_acesso_barraca`, valida
ambiente/provedor, cifra e grava via service role; grava `*_cifrado` e **zera o texto**). O front passa a chamar a função
em vez das RPCs `definir_*`. Limite de tentativas igual ao das outras funções (`consulta_externa_registrar`).

**Banco** (migrations ≥ `20261027100000`, aditivas):
1. `barracas_fiscal_token` + `token_homologacao_cifrado`, `token_producao_cifrado`; `barracas_pagamento_token` +
   `access_token_cifrado`, `segredo_webhook_cifrado`. Todas `text null`.
2. `*_configurado` passam a considerar `texto is not null OR cifrado is not null`; `onboarding_config` (`pix_online`)
   idem (hoje só olha a existência da linha — conferir que continua correto).
3. `definir_*` antigas **continuam** na fase 1 (rollback) e são revogadas na fase 3.
4. Fase final: `update ... set <texto> = null`, depois `drop column` do texto (migration separada, só após a janela
   de observação).

## 4. Migração sem derrubar NFC-e nem Pix

**Fase 0 — Preparação (dono):** gerar a chave (`openssl rand -base64 32`), guardar em local seguro **fora** do Supabase e
cadastrar o *secret* `TOKENS_CHAVE_V1` nas Edge Functions. Sem isso nada avança.

**Fase 1 — Deploy compatível (zero mudança de comportamento):** migration de colunas; funções passam a ler "cifrado, senão
texto"; `salvar-credencial` publicada; front ainda grava pelas RPCs antigas. Nada muda para o lojista.

**Fase 2 — Dupla escrita + backfill:** front passa a usar `salvar-credencial` (grava só cifrado e zera texto). Script de
backfill **rodado pelo dono** (função `backfill-tokens`, protegida por segredo, idempotente, em lote, que cifra e **não
apaga** o texto ainda): conferir por amostragem e contagem (`texto não nulo = cifrado não nulo`) e, **antes de apagar
qualquer texto**, decifrar todos e comparar com o original (hash).

**Fase 3 — Corte:** observar uma janela (sugestão 7–14 dias) com logs de "caiu no fallback de texto" = 0. Então: migration
que zera o texto → depois a que remove as colunas, e revoga `definir_*` antigas. Remove-se o fallback do código.

Invariante em todas as fases: um token é lido de **uma** das duas formas, nunca fica sem nenhuma; backfill não destrói.

## 5. Rollback

- Fases 1–2: reverter o front/funções para o deploy anterior; o texto continua no banco (não foi apagado) → emissão e Pix
  seguem. O cifrado é só coluna extra ignorada.
- Fase 3 (texto já apagado): rollback = restaurar a partir do cifrado (`script de decifrar` com a chave) **ou** pedir
  ao lojista que recadastre o token. Por isso a fase 3 só ocorre depois da janela, com **backup lógico da tabela guardado
  cifrado fora do projeto** (ou ponto de restauração/PITR) imediatamente antes.
- Chave perdida/comprometida: rotacionar (`v2`), recifrar tudo com o backfill (aceita `v1` e `v2` na leitura); se
  comprometida, **revogar os tokens nos provedores** (FocusNFe/Mercado Pago) é o que de fato encerra o risco.

## 6. Riscos

1. **Perder a chave = perder todos os tokens** (mitigação: guarda fora do Supabase + backup do cifrado; recadastro é o
   plano de último recurso).
2. **Falha de decifragem em produção derruba NFC-e/Pix** — mitigar com leitura de fallback na fase 1–2, teste que decifra
   o formato real, alarme em log (`segredo_decifragem_falhou`) e não engolir erro.
3. **Fuso da ordem de deploy**: front novo antes da função nova (ou vice-versa). Mitigar publicando função antes e
   mantendo as RPCs antigas até a fase 3.
4. **Não protege** contra service role + secrets das funções comprometidos (limite do desenho; ver §2A).
5. Tokens antigos podem já ter vazado em logs/backups anteriores → ao final, **orientar rotação dos tokens nos provedores**
   é a ação com mais efeito de segurança, independente da criptografia.
6. `select('*')` em `token.ts` passa a trazer a coluna cifrada e a de texto: trocar por colunas explícitas.
7. Testes de ponta a ponta contra FocusNFe/Mercado Pago reais **não existem** — só simulados.

## 7. Decisões e ações do dono

Decidir: (1) opção A (recomendada) ou B (Vault); (2) janela de observação antes de apagar o texto (7 ou 14 dias);
(3) se, ao final, pedimos aos lojistas para **gerar token novo** nos provedores (recomendado).

Rodar/fazer (só depois de aprovado): gerar e guardar a chave (Fase 0); cadastrar `TOKENS_CHAVE_V1`; `supabase functions
deploy salvar-credencial` (e das funções alteradas); aplicar as migrations na ordem; executar o backfill e conferir; fazer
o backup antes da Fase 3; aprovar o corte.

## 8. Testes previstos (na implementação)

Cifra/decifra (ida e volta, AAD errado falha, adulterado falha, versão desconhecida falha); leitura com fallback texto →
cifrado; `emitir-nfce` e `token.ts` com o banco simulado nas 3 situações (só texto, só cifrado, ambos); `salvar-credencial`
(sem JWT, sem acesso à loja, ambiente inválido, grava cifrado e zera texto, nunca devolve o token); guarda estática: nenhum
`console.*` imprime token/chave; migration de backfill idempotente.
