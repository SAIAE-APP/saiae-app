# Admin: ações do superadmin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O superadmin bloqueia/desbloqueia contas, troca plano, estende vencimento, marca/filtra contas Pro legadas e arquiva/restaura/apaga barracas pelo `/admin`, com log de tudo, e a tela fica mais rápida de usar.

**Architecture:** Migrations SQL novas (colunas em `assinaturas` e `barracas`, tabela de log, RPCs `security definer` que conferem `superadmins`), testadas em PGlite como as migrations admin atuais. O front ganha tipos/hook/ações em `src/lib/adminBarracas.ts`, `src/hooks/useAdminBarracas.ts` e `src/pages/AdminBarracas.tsx`. O apagamento definitivo roda por job diário + edge function (Storage exige service role).

**Tech Stack:** Postgres/Supabase (RPC, pg_cron), Deno edge functions, React + TypeScript + Tailwind, testes `node --test` com `@electric-sql/pglite` (`npm test`, pasta `tests/`).

**Spec:** `docs/superpowers/specs/2026-11-05-admin-acoes-design.md`

## Global Constraints

- Tudo em PRODUÇÃO (`vimjwzumjggrlvlxdejr`), sem staging (ordem do João, 2026-11-05).
- `assinatura_tem_acesso(assinaturas, timestamptz)` mantém nome e parâmetros; só o corpo muda.
- Migrations novas numeradas depois de `20261107110000` (última em origin/main).
- Toda RPC admin: `security definer`, `set search_path = public, pg_temp`, confere `superadmins` com `auth.uid()` e levanta `acesso negado` (errcode `42501`), `revoke all ... from public, anon`, `grant execute ... to authenticated`.
- Bloqueio fica em coluna própria (`bloqueada_admin`); webhook Stripe, cron de expiração e `trial-avisos` nunca a escrevem.
- Arquivar barraca: 30 dias para desfazer; confirmação digitando o nome; toda ação grava em `admin_acoes_log` na mesma transação.
- Comentários e textos de UI em português; sem estilo caveman em código/commits.
- Baseline: 1415 testes, `tsc` e lint limpos. Não regredir.

## Review Focus

1. Conta sem linha em `assinaturas` ao bloquear/trocar plano: erro claro, nunca criar linha silenciosa.
2. Bloquear uma conta que já está bloqueada, ou desbloquear uma que não está: idempotente, sem erro e sem log duplicado enganoso.
3. Funcionário de uma barraca cujo dono está bloqueado: perde acesso também.
4. Barraca arquivada: dono com outra barraca continua acessando a outra; cardápio público da arquivada responde "não encontrada".
5. Restaurar depois de 30 dias, ou apagar antes de 30 dias: recusado.

---

### Task 1: Log de ações e bloqueio de conta

**Files:**
- Create: `supabase/migrations/20261108100000_admin_bloqueio_conta.sql`
- Test: `tests/adminBloqueioContaMigration.test.ts` (molde: `tests/adminPlanosPrazosMigration.test.ts`)

**Interfaces:**
- Produces (SQL): colunas `assinaturas.bloqueada_admin boolean not null default false`, `bloqueio_motivo text`, `bloqueada_em timestamptz`; tabela `public.admin_acoes_log(id uuid pk, admin_id uuid, acao text, alvo_tipo text, alvo_id uuid, detalhes jsonb, criado_em timestamptz)` com RLS ligada e sem policy; `admin_bloquear_conta(p_usuario_id uuid, p_motivo text default null) returns void`; `admin_desbloquear_conta(p_usuario_id uuid) returns void`; `admin_listar_acoes(p_limite integer default 50, p_offset integer default 0) returns table(id uuid, admin_email text, acao text, alvo_tipo text, alvo_id uuid, detalhes jsonb, criado_em timestamptz)`; função interna `admin_registrar_acao(p_acao text, p_alvo_tipo text, p_alvo_id uuid, p_detalhes jsonb) returns void` (sem grant a authenticated).
- Alteração: `assinatura_tem_acesso` devolve `false` se `bloqueada_admin`. `assinatura_da_barraca` ganha o campo `bloqueada boolean` no retorno (nova assinatura de retorno: `drop function` + `create`, mantendo grants).

