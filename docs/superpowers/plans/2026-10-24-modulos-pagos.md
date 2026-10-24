# Módulos pagos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ativar, suspender e cobrar recursos extras por loja (avisos, disparos, bot, fiscal) somente pelo painel do superadmin, sem nenhum interruptor de módulo para o dono.

**Architecture:** Tabela `modulos_barraca` + função `modulo_ativo` no Postgres são a única fonte da verdade. Toda função de servidor que hoje lê uma flag passa a exigir `modulo_ativo`; o app só lê a lista de módulos ativos da loja para esconder ou mostrar telas. As colunas antigas (`fiscal_habilitado`, `whatsapp_disparos_habilitado`, `ia_habilitada`) continuam como espelho mantido por trigger, para o CRM em produção não quebrar.

**Tech Stack:** Postgres/Supabase (migrations testadas no PGlite com `node --test`), Edge Functions Deno, React + Vite + TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-24-modulos-pagos-design.md`

## Global Constraints

- Módulos (valores exatos de `modulo`): `whatsapp_avisos`, `whatsapp_disparos`, `whatsapp_bot`, `fiscal`. Estados: `teste`, `ativo`, `suspenso`, `cancelado`. Origens: `cortesia`, `pago`.
- Só o superadmin (`sou_superadmin()`) muda módulo. O dono nunca liga ou desliga módulo, nem por update direto em `barracas`.
- `whatsapp_disparos` só vale com `whatsapp_avisos` vigente. `whatsapp-conexao` (QR) aceita qualquer um dos três módulos de WhatsApp. O bot não depende de avisos.
- Vigência: `ativo` + `cortesia` vale indefinidamente (sem carência); `ativo` + `pago` exige `pago_ate` e vale até `pago_ate + 7 dias`; `teste` vale enquanto `teste_ate > now()`, padrão sugerido 30 dias definido pelo admin; `suspenso` e `cancelado` nunca valem.
- Ativar `fiscal` ou `whatsapp_disparos` exige `termo_versao` registrada. Termo provisório das cortesias existentes: `legado-2026-10-24`.
- Módulo suspenso nunca bloqueia lançar pedido, cozinha ou fechar pedido: só o recurso para.
- Nenhum certificado digital ou senha no Sai aê. Token Focus gravado só pelo caminho cifrado de `salvar-credencial`.
- Preços e franquias (R$ 39,90 / 39,90 / 69,90 / 69,90; pacote R$ 139,90; ativação fiscal R$ 99) são informação de cobrança manual; nenhuma franquia é contada nesta entrega.
- Mudanças em produção só depois de staging (`qzcqwovbbylqxljcrqhk`) e com OK do João; produção é `vimjwzumjggrlvlxdejr`.
- Testes: `npm test`; tipos: `npx tsc -b`; lint: `npm run lint`.

## Review Focus

1. Dono tenta `PATCH` direto em `barracas` mudando `fiscal_habilitado`, `ia_habilitada` ou `whatsapp_disparos_habilitado`: recusado (Task 1).
2. `pago_ate` vencido há menos, exatamente e mais de 7 dias: vigente, vigente, não vigente (limite inclusivo de 7 dias) (Task 1).
3. Módulo suspenso com pedido na fila offline do aparelho: o pedido sincroniza normalmente; só a emissão de nota responde `modulo_desligado` e o app mostra aviso, sem erro (Tasks 4 e 7).
4. Avisos suspenso com disparos ainda `ativo`: disparos deixa de valer e as funções de campanha recusam (Tasks 1 e 3).
5. Superadmin ativa `fiscal` sem termo: recusado com `termo_obrigatorio`; cortesias legadas não perdem o recurso (Tasks 1 e 2).
6. App sem rede e sem cache de módulos da loja: esconde as telas de módulo (fecha por padrão) e não quebra (Task 6).

---

### Task 1: Tabelas, vigência, espelho das flags e proteção

**Files:**
- Create: `supabase/migrations/20261103100000_modulos_barraca.sql`
- Test: `tests/modulosBarracaMigration.test.ts` (mesmo bootstrap PGlite de `tests/adminPlanosPrazosMigration.test.ts`)

**Interfaces:**
- Produces: tabela `modulos_barraca(barraca_id uuid, modulo text, estado text, origem text, teste_ate timestamptz, pago_ate timestamptz, ativado_em timestamptz, termo_versao text, termo_aceito_em timestamptz, ativacao_cobrada_em timestamptz, primary key (barraca_id, modulo))`; tabela `modulos_eventos(id, barraca_id, modulo, ator uuid, de jsonb, para jsonb, criado_em)`; `public.modulo_ativo(p_barraca_id uuid, p_modulo text) returns boolean` (stable, security definer, execute para `authenticated` e `service_role`); `public.modulos_ativos(p_barraca_id uuid) returns text[]` (execute para `authenticated`; exige `usuario_tem_acesso_barraca` ou `sou_superadmin`, senão devolve `{}`); trigger `modulos_sincronizar_flags` após insert/update/delete em `modulos_barraca`; trigger `barracas_fiscal_proteger` em `barracas`.

- [ ] **Step 1: Escrever os testes que falham**, em `tests/modulosBarracaMigration.test.ts`, com estes nomes e asserts:
  - `modulo_ativo: sem linha é falso`.
  - `cortesia ativa com pago_ate nulo é verdadeira`.
  - `pago ativo: pago_ate há 6 dias e 7 dias é verdadeiro; há 8 dias é falso`.
  - `teste vigente é verdadeiro e teste vencido é falso`.
  - `suspenso e cancelado são falsos`.
  - `whatsapp_disparos é falso quando whatsapp_avisos não está vigente`.
  - `check: ativo pago sem pago_ate é rejeitado; modulo fora da lista é rejeitado`.
  - `RLS: dono lê só os módulos da própria loja e não consegue insert/update/delete`.
  - `modulos_ativos devolve só os vigentes e {} para quem não tem acesso`.
  - `espelho: ativar fiscal liga fiscal_habilitado; suspender desliga; desligar bot força ia_habilitada=false mas ativar bot nunca liga ia_habilitada`.
  - `authenticated não consegue mudar fiscal_habilitado, ia_habilitada nem whatsapp_disparos_habilitado por update direto (exceção 'fiscal_use_o_modulo' para fiscal)`.
  - `backfill: sai-ae-uma-barraca recebe avisos, disparos e bot; dhelenarestaurante recebe avisos e disparos e NÃO recebe fiscal; qa-teste-varredura recebe os quatro; todos origem cortesia, estado ativo, termo_versao 'legado-2026-10-24'`.

- [ ] **Step 2: Rodar** `node --test tests/modulosBarracaMigration.test.ts`; esperado: FAIL (arquivo da migration inexistente).

- [ ] **Step 3: Escrever a migration**, com cabeçalho de rollback como as outras. Vigência dentro de `modulo_ativo`: `teste` → `teste_ate > now()`; `ativo` + `cortesia` → verdadeiro; `ativo` + `pago` → `now() <= pago_ate + interval '7 days'`; disparos exige a mesma checagem para `whatsapp_avisos` na mesma loja. RLS ligada, policy de select para `usuario_tem_acesso_barraca`, nenhuma de escrita. O trigger de espelho recalcula `whatsapp_disparos_habilitado` e `fiscal_habilitado` a partir de `modulo_ativo`, e só leva `ia_habilitada` a `false` quando o bot não vale (nunca a `true`: a regra de dono confirmado de `20261019150000_ia_dono_confirmado.sql` continua valendo). O espelho é atualizado a cada escrita; a verdade é sempre `modulo_ativo` (o espelho pode ficar velho quando uma data vence). `barracas_fiscal_proteger` segue o desenho de `barracas_disparos_proteger` (`current_user in ('authenticated','anon')` recusa mudança de `fiscal_habilitado`). Backfill pelo `slug` dentro da própria migration, com `on conflict do nothing`.

- [ ] **Step 4: Rodar** o mesmo teste; esperado: PASS. Rodar também `npm test` inteiro; esperado: nenhum teste que antes passava falha.

- [ ] **Step 5: Commit** `git add supabase/migrations/20261103100000_modulos_barraca.sql tests/modulosBarracaMigration.test.ts && git commit -m "feat(modulos): tabela de módulos por loja, vigência e espelho das flags"`.

### Task 2: Funções do admin

**Files:**
- Create: `supabase/migrations/20261103110000_modulos_admin.sql`
- Test: `tests/modulosAdminMigration.test.ts`

**Interfaces:**
- Consumes: `modulos_barraca`, `modulos_eventos`, `modulo_ativo`, `sou_superadmin()` (Task 1).
- Produces (todas `security definer`, execute só `authenticated`, primeira linha confere `sou_superadmin()` e devolve `jsonb_build_object('estado','nao_autorizado')` senão):
  - `admin_modulos_listar(p_barraca_id uuid) returns table(modulo text, estado text, origem text, teste_ate timestamptz, pago_ate timestamptz, ativado_em timestamptz, termo_versao text, termo_aceito_em timestamptz, ativacao_cobrada_em timestamptz, vigente boolean)` (uma linha para cada um dos 4 módulos, inclusive os sem registro, com `estado` = `'inativo'`).
  - `admin_modulo_definir(p_barraca_id uuid, p_modulo text, p_estado text, p_origem text, p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text default null) returns jsonb` com `estado` de retorno: `ok`, `nao_autorizado`, `invalido`, `termo_obrigatorio`, `dependencia`.
  - `admin_modulo_ativacao_cobrada(p_barraca_id uuid) returns jsonb` (só `fiscal`; grava `ativacao_cobrada_em = now()`).
  - `admin_pacote_whatsapp(p_barraca_id uuid, p_origem text, p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text) returns jsonb` (define os três módulos de WhatsApp em `ativo` ou `teste` conforme `p_teste_ate`, numa transação).

- [ ] **Step 1: Testes que falham** (`tests/modulosAdminMigration.test.ts`): `não-superadmin recebe nao_autorizado em todas`; `definir fiscal ativo sem termo devolve termo_obrigatorio e não grava`; `definir fiscal com termo grava termo_aceito_em e ativado_em`; `definir fiscal em loja que já tem termo_versao legado não exige termo novo`; `ativar whatsapp_disparos com avisos inativo devolve dependencia`; `suspender avisos não é bloqueado por ter disparos ativo (disparos passa a não vigente)`; `pago ativo sem p_pago_ate devolve invalido`; `todo definir grava uma linha em modulos_eventos com ator, de e para`; `pacote cria as 3 linhas ou nenhuma`; `ativacao_cobrada só aceita fiscal`; `listar devolve 4 linhas`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Escrever a migration** com as assinaturas acima. `termo_obrigatorio` quando o módulo é `fiscal` ou `whatsapp_disparos`, o novo estado é `ativo` ou `teste`, `p_termo_versao` é nulo e a linha ainda não tem `termo_versao`.
- [ ] **Step 4: Rodar** e ver PASS, mais `npm test`.
- [ ] **Step 5: Commit** `feat(modulos): funções de admin para ativar, suspender e cobrar módulos`.

### Task 3: Funções de banco que hoje leem as flags

**Files:**
- Create: `supabase/migrations/20261103120000_modulos_consumidores.sql`
- Test: `tests/modulosConsumidoresMigration.test.ts` (reaproveitar o bootstrap que carrega as migrations dos disparos, avisos e integração v1 usado nos testes existentes dessas migrations)

**Interfaces:**
- Consumes: `modulo_ativo` (Task 1).
- Produces: as mesmas funções com as mesmas assinaturas e o gate trocado, recriadas a partir da **última** definição de cada uma (conferir a mais recente em `supabase/migrations/` antes de copiar):
  - `integracao_avaliacao_config(p_barraca_id)`: `ativo` = `avaliacao_ativa and modulo_ativo(…,'whatsapp_avisos')` (deixa de depender de `whatsapp_disparos_habilitado`).
  - `whatsapp_avaliacao_salvar`: exige `modulo_ativo(…,'whatsapp_avisos')`.
  - Funções de campanha/prévia/contagem de disparos (`disparos_publico_contagem` e as `disparos_*` que checam `whatsapp_disparos_habilitado`, em `20261101100000`, `…110000`, `…120000`): exigem `modulo_ativo(…,'whatsapp_disparos')`.
  - Onde a migration `20261030100000_whatsapp_avisos.sql` (linha ~104) monta `v_avisos` para os eventos: `v_avisos := null` quando `whatsapp_avisos` não vigente.
  - Função do cardápio de integração v1 (`20261031100000` e `20261031120000`): `ia_habilitada` devolvido = `ia_habilitada and modulo_ativo(…,'whatsapp_bot')`.

- [ ] **Step 1: Testes que falham**: `avaliação: config.ativo é falso sem módulo avisos mesmo com avaliacao_ativa` e `verdadeiro com avisos vigente`; `avaliacao_salvar recusa sem módulo`; `disparos_publico_contagem recusa sem módulo disparos e com avisos suspenso`; `eventos saem sem data.avisos quando avisos não vigente`; `cardápio v1 devolve ia_habilitada=false sem módulo bot`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Escrever a migration** (só trocar o gate; manter assinaturas, grants e `search_path`).
- [ ] **Step 4: Rodar** o teste novo e `npm test`; esperado: PASS (os testes antigos dessas migrations continuam passando).
- [ ] **Step 5: Commit** `feat(modulos): servidor exige módulo vigente nas funções de WhatsApp e bot`.

### Task 4: Edge functions

**Files:**
- Create: `supabase/functions/_shared/modulos.ts`
- Modify: `supabase/functions/emitir-nfce/handler.ts` (gate por volta da linha 210, onde hoje lê `fiscal_habilitado`), `supabase/functions/whatsapp-disparos/index.ts:73-76`, `supabase/functions/whatsapp-conexao/index.ts` (depois da checagem de papel)
- Test: `tests/modulosHelper.test.ts`; casos novos nos testes existentes de `emitir-nfce`

**Interfaces:**
- Produces: `export const MODULOS = ['whatsapp_avisos','whatsapp_disparos','whatsapp_bot','fiscal'] as const`; `export type Modulo = typeof MODULOS[number]`; `export async function moduloAtivo(db: { rpc: (fn: string, args: object) => PromiseLike<{ data: unknown; error: unknown }> }, barracaId: string, modulo: Modulo): Promise<boolean>`: chama `modulo_ativo` e **devolve `false` em qualquer erro** (fecha por padrão).

- [ ] **Step 1: Testes que falham**: `moduloAtivo devolve true só quando a RPC devolve true`; `devolve false quando a RPC dá erro ou devolve null`; `emitir-nfce: módulo fiscal desligado responde 403 {erro:'modulo_desligado'} e não chama a FocusNFe`; `whatsapp-disparos: sem módulo responde 403 modulo_desligado`; `whatsapp-conexao: aceita com só whatsapp_bot, recusa sem nenhum dos três`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Implementar** `_shared/modulos.ts` e trocar os três gates. No `emitir-nfce`, o gate vem antes da trava e da FocusNFe e substitui o uso de `fiscal_habilitado` como permissão (a coluna segue só como espelho).
- [ ] **Step 4: Rodar** `npm test`; esperado: PASS.
- [ ] **Step 5: Commit** `feat(modulos): edge functions exigem módulo vigente`.

### Task 5: Token da Focus gravado pelo superadmin

**Files:**
- Modify: `supabase/functions/_shared/salvarCredencial.ts:73-83` (checagem de acesso)
- Test: `tests/salvarCredencial.test.ts`

**Interfaces:**
- Consumes: tabela `superadmins` (lida com a service role que a função já usa).
- Produces: `tratarSalvarCredencial` passa a aceitar, para `tipo === 'fiscal'`, quem está em `superadmins` mesmo sem linha em `usuarios_barracas`. Os demais tipos e o acesso de suporte continuam como estão.

- [ ] **Step 1: Testes que falham**: `superadmin sem vínculo grava token fiscal de homologação e de produção cifrados`; `superadmin sem vínculo recebe 403 para tipo pagamento`; `usuário comum sem vínculo continua 403`; `acesso de suporte continua sem gravar`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Implementar** a exceção estreita descrita acima, sem relaxar nenhuma outra checagem.
- [ ] **Step 4: Rodar** `npm test`; esperado: PASS.
- [ ] **Step 5: Commit** `feat(modulos): superadmin grava o token fiscal da loja`.

### Task 6: App, hook de módulos e telas de WhatsApp

**Files:**
- Create: `src/lib/modulos.ts`, `src/hooks/useModulosAtivos.ts`
- Modify: `src/lib/visibilidadeIaCrm.ts` (remove `SLUGS_COM_IA_E_CRM`), `src/pages/Ajustes.tsx:2986-2989`, `src/pages/ConfirmarPedido.tsx:346,466`, `src/components/SecaoDisparos.tsx`, `src/types/database.ts`, componentes que usam `deveMostrarFaixaCaiu`
- Test: `tests/modulos.test.ts`, `tests/visibilidadeIaCrm.test.ts` (reescrever)

**Interfaces:**
- Produces: `src/lib/modulos.ts`: `export type Modulo = 'whatsapp_avisos' | 'whatsapp_disparos' | 'whatsapp_bot' | 'fiscal'`; `export function temModulo(modulos: readonly string[] | null, m: Modulo): boolean` (`null` = ainda sem resposta = falso); `export function mostrarWhatsappAutomacao(modulos: readonly string[] | null): boolean` (verdadeiro se qualquer um dos três de WhatsApp); `export function deveMostrarFaixaCaiu(barraca: { whatsapp_status?: string | null }, modulos: readonly string[] | null): boolean`. `useModulosAtivos(barracaId: string | undefined): { modulos: string[] | null; carregando: boolean }` chama a RPC `modulos_ativos` e guarda o último resultado por loja em `localStorage` (leitura e escrita dentro de try/catch); sem rede e sem cache devolve `null`.

- [ ] **Step 1: Testes que falham** (`tests/modulos.test.ts`): `temModulo(null, …) é falso`; `mostrarWhatsappAutomacao é verdadeiro com só o bot e falso com só fiscal`; `faixa de queda só com whatsapp_status 'caiu' e algum módulo de WhatsApp`; `a caixa de promoções só aparece com whatsapp_disparos` (função pura exportada para o `ConfirmarPedido`).
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Implementar** os arquivos novos e trocar todos os usos de `mostrarWhatsappAutomacao(barraca, flag)`, `deveMostrarFaixaCaiu(barraca, flag)` e de `whatsapp_disparos_habilitado` no app. Em `SecaoDisparos.tsx`, a parte de avaliação aparece com `whatsapp_avisos` e a de campanhas com `whatsapp_disparos`. Remover a variável `VITE_MOSTRAR_WHATSAPP_AUTOMACAO`. Avisos, texto e liga/desliga de cada aviso e da avaliação continuam do dono, dentro do módulo.
- [ ] **Step 4: Rodar** `npm test`, `npx tsc -b`, `npm run lint`; esperado: tudo passa.
- [ ] **Step 5: Commit** `feat(modulos): app lê os módulos ativos da loja em vez de flags e slugs`.

### Task 7: Fiscal gerenciado no app

**Files:**
- Modify: `src/pages/Ajustes.tsx` (`SecaoFiscal`, ~linha 1836 em diante), demais usos de `fiscal_habilitado` em `src/` (listar com `grep -rn fiscal_habilitado src`)
- Test: `tests/fiscalGerenciado.test.ts`

**Interfaces:**
- Consumes: `temModulo`, `useModulosAtivos` (Task 6).
- Produces: a seção Fiscal só renderiza com `temModulo(modulos,'fiscal')`; não mostra o interruptor "habilitado" nem os campos de token; mostra o estado do módulo, o ambiente (homologação/produção), regime, CNPJ, emitente, tributos e a chave "incluir taxas na nota" que já existem. Botões "Emitir nota fiscal" e "Imprimir cupom fiscal" usam o módulo, não `fiscal_habilitado`. Função pura `fiscalProntoParaEmitir(modulos: readonly string[] | null, tokenProducaoOuHomologacaoConfigurado: boolean): 'ok' | 'sem_modulo' | 'sem_token'`.

- [ ] **Step 1: Testes que falham**: `fiscalProntoParaEmitir: sem módulo → sem_modulo; com módulo e sem token → sem_token; com ambos → ok; modulos null → sem_modulo`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Implementar** a função e remover da `SecaoFiscal` o toggle `fiscal_habilitado` e a folha de token; manter `token_fiscal_configurado` para mostrar "pronto para emitir" ou "aguardando cadastro" ao dono. Quando `emitir-nfce` responde `modulo_desligado`, mostrar a mensagem "Nota fiscal indisponível no momento. O pedido está salvo." sem erro técnico.
- [ ] **Step 4: Rodar** `npm test`, `npx tsc -b`, `npm run lint`; esperado: PASS.
- [ ] **Step 5: Commit** `feat(modulos): seção Fiscal sem token nem interruptor, dependente do módulo`.

### Task 8: Painel de módulos no admin

**Files:**
- Create: `src/lib/adminModulos.ts`, `src/components/AdminModulos.tsx`
- Modify: `src/pages/AdminBarracaLeitura.tsx` (monta o componente para o superadmin)
- Test: `tests/adminModulos.test.ts`

**Interfaces:**
- Consumes: `admin_modulos_listar`, `admin_modulo_definir`, `admin_modulo_ativacao_cobrada`, `admin_pacote_whatsapp` (Task 2); `salvar-credencial` (Task 5).
- Produces: `src/lib/adminModulos.ts`: `export const ROTULO_MODULO: Record<Modulo, string>`; `export const PRECO_MODULO_CENTAVOS: Record<Modulo, number>` (3990, 3990, 6990, 6990); `export const PRECO_PACOTE_WHATSAPP_CENTAVOS = 13990`; `export const TAXA_ATIVACAO_FISCAL_CENTAVOS = 9900`; `export function mensagemDoEstado(estado: string): string` (traduz `termo_obrigatorio`, `dependencia`, `invalido`, `nao_autorizado` para português); `export function teste30Dias(agora: Date): string` (ISO de agora + 30 dias). `AdminModulos` mostra os 4 módulos com estado, vigência, termo, botões de ativar/suspender/cancelar, cortesia, teste de 30 dias, registrar pagamento (`pago_ate`), "Ativar pacote WhatsApp", "Registrar taxa de R$ 99" (fiscal), e dois campos para colar os tokens de homologação e produção da Focus enviados a `salvar-credencial` (`tipo: 'fiscal'`). Nenhum campo recebe certificado ou senha de certificado.

- [ ] **Step 1: Testes que falham**: `mensagemDoEstado traduz os quatro estados`; `precos conferem com o design (39,90 / 39,90 / 69,90 / 69,90, pacote 139,90, ativação 99)`; `teste30Dias soma 30 dias exatos`.
- [ ] **Step 2: Rodar** e ver FAIL.
- [ ] **Step 3: Implementar** helper e componente, seguindo o visual de `AdminBarracaLeitura`. Toda chamada mostra o resultado de `estado` na tela.
- [ ] **Step 4: Rodar** `npm test`, `npx tsc -b`, `npm run lint`; esperado: PASS.
- [ ] **Step 5: Commit** `feat(modulos): painel de módulos no admin`.

### Task 9: Documentação, staging e entrega

**Files:**
- Modify: `CLAUDE.md` (substituir o parágrafo de "IA e CRM escondidos" e "WhatsApp e Automação" para descrever módulos), `docs/superpowers/specs/2026-10-24-modulos-pagos-design.md` (status: implementado)
- Create: `docs/roteiro-modulos.md` (roteiro manual de teste)

- [ ] **Step 1:** Escrever o roteiro: ativar cada módulo pelo admin e ver a tela aparecer na loja; suspender e ver sumir; avisos suspenso derruba disparos; fiscal sem termo recusa; gravar token Focus pelo admin e ver "pronto para emitir" no dono; update direto de `fiscal_habilitado` pelo dono recusado.
- [ ] **Step 2:** Atualizar o `CLAUDE.md`.
- [ ] **Step 3:** Aplicar no **staging** nesta ordem: migrations `20261103100000`, `…110000`, `…120000` → deploy das functions `emitir-nfce`, `whatsapp-disparos`, `whatsapp-conexao`, `salvar-credencial` → app. Executar o roteiro. Esperado: todos os passos passam.
- [ ] **Step 4:** Pedir ao João o OK para produção. Em produção, **antes do app**, conferir por SQL que `sai-ae-uma-barraca` e `dhelenarestaurante` receberam os módulos do backfill e que `select modulo_ativo(id,'whatsapp_avisos') from barracas where slug in (...)` é `true`.
- [ ] **Step 5: Commit** `docs(modulos): roteiro, CLAUDE.md e status do design`.