- [ ] **Step 1: Escrever os testes que falham** — em `tests/adminBloqueioContaMigration.test.ts`, aplicando as migrations reais como o molde: `bloquear corta tem_acesso de conta ativa`, `desbloquear devolve o acesso sem mexer em plano nem prazo`, `bloquear exige superadmin (comum recebe 42501)`, `bloquear conta sem assinatura levanta erro`, `bloquear duas vezes não duplica o log`, `funcionário perde acesso quando o dono é bloqueado` (via `barraca_assinatura_ativa`), `admin_listar_acoes só para superadmin`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminBloqueioContaMigration.test.ts`; esperado: FAIL (colunas/funções inexistentes).
- [ ] **Step 3: Escrever a migration** — colunas, tabela de log (`revoke all` de `public, anon, authenticated`), as quatro funções acima, e `create or replace` de `assinatura_tem_acesso` com a checagem de `bloqueada_admin` antes do `case`. Bloco de rollback comentado no fim do arquivo (restaura o corpo anterior da função e dropa colunas/tabela).
- [ ] **Step 4: Rodar e ver passar** — mesmo comando; esperado: PASS.
- [ ] **Step 5: Rodar a suíte inteira** — `npm test`; esperado: 1415+ passando.
- [ ] **Step 6: Commit** — `git add supabase/migrations/20261108100000_admin_bloqueio_conta.sql tests/adminBloqueioContaMigration.test.ts && git commit -m "feat(admin): bloquear e desbloquear conta com log de ações"`.

### Task 2: Trocar plano, estender vencimento e marcar legado

**Files:**
- Create: `supabase/migrations/20261108110000_admin_plano_legado.sql`
- Test: `tests/adminPlanoLegadoMigration.test.ts`

**Interfaces:**
- Consumes: `admin_registrar_acao`, `admin_acoes_log` (Task 1).
- Produces (SQL): `assinaturas.origem_plano text` com check em `('legado','trial','pago')`; `admin_definir_plano(p_usuario_id uuid, p_plano text) returns void` (aceita `essencial`/`pro`, senão `22023`); `admin_estender_vencimento(p_usuario_id uuid, p_dias integer) returns void` (1 a 365; soma em `trial_ends_at` se `trialing`, senão em `current_period_end`).
- Regra do legado (decidir olhando as contas reais, passo 3): `plan='pro'` criada antes de `2026-10-22` (deploy de `20261022130000`) e sem `stripe_subscription_id` pago vira `legado`; trial atual = `trial`; com Stripe = `pago`.

- [ ] **Step 1: Escrever os testes que falham** — `definir_plano troca e registra no log`, `definir_plano recusa plano inválido (22023)`, `estender soma dias ao trial`, `estender soma dias ao período em conta ativa`, `estender recusa 0 e 366 dias`, `ambas exigem superadmin`, `origem_plano preenchida: pro antigo sem stripe = legado`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminPlanoLegadoMigration.test.ts`; esperado: FAIL.
- [ ] **Step 3: Conferir a regra do legado contra produção (somente leitura)** — via `mcp__claude_ai_Supabase__execute_sql` em `vimjwzumjggrlvlxdejr`: `select plan, status, stripe_subscription_id is not null as stripe, created_at::date, count(*) from assinaturas group by 1,2,3,4 order by 4`. Ajustar a regra do backfill ao que aparecer e anotar no cabeçalho da migration a contagem esperada por origem.
- [ ] **Step 4: Escrever a migration** — coluna + backfill + as duas RPCs; `criar_assinatura_trial` e o webhook Stripe passam a gravar `origem_plano` (`trial` e `pago`) quando criam/atualizam linha. Rollback comentado no fim.
- [ ] **Step 5: Rodar e ver passar** — mesmo comando; esperado: PASS.
- [ ] **Step 6: Commit** — `feat(admin): trocar plano, estender vencimento e marcar contas legadas`.

### Task 3: Arquivar, restaurar e apagar barraca

**Files:**
- Create: `supabase/migrations/20261108120000_admin_arquivar_barraca.sql`
- Test: `tests/adminArquivarBarracaMigration.test.ts`

**Interfaces:**
- Consumes: `admin_registrar_acao` (Task 1).
- Produces (SQL): `barracas.arquivada_em timestamptz`; `admin_arquivar_barraca(p_barraca_id uuid, p_nome_confirmado text) returns void` (recusa se o nome não bate exatamente com `barracas.nome`); `admin_restaurar_barraca(p_barraca_id uuid) returns void` (recusa se `arquivada_em < now() - interval '30 days'`); `barracas_para_apagar() returns table(barraca_id uuid)` (arquivadas há 30+ dias; só `service_role`); `apagar_dados_barraca(p_barraca_id uuid) returns void` (só `service_role`; recusa se não arquivada há 30+ dias; mesma lista de tabelas de `excluir_dados_conta` em `20260928170000_excluir_dados_conta.sql`, mais tabelas criadas depois, conferidas contra o schema de produção).
- Alteração de acesso: `usuario_tem_acesso_barraca(uuid)` devolve `false` para barraca arquivada; `cardapio_publico(text)` não encontra barraca arquivada. A definição atual de `usuario_tem_acesso_barraca` não está em `supabase/migrations`: ler com `select pg_get_functiondef('public.usuario_tem_acesso_barraca(uuid)'::regprocedure)` em produção (somente leitura) e recriar com a checagem acrescentada, no mesmo `create or replace`.

- [ ] **Step 1: Escrever os testes que falham** — `arquivar exige o nome exato`, `arquivada perde acesso para dono e funcionário`, `dono mantém acesso à outra barraca`, `cardapio_publico não encontra arquivada`, `restaurar dentro de 30 dias devolve o acesso`, `restaurar após 30 dias é recusado`, `apagar_dados_barraca antes de 30 dias é recusado`, `apagar_dados_barraca depois de 30 dias remove barraca e filhos`, `funções de apagar só para service_role`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminArquivarBarracaMigration.test.ts`; esperado: FAIL.
- [ ] **Step 3: Escrever a migration** — coluna, as quatro funções, alterações de acesso/cardápio; agendar `cron.schedule('apagar-barracas-arquivadas', '0 4 * * *', ...)` que chama a edge function (padrão de `20261016110000_eventos_saida.sql`, protegido por `do $$ if exists pg_cron`). Rollback comentado no fim.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(admin): arquivar, restaurar e apagar barraca após 30 dias`.

### Task 4: Edge function de apagamento definitivo

**Files:**
- Create: `supabase/functions/apagar-barracas-arquivadas/index.ts`
- Test: `tests/apagarBarracasArquivadas.test.ts` (molde: `tests/alertasAdmin.test.ts` para função pura extraída)

**Interfaces:**
- Consumes: `barracas_para_apagar()`, `apagar_dados_barraca(uuid)` (Task 3); padrão de autenticação e limpeza de Storage de `supabase/functions/excluir-conta/index.ts`.
- Produces: `export function pastasParaLimpar(barracaId: string): string[]` (retorna as pastas `{id}/` dos buckets `cardapio-fotos` e `logo-barraca`), em arquivo importável pelo teste.

- [ ] **Step 1: Escrever o teste que falha** — `pastasParaLimpar devolve as duas pastas da barraca`; `handler recusa chamada sem o segredo do cron`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/apagarBarracasArquivadas.test.ts`; esperado: FAIL.
- [ ] **Step 3: Implementar a função** — autentica pelo segredo do cron como `alertas-admin`; para cada barraca de `barracas_para_apagar()`: limpa Storage, depois chama `apagar_dados_barraca`; falha em uma barraca não interrompe as outras e é logada.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando; esperado: PASS.
- [ ] **Step 5: Commit** — `feat(admin): edge function que apaga barracas arquivadas há 30 dias`.

### Task 5: Lista do admin com busca, ordenação, filtros novos e contagens

**Files:**
- Create: `supabase/migrations/20261108130000_admin_listar_v2.sql`
- Modify: `src/lib/adminBarracas.ts` (tipos `AdminBarraca`, `FiltroAdminBarracas`, `FILTROS_ADMIN`)
- Modify: `src/hooks/useAdminBarracas.ts` (`useAdminBarracas`)
- Test: `tests/adminListarV2Migration.test.ts`, `tests/adminBarracasLib.test.ts`

**Interfaces:**
- Consumes: colunas das Tasks 1 a 3.
- Produces (SQL): `admin_listar_barracas(p_filtro text, p_plano text, p_limite integer, p_offset integer, p_busca text default null, p_ordem text default 'vencimento')` — novos filtros `'bloqueada'`, `'legado'`, `'arquivada'` (arquivadas só aparecem com esse filtro); `p_ordem` em `('vencimento','nome','atividade','nova')` senão `22023`; retorno ganha `usuario_id uuid, bloqueada boolean, bloqueio_motivo text, origem_plano text, arquivada_em timestamptz, pedidos_7d bigint, pedidos_semana_anterior bigint, erros_24h bigint, versao_app text, plataforma text`. `admin_contar_filtros() returns table(filtro text, total bigint)` para as contagens.
- Produces (TS): `FiltroAdminBarracas` ampliado; `export type OrdemAdmin = 'vencimento' | 'nome' | 'atividade' | 'nova'`; `useAdminBarracas(filtro, plano, pagina, busca: string, ordem: OrdemAdmin)`; `useAdminContagens(ativo: boolean)` retornando `Record<string, number>`.

- [ ] **Step 1: Escrever os testes que falham** — SQL: `busca acha por nome, slug e e-mail do dono`, `ordem inválida levanta 22023`, `arquivada só aparece no filtro arquivada`, `filtro bloqueada e legado`, `contagens batem com as listas`, `colunas de saúde vêm preenchidas (reaproveitar a lógica de admin_saude_barracas)`. TS: `FILTROS_ADMIN inclui os filtros novos`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminListarV2Migration.test.ts tests/adminBarracasLib.test.ts`; esperado: FAIL.
- [ ] **Step 3: Escrever a migration** — `drop function` da assinatura antiga e `create` da nova (mesmos grants); `admin_contar_filtros`. Rollback comentado no fim.
- [ ] **Step 4: Atualizar tipos, constantes e hooks** conforme Interfaces.
- [ ] **Step 5: Rodar e ver passar** — mesmo comando; esperado: PASS. Depois `npm test` e `npx tsc -b`.
- [ ] **Step 6: Commit** — `feat(admin): busca, ordenação, filtros e contagens na lista de barracas`.

### Task 6: Ações no card e confirmações

**Files:**
- Create: `src/hooks/useAdminAcoes.ts`
- Create: `src/components/admin/AcoesBarraca.tsx`
- Create: `src/components/admin/DialogoConfirmarAdmin.tsx`
- Modify: `src/pages/AdminBarracas.tsx`
- Test: `tests/adminAcoesLib.test.ts`

**Interfaces:**
- Consumes: RPCs das Tasks 1 a 3 e a lista da Task 5.
- Produces: `useAdminAcoes()` retornando `{ bloquear(usuarioId: string, motivo?: string): Promise<void>; desbloquear(usuarioId: string): Promise<void>; definirPlano(usuarioId: string, plano: 'essencial' | 'pro'): Promise<void>; estender(usuarioId: string, dias: number): Promise<void>; arquivar(barracaId: string, nomeConfirmado: string): Promise<void>; restaurar(barracaId: string): Promise<void>; erro: string | null; ocupado: boolean }`; em `src/lib/adminBarracas.ts`, `export function nomeConfere(digitado: string, nome: string): boolean` (compara sem espaços nas pontas, exige igualdade exata) e `export function textoEfeitoAcao(acao: 'bloquear' | 'arquivar' | 'plano' | 'estender', b: AdminBarraca): string` (frase em português simples dizendo o efeito).

- [ ] **Step 1: Escrever os testes que falham** — `nomeConfere exige igualdade exata e ignora espaços nas pontas`, `textoEfeitoAcao de bloquear cita que dono e funcionários perdem o acesso`, `textoEfeitoAcao de plano avisa quando a conta tem Stripe ativo`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminAcoesLib.test.ts`; esperado: FAIL.
- [ ] **Step 3: Implementar as funções puras** em `src/lib/adminBarracas.ts`.
- [ ] **Step 4: Implementar `useAdminAcoes`** (chama as RPCs; depois de cada sucesso a lista recarrega) e os dois componentes: o diálogo usa o `Button` e o `Card` de `src/components/ui`, tem foco preso, `role="alertdialog"` e rótulos; para arquivar o botão de confirmar só habilita quando `nomeConfere`.
- [ ] **Step 5: Ligar no `AdminBarracas.tsx`** — card ganha Bloquear/Desbloquear, Trocar plano, Estender, Arquivar/Restaurar e mantém "Abrir (somente leitura)"; selos "Bloqueada" e "Legado".
- [ ] **Step 6: Rodar** — `node --test tests/adminAcoesLib.test.ts`, depois `npm test`, `npx tsc -b` e lint; esperado: tudo limpo.
- [ ] **Step 7: Commit** — `feat(admin): ações de bloqueio, plano, vencimento e arquivo no card`.

### Task 7: Reorganização da tela e histórico de ações

**Files:**
- Create: `src/components/admin/BarraBuscaAdmin.tsx`
- Create: `src/components/admin/HistoricoAcoesAdmin.tsx`
- Create: `src/hooks/useAdminHistorico.ts`
- Modify: `src/pages/AdminBarracas.tsx`
- Test: `tests/adminTelaLib.test.ts`

**Interfaces:**
- Consumes: `admin_listar_acoes` (Task 1), `useAdminBarracas`/`useAdminContagens` (Task 5).
- Produces: `useAdminHistorico(ativo: boolean)` retornando `{ linhas: AdminAcaoLog[]; erro: string | null; recarregar(): void }`; tipo `AdminAcaoLog` em `src/lib/adminBarracas.ts`; `export function rotuloAcao(acao: string): string` (traduz `bloquear_conta`, `desbloquear_conta`, `definir_plano`, `estender_vencimento`, `arquivar_barraca`, `restaurar_barraca`).

- [ ] **Step 1: Escrever o teste que falha** — `rotuloAcao traduz as seis ações e devolve a própria chave para desconhecida`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/adminTelaLib.test.ts`; esperado: FAIL.
- [ ] **Step 3: Implementar** `rotuloAcao`, `useAdminHistorico` e os dois componentes.
- [ ] **Step 4: Reorganizar `AdminBarracas.tsx`** — ordem: busca + ordenação + filtros com contagem → lista; resumo, alertas e gráfico recolhidos num bloco "Visão geral" (aberto por padrão só no primeiro acesso, lembrado em `localStorage` com try/catch); remover o bloco "Saúde por barraca" separado e mostrar queda/erros/versão na linha de cada barraca; erros de carregamento com botão "Tentar de novo"; seção "Histórico de ações" no fim; container `max-w-3xl` passa a `max-w-5xl` com grid de 2 colunas de cards a partir de `lg`.
- [ ] **Step 5: Verificar na tela** — `npm run dev` apontando para a produção só em leitura é arriscado: usar `npm run build` + `npx tsc -b` + lint, e abrir `/admin` no navegador com a conta superadmin depois do deploy (Task 9) para conferir celular e desktop.
- [ ] **Step 6: Commit** — `feat(admin): lista primeiro, busca, visão geral recolhida e histórico de ações`.

### Task 8: Paywall de conta bloqueada

**Files:**
- Modify: `src/types/database.ts` (`AssinaturaBarraca`, adicionar `bloqueada?: boolean`)
- Modify: `src/components/PaywallConteudo.tsx` e a tela `/:slug/planos` que o usa
- Test: `tests/paywallBloqueada.test.ts` (função pura)

**Interfaces:**
- Consumes: campo `bloqueada` de `assinatura_da_barraca` (Task 1).
- Produces: em `src/lib/planos.ts`, `export function textoContaBloqueada(a: AssinaturaBarraca): string | null` — `null` se `a.bloqueada` não for verdadeiro; senão a mensagem "Sua conta está bloqueada. Fale com o suporte do Sai aê." (sem botão de assinar).

- [ ] **Step 1: Escrever o teste que falha** — `textoContaBloqueada devolve null quando não bloqueada` e `devolve a mensagem quando bloqueada`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/paywallBloqueada.test.ts`; esperado: FAIL.
- [ ] **Step 3: Implementar** a função e usá-la em `PaywallConteudo`: bloqueada mostra a mensagem e esconde os botões de assinar. Cache antigo sem o campo vale como não bloqueada.
- [ ] **Step 4: Rodar** — `npm test`, `npx tsc -b`, lint; esperado: limpos.
- [ ] **Step 5: Commit** — `feat(paywall): mensagem própria para conta bloqueada pelo admin`.

### Task 9: Aplicar em produção e verificar

**Files:**
- Modify: `docs/admin-operacao.md` (seção "Ações do admin": bloquear, plano, estender, arquivar, log e rollback)

**Interfaces:**
- Consumes: migrations das Tasks 1, 2, 3 e 5 e a edge function da Task 4.

- [ ] **Step 1: Foto antes** — em produção, `mcp__claude_ai_Supabase__execute_sql`: `create table _antes_acesso as select usuario_id, public.assinatura_tem_acesso(a) as tem from assinaturas a;` (tabela temporária de verificação, apagada no passo 4).
- [ ] **Step 2: Pedir o ok do João para aplicar** — mostrar a lista das migrations e a contagem do backfill de `origem_plano`; só seguir com a resposta dele.
- [ ] **Step 3: Aplicar as migrations em ordem** com `mcp__claude_ai_Supabase__apply_migration` (nome igual ao do arquivo sem o carimbo). Conferir `get_advisors` de segurança depois.
- [ ] **Step 4: Foto depois** — `select count(*) from assinaturas a join _antes_acesso x using (usuario_id) where public.assinatura_tem_acesso(a) <> x.tem;`; esperado: `0`. Depois `drop table _antes_acesso;`.
- [ ] **Step 5: Publicar a edge function** `apagar-barracas-arquivadas` com `mcp__claude_ai_Supabase__deploy_edge_function`; confirmar o segredo do cron.
- [ ] **Step 6: Deploy do front** pelo mesmo caminho usado nos PRs #191 e #192; abrir `/admin` com a conta superadmin e testar, em uma barraca de teste criada para isso: bloquear/desbloquear, trocar plano, estender, arquivar/restaurar. Conferir o histórico.
- [ ] **Step 7: Atualizar `docs/admin-operacao.md` e commit** — `docs(admin): operação das ações do superadmin`.

---

## Self-review

- **Cobertura do design:** bloqueio (T1), plano/vencimento/legado (T2), arquivar/restaurar/apagar em 30 dias (T3, T4), log (T1, T7), lista e UX (T5, T6, T7), paywall de bloqueada (T8), produção com foto antes/depois e rollback (T1 a T3, T9). Sem lacuna.
- **Consistência de nomes:** `admin_registrar_acao`, `bloqueada_admin`, `origem_plano`, `arquivada_em`, `useAdminAcoes`, `nomeConfere` iguais em todas as tasks.
- **Proporção:** o plano traz assinaturas e nomes de teste; corpos SQL e TSX ficam para o implementador.
