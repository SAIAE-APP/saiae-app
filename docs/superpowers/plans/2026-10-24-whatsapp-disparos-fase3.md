# WhatsApp Disparos (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono da loja dispara "reativar quem sumiu" e "promoção do dia" pelo WhatsApp da própria loja, e cada pedido entregue gera um pedido de avaliação (nota 1 a 5), tudo com descadastro, tetos e fila.

**Architecture:** O Sai aê (Supabase) é dono do público e da decisão: calcula os destinatários consentidos, mostra a prévia, e só envia ao CRM quando o dono confirma. O CRM (Baileys) é dono da fila, dos tetos, do "SAIR" e do envio. A avaliação nasce do evento `order.status_changed` com `status = entregue` (já recebido pelo CRM), a resposta do cliente é capturada nas mensagens recebidas do Baileys antes do bot de pedidos. Nenhum disparo sai sozinho; avaliação é follow-up do pedido e fica desligada por padrão.

**Tech Stack:** Sai aê: React/Vite, Supabase (Postgres, RPC, edge functions Deno), testes `node:test` (`npm test`). CRM: Next.js, Prisma/MySQL, Baileys, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` §7 e §10 (decisão 3), mais a conversa de 2026-10-24 (resumo na seção "Decisões desta fase").

## Decisões desta fase (minhas, o João pediu para decidir sem perguntar)

1. **Módulo pago:** coluna `barracas.whatsapp_disparos_habilitado` (default false, só plataforma altera; igual `ia_habilitada`). Sem ela a seção nem aparece. Cobrança continua fora do código.
2. **Quem envia o público:** o app calcula e envia os destinatários ao CRM na hora do disparo (a rota "elegíveis" da spec vira o próprio `enviar`). O CRM nunca lê o banco do Sai aê.
3. **Público:** só `clientes_finais.consentimento_marketing_em` não nulo. Reativar = última atividade (maior entre último pedido não cancelado e `criado_em` do cliente) mais antiga que N dias (15, 30, 60 ou 90). Promoção = todos os consentidos. Máximo 500 destinatários por campanha.
4. **Rodapé obrigatório no CRM:** toda mensagem de campanha termina com `Para não receber mais mensagens, responda SAIR.` O app não consegue remover.
5. **Tetos de campanha (CRM):** 1 mensagem de campanha por cliente por 24 h por loja (qualquer campanha), 2 campanhas criadas por loja por 24 h, 1 campanha em andamento por loja, 3 envios/min e 150/dia por número (6/min... não: 3/min e 20/dia na primeira semana do número), pausa aleatória de 8 a 25 s entre envios, só entre 09:00 e 20:00 (America/Sao_Paulo), campanha não enviada em 24 h expira. Avisos de pedido continuam com os tetos próprios e não contam nos de campanha.
6. **Avaliação:** enviada 30 min depois do `entregue`, uma vez por pedido, só com telefone, nunca para pedido que nasceu entregue nem com aviso `cancelado` no mesmo pedido, só se `avaliacao_ativa` e módulo ligados (checado na hora do envio). Não existe registro de reclamação no Sai aê: a regra implementável é "sem cancelamento"; fica documentado como limite. Resposta aceita por 48 h. Nota ≤ 2 chama o dono na hora; qualquer nota vai ao WhatsApp do dono e ao histórico.
7. **Resposta não ambígua:** só vira nota se a mensagem é `N`, `nota N`, `N estrelas` ou começa com `N` seguido de espaço/pontuação (N de 1 a 5), e se o bot de pedidos NÃO tem conversa aberta com o contato. Senão segue para o bot e a avaliação continua aberta.
8. **Privacidade:** telefone e nome só ficam no banco do CRM enquanto o item está pendente (campanha) ou aguardando resposta (avaliação); depois viram `null`. Campanha guarda `chave = sha256(barracaId:telefone)` para o teto diário. Comentário da avaliação: máx. 300 caracteres, guardado no CRM e mostrado só ao dono da loja.

## Global Constraints

- Português do Brasil em toda mensagem ao cliente e tela. Código, docs e commits em redação normal.
- HMAC igual ao das outras rotas de plataforma: `X-Saiae-Event-Id` (= `request_id`), `X-Saiae-Timestamp`, `X-Saiae-Signature`, janela de 5 min, segredo `COMANDA_WHATSAPP_SEGREDO` (CRM) = `WHATSAPP_CONEXAO_SEGREDO` (app), lista separada por vírgula aceita.
- Logs sem telefone, nome, texto de mensagem nem comentário.
- Nenhuma mudança em tabela existente do CRM (só tabelas novas: o CRM roda `prisma db push` em todo start).
- App: migrations só aditivas; coluna paga protegida de escrita pelo cliente como em `20261030120000_whatsapp_proteger.sql`.
- Não fazer merge nem deploy em produção. Staging (Supabase `qzcqwovbbylqxljcrqhk`, loja `jmal`) só.
- O app não calcula preço nem envia WhatsApp; o CRM não decide público.

## Review Focus

- Mesma campanha reenviada (mesmo `request_id`) não duplica envio. Teste na rota e no registro.
- Cliente que respondeu "SAIR" depois de a campanha ser criada não recebe (checagem na hora do envio, não na criação).
- Cliente em duas campanhas no mesmo dia recebe só a primeira.
- Campanha para a loja A nunca usa a sessão, o histórico ou o cancelamento da loja B (`campanha_id` de outra loja em `cancelar` = nada cancelado).
- Resposta "5" de quem está no meio de um pedido com o bot não vira avaliação; "Quero 2 pizzas" nunca vira nota 2; "10" e "0" não viram nota.
- Avaliação duplicada: o evento `entregue` chega duas vezes ou o cliente responde duas vezes, e só uma nota fica.
- Sessão desconectada no meio da campanha: itens esperam; passando de 24 h expiram; nada acumula além disso.
- Texto de campanha com `{nome}` sem nome cadastrado não deixa "Olá !" na mensagem.
- Dono sem `whatsapp_dono`: avaliação é registrada e aparece no histórico, sem erro.

## Contrato CRM ↔ app (v1)

### Rota CRM: `POST /api/integracao/comanda/v1/whatsapp-disparos`

Pública em `src/proxy.ts` (caminho exato), mesma ordem de checagens da rota `whatsapp-conexao` (503 não configurado → 413 → 401 → 400 → 422 → 429 → ação). Corpo máximo 262144 bytes (256 KB). Limite 30 chamadas/min por loja. Corpo `strict` (zod), `X-Saiae-Event-Id` igual a `request_id`.

Campos comuns: `barraca_id` (uuid), `request_id` (uuid), `acao`.

- `criar`: `tipo` (`promocao` | `reativacao`), `texto` (1 a 600), `barraca_nome` (1 a 80), `destinatarios` (1 a 500 itens `{ telefone: string de 8 a 15 dígitos, nome: string ≤ 60 | null }`).
  - 200 `{ ok: true, campanha_id, total, invalidos, repetido }` (`total` = destinatários únicos aceitos; `repetido: true` se o `request_id` já existia, devolvendo a campanha original).
  - 200 `{ ok: false, motivo }` com `motivo` em `whatsapp_desconectado` | `campanha_em_andamento` | `limite_campanhas_dia` | `sem_destinatarios_validos`.
- `historico`: 200 `{ ok: true, campanhas: [{ id, tipo, estado, criada_em, total, enviados, falhas, pulados, na_fila }] (até 10, mais recentes primeiro), avaliacoes: { media: number | null, total: number, enviadas_30d: number, itens: [{ pedido_id, nota, comentario: string | null, em }] (até 20) } }`. `estado` da campanha: `em_andamento` | `concluida` | `cancelada` | `expirada`.
- `cancelar`: `campanha_id` (string 1 a 40). 200 `{ ok: true, cancelados: number }` (itens `pendente` da campanha DA LOJA viram `cancelado`; campanha de outra loja = `cancelados: 0`).

### Ação nova da `integracao-v1` (app): `avaliacao_config`

Mesmo envelope HMAC das ações existentes (ver `supabase/functions/_shared/integracaoV1.ts`). Resposta `{ ok: true, avaliacao: { ativo: boolean, texto: string | null, whatsapp_dono: string | null, barraca_nome: string } }`. `ativo` = `whatsapp_disparos_habilitado AND avaliacao_ativa`.

### Edge function nova do app: `whatsapp-disparos` (com JWT)

Corpo `{ barraca_id, acao, ... }`, `acao` em `previa` | `enviar` | `historico` | `cancelar`. Vínculo em `usuarios_barracas`; `enviar` e `cancelar` só `papel = 'dono'`. Módulo desligado = 403 `{ erro: 'modulo_desligado' }`. Resposta `{ ok: true, ... }`.
- `previa` `{ tipo, dias? }` → `{ ok, total, enviaveis }` (`enviaveis` = min(total, 500)).
- `enviar` `{ tipo, dias?, texto }` → repassa ao CRM `criar` com `request_id` gerado; devolve `{ ok: true, campanha_id, total }` ou `{ ok: false, motivo }` (motivos do CRM, mais `sem_publico`).
- `historico` → repassa o `historico` do CRM.
- `cancelar` `{ campanha_id }` → repassa.
- `dias` obrigatório e em 15 | 30 | 60 | 90 quando `tipo = reativacao`.

### SQL novo do app

- Colunas em `barracas`: `whatsapp_disparos_habilitado boolean not null default false`, `avaliacao_ativa boolean not null default false`, `avaliacao_texto text` (≤ 500 caracteres, nulo = texto padrão). Só plataforma escreve `whatsapp_disparos_habilitado`.
- RPC `whatsapp_avaliacao_salvar(p_barraca_id uuid, p_ativa boolean, p_texto text) returns jsonb`: estados `ok` | `nao_autenticado` | `sem_acesso` | `modulo_desligado` | `dados_invalidos` (texto vazio ou só espaços ou > 500).
- RPC `disparos_publico(p_barraca_id uuid, p_tipo text, p_dias integer) returns table (telefone text, nome text)`: só `service_role`, sem limite interno; a função da edge corta em 500. RPC `disparos_publico_contagem(...) returns integer`.
- RPC `integracao_avaliacao_config(p_barraca_id uuid) returns jsonb`: só `service_role`.

## File Structure

CRM (`C:\Users\AORUS\saiae-integracao\saiae-crm`, branch `feat/whatsapp-avisos-baileys`):
- `prisma/schema.prisma`: modelos `DisparoCampanha`, `DisparoEnvio`, `AvaliacaoPedido` (só adições).
- `src/modules/disparos/regras.ts` (+test): constantes, janela horária, rodapé, normalização do texto, chave do cliente.
- `src/modules/disparos/campanha.ts` (+test): `validarPedidoDisparo`, `criarCampanha`, `historicoDisparos`, `cancelarCampanha`.
- `src/modules/disparos/worker.ts` (+test): fila das campanhas.
- `src/modules/disparos/avaliacao.ts` (+test): agendar no evento, worker de envio, `tratarRespostaAvaliacao`, texto padrão, parse da nota.
- `src/app/api/integracao/comanda/v1/whatsapp-disparos/route.ts` (+test), `src/proxy.ts` (rota pública).
- Ligações: `registrarAvisoDoEvento`/rota de eventos chama `agendarAvaliacaoDoEvento`; `src/modules/whatsapp/instance.ts` chama `tratarRespostaAvaliacao` antes do bot; `src/server/index.ts` liga os workers.
- `src/modules/bot-pedidos/saiae.ts`: `avaliacaoConfig(barracaId)`.
- `docs/whatsapp-disparos.md`, `.env.example` sem variável nova obrigatória.

App (`C:\Users\AORUS\saiae-integracao\saiae`, branch `feat/whatsapp-avisos`):
- `supabase/migrations/20261101100000_disparos_whatsapp.sql`, `20261101110000_disparos_publico.sql` (+ testes de migration no estilo de `tests/acessoSuporteMigration.test.ts`).
- `supabase/functions/_shared/disparosCrm.ts` (+test), `supabase/functions/whatsapp-disparos/index.ts`, ação em `supabase/functions/integracao-v1/index.ts` e `_shared/integracaoV1.ts`.
- `src/lib/disparos.ts` (+test), `src/hooks/useWhatsappDisparos.ts`, `src/components/SecaoDisparos.tsx`, ligação em `src/pages/Ajustes.tsx`, tipo em `src/types/database.ts`.
- `docs/contrato/v1/whatsapp-disparos.md`, `docs/roteiro-whatsapp-disparos.md`.

## Trilha A: CRM

### Task A1: modelos e regras puras

**Files:** Modify `prisma/schema.prisma`. Create `src/modules/disparos/regras.ts`, `regras.test.ts`.

**Interfaces:**
- Produces (`regras.ts`): `MAX_DESTINATARIOS = 500`, `MAX_TEXTO = 600`, `RODAPE_SAIR = 'Para não receber mais mensagens, responda SAIR.'`, `TETO_CAMPANHA = { minuto: 3, diaNovo: 20, diaNormal: 150 }`, `JITTER_CAMPANHA_MS = { min: 8000, max: 25000 }`, `VALIDADE_CAMPANHA_MS = 24h`, `MAX_CAMPANHAS_DIA = 2`; `dentroDaJanela(agora: number): boolean` (09:00 a 19:59 em America/Sao_Paulo, sem depender do fuso do servidor); `proximaJanela(agora: number): number` (timestamp da próxima 09:00 de São Paulo); `montarTextoCampanha(modelo: string, v: { nome: string | null; barraca: string }): string` (reusa `montarMensagem` de `aviso-textos.ts`, depois acrescenta `\n\n` + rodapé; nunca duplica o rodapé se o dono já escreveu a mesma frase); `chaveDoCliente(barracaId: string, telefone: string): string` (sha256 hex).
- Modelos Prisma conforme "Decisões" 8 e contrato: `DisparoCampanha(id cuid, barracaId, requestId @unique, tipo, estado @default("em_andamento"), texto @db.Text, barracaNome, total Int, criadoEm, atualizadoEm; @@index([barracaId, criadoEm]))`; `DisparoEnvio(id, campanhaId, barracaId, chave, estado @default("pendente"), motivo?, tentativas Int @default(0), proximaTentativaEm @default(now()), enviadoEm?, payload Json?, criadoEm, atualizadoEm; @@unique([campanhaId, chave]), @@index([estado, proximaTentativaEm]), @@index([barracaId, chave, enviadoEm]))` com estados `pendente | enviado | falhou | pulado_optout | pulado_limite_diario | pulado_desconectado | cancelado | expirado`; `AvaliacaoPedido(id, barracaId, pedidoId, estado @default("agendada"), motivo?, tentativas Int @default(0), enviarEm, ocorridoEm, enviadaEm?, respondidaEm?, nota Int?, comentario String? @db.Text, payload Json?, criadoEm, atualizadoEm; @@unique([barracaId, pedidoId]), @@index([estado, enviarEm]), @@index([barracaId, criadoEm]))` com estados `agendada | enviada | respondida | expirada | falhou | pulada_sem_telefone | pulada_desativada | pulada_optout | pulada_cancelado | pulada_desconectada`. Seguir o estilo de comentários de `AvisoPedido`.

- [ ] **Step 1:** Escrever `regras.test.ts`: `dentroDaJanela` falso às 08:59 e às 20:00 e verdadeiro às 09:00 e 19:59 de São Paulo (usar timestamps UTC fixos, fuso -03:00); `proximaJanela` de 21:00 SP devolve 09:00 SP do dia seguinte e de 07:00 SP devolve 09:00 do mesmo dia; `montarTextoCampanha('Oi {nome}, tem promoção!', { nome: null, barraca: 'X' })` não contém `Oi !` e termina com o rodapé; texto que já termina com o rodapé não o duplica; `chaveDoCliente` é estável, 64 hex, e muda com a loja.
- [ ] **Step 2:** `npx vitest run src/modules/disparos/regras.test.ts`. Esperado: FALHA (módulo ausente).
- [ ] **Step 3:** Implementar `regras.ts` e os modelos; `npx prisma validate` e `npx prisma generate`.
- [ ] **Step 4:** Rodar o teste. Esperado: PASSA.
- [ ] **Step 5:** Commit `feat(disparos): modelos e regras das campanhas e da avaliação` (nenhum arquivo fora da lista; há `.claude/` não relacionado, não adicionar).

### Task A2: campanha (criar, histórico, cancelar) e rota

**Files:** Create `src/modules/disparos/campanha.ts`, `campanha.test.ts`, `src/app/api/integracao/comanda/v1/whatsapp-disparos/route.ts`, `route.test.ts`. Modify `src/proxy.ts`.

**Interfaces:**
- Consumes: A1; `sessaoDaBarraca` (`aviso-registro.ts`); `normalizeBrPhone` (`contato.ts`); `waManager.getInstance(sessionId)?.status === 'CONNECTED'`; padrão da rota `whatsapp-conexao/route.ts` (copiar a ordem de checagens, `segredosWhatsapp`, limite por minuto).
- Produces: `validarPedidoDisparo(json: unknown): { ok: true; dados: PedidoDisparo } | { ok: false }`; `executarAcaoDisparo(p: PedidoDisparo, over?: Partial<DisparoDeps>): Promise<RespostaDisparo>` com as respostas do contrato; `DisparoDeps` injeta `db`, `now`, `estaConectada` (testável sem banco).

- [ ] **Step 1:** Testes de `campanha.test.ts` com banco falso: criar registra campanha + um envio por telefone único normalizado (`55` + DDD…), remove duplicados e inválidos e informa `invalidos`; mesmo `request_id` devolve `repetido: true` sem novos envios; sessão desconectada → `{ ok: false, motivo: 'whatsapp_desconectado' }`; loja sem vínculo idem; segunda campanha com a primeira `em_andamento` → `campanha_em_andamento`; 3ª campanha em 24 h → `limite_campanhas_dia`; só inválidos → `sem_destinatarios_validos`; `payload` do envio tem `{ telefone, nome }` com nome cortado em 60; `historico` conta enviados/falhas/pulados/na_fila por campanha e só da loja pedida; `cancelar` muda só `pendente` da loja certa e, com campanha de outra loja, devolve `cancelados: 0`.
- [ ] **Step 2:** Testes de `route.test.ts` espelhando `whatsapp-conexao/route.test.ts`: sem segredo 503; corpo > 256 KB 413 (inclusive por `content-length`); assinatura inválida/fora da janela 401 idêntico; JSON inválido 400; corpo fora do contrato (campo extra, `destinatarios` vazio ou com 501) 422; `X-Saiae-Event-Id` diferente do `request_id` 422; 429 após 30 chamadas na mesma loja; sucesso.
- [ ] **Step 3:** Rodar e ver falhar. Implementar; incluir `/api/integracao/comanda/v1/whatsapp-disparos` como caminho exato público em `src/proxy.ts`. Rodar: PASSA. `npx tsc --noEmit -p .` limpo.
- [ ] **Step 4:** Commit `feat(disparos): rota assinada para criar, consultar e cancelar campanhas`.

### Task A3: worker das campanhas

**Files:** Create `src/modules/disparos/worker.ts`, `worker.test.ts`. Modify `src/server/index.ts` (ligar junto do worker de avisos; seguir como `iniciarWorkerAvisos` é ligado).

**Interfaces:**
- Consumes: A1, A2; estrutura de `aviso-worker.ts` (reserva por `updateMany`, `RESERVA_MS`, `processarPendentes`, deps injetáveis).
- Produces: `processarEnvio(linha, deps): Promise<void>`, `processarCampanhas(over?): Promise<number>`, `iniciarWorkerCampanhas(): void`, `acordarWorkerCampanhas(): void` (chamado ao final de `criarCampanha`).

Ordem de decisão por envio (cada saída grava `payload: null`, exceto adiamento): campanha `cancelada` → `cancelado`; passou de 24 h da criação → `expirado`; fora da janela horária → adia até `proximaJanela`; sessão desconectada → adia 60 s (passa da validade → `pulado_desconectado`); teto por minuto/dia da loja (contando `DisparoEnvio.enviado`) → adia 60 s (dia cheio → adia até a próxima janela); cliente descadastrado → `pulado_optout`; já houve `enviado` com a mesma `chave` nas últimas 24 h em qualquer campanha → `pulado_limite_diario`; envio com `sleep(jitter)`, `resolveRecipient`, `sendText(montarTextoCampanha(...))`, `enviado`. Falha: 2 retentativas (30 s, 5 min) e `falhou`; número sem WhatsApp → `falhou` com motivo `numero_sem_whatsapp`. Quando não restam `pendente` na campanha, ela vira `concluida`.

- [ ] **Step 1:** Testes (banco e relógio falsos, como `aviso-worker.test.ts`): um caso por linha da ordem acima; "SAIR" depois da criação é respeitado; duas campanhas com o mesmo cliente enviam só uma; o texto enviado tem o rodapé e `{nome}` preenchido (sem "Olá !" quando o nome é `null`); a campanha vira `concluida` ao acabar a fila; reserva impede dois workers no mesmo item; nenhum log contém telefone, nome ou texto.
- [ ] **Step 2:** Rodar e ver falhar. Implementar. Rodar: PASSA. Typecheck limpo.
- [ ] **Step 3:** Commit `feat(disparos): worker da fila de campanhas com tetos, janela e descadastro`.

### Task A4: avaliação pós-entrega

**Files:** Create `src/modules/disparos/avaliacao.ts`, `avaliacao.test.ts`. Modify `src/modules/bot-pedidos/saiae.ts` (+`saiae.test.ts`: `avaliacaoConfig`), `src/modules/integracao/comanda/aviso-registro.ts` (ou rota de eventos; onde o evento `entregue` já é tratado) para chamar `agendarAvaliacaoDoEvento`, `src/modules/whatsapp/instance.ts` (chamar `tratarRespostaAvaliacao` ANTES do bot de pedidos; se devolver `true`, parar), `src/server/index.ts`.

**Interfaces:**
- Consumes: A1; `saiae.ts` (cliente HMAC da `integracao-v1`) ganha `avaliacaoConfig(barracaId): Promise<{ ativo: boolean; texto: string | null; whatsapp_dono: string | null; barraca_nome: string } | null>` (null em qualquer falha); `estado.ts` do bot precisa expor se o contato tem conversa aberta (se ainda não expõe, adicionar `temConversaAberta(chave): boolean` com teste).
- Produces: `agendarAvaliacaoDoEvento(event: ComandaEvent, db?): Promise<void>` (cria `AvaliacaoPedido` `agendada` com `enviarEm = ocorridoEm + 30 min` e `payload { telefone, nome, senha }`; pula `nasceu_entregue`, sem telefone vira `pulada_sem_telefone`; duplicata P2002 é ignorada); `processarAvaliacoes(over?): Promise<number>` e `iniciarWorkerAvaliacoes()`; `parseNota(texto: string): { nota: 1|2|3|4|5; comentario: string | null } | null`; `tratarRespostaAvaliacao(a: { sessionId: string; jid: string; texto: string }, over?): Promise<boolean>`; `TEXTO_AVALIACAO_PADRAO = 'Olá {nome}! Como foi seu pedido {senha} na {barraca}? Responda com uma nota de 1 a 5 (5 = ótimo) e, se quiser, deixe um comentário.'`.

Regras do worker de envio: config via `avaliacaoConfig` (falha → adia 5 min; passou de 6 h → `falhou`); `!ativo` → `pulada_desativada`; existe `AvisoPedido` `cancelado` do pedido → `pulada_cancelado`; descadastrado → `pulada_optout`; sessão desconectada → adia (6 h → `pulada_desconectada`); janela horária 09:00–20:00 SP (fora dela adia); tetos e jitter dos avisos. Envio ok → `enviada`, `enviadaEm`, mantém `payload`. `enviada` há mais de 48 h → `expirada` e `payload: null`.

`tratarRespostaAvaliacao`: acha a avaliação `enviada` mais recente da loja da sessão cujo telefone bate com o `jid` e `enviadaEm` < 48 h; se o bot tem conversa aberta com o contato ou `parseNota` é `null`, devolve `false`. Senão grava `nota`, `comentario` (≤ 300), `respondidaEm`, estado `respondida`, `payload: null` (um `updateMany` condicional em `estado = 'enviada'` garante uma só nota por pedido); agradece ao cliente (nota ≥ 3: "Obrigado pela avaliação!"; nota ≤ 2: "Sentimos muito. Vamos avisar o responsável da loja para falar com você."); avisa o dono por `sendText` ao `whatsapp_dono` (primeiro nome do cliente, senha, nota, comentário; nota ≤ 2 com prefixo "ATENÇÃO:"), sem erro se não há dono; devolve `true`.

- [ ] **Step 1:** Testes de `parseNota`: `5`, `nota 4`, `4 estrelas`, `3 - demorou`, `2, frio` válidos; `10`, `0`, `6`, `Quero 2 pizzas`, `2x yakisoba`, vazio, `sim` → `null`; comentário cortado em 300.
- [ ] **Step 2:** Testes de agendamento e worker (banco/relógio/`avaliacaoConfig` falsos): um caso por regra acima, inclusive evento duplicado, `nasceu_entregue`, sem telefone, falha da config, nenhum envio fora da janela.
- [ ] **Step 3:** Testes de `tratarRespostaAvaliacao`: nota válida grava, agradece e avisa o dono; nota 2 usa o prefixo; duas respostas seguidas gravam só a primeira; bot com conversa aberta → `false` sem gravar; telefone de outra loja → `false`; 49 h depois → `false`; dono ausente → grava e devolve `true`; `jid` de outro contato nunca toca avaliação alheia.
- [ ] **Step 4:** Rodar e ver falhar. Implementar e ligar (`instance.ts`, `server/index.ts`, gancho do evento). Rodar a suíte inteira (`npx vitest run`) e `npx tsc --noEmit -p .`. Esperado: tudo passa, sem regressão (base: 1589 testes).
- [ ] **Step 5:** Commit `feat(disparos): avaliação pós-entrega com nota por WhatsApp e aviso ao dono`.

### Task A5: documentação do CRM

**Files:** Create `docs/whatsapp-disparos.md`; Modify `docs/README.md`.

- [ ] **Step 1:** Documentar rota, tetos, janela, privacidade, estados, o que o `prisma db push` cria, limite honesto (Baileys não oficial, risco de bloqueio, sem registro de reclamação) e o que NÃO existe (Google Avaliações, cobrança do módulo).
- [ ] **Step 2:** Commit `docs(disparos): documentação das campanhas e da avaliação`.

## Trilha B: app (independente da trilha A, em paralelo)

### Task B1: migrations

**Files:** Create `supabase/migrations/20261101100000_disparos_whatsapp.sql`, `20261101110000_disparos_publico.sql`, `tests/disparosMigration.test.ts`.

**Interfaces:** o "SQL novo do app" do contrato. Partir de `20261030100000_whatsapp_avisos.sql` e `20261030120000_whatsapp_proteger.sql` (revogar escrita de `whatsapp_disparos_habilitado`, `avaliacao_ativa`, `avaliacao_texto` pelo cliente: só pela RPC; `ia_habilitada` é o modelo). `disparos_publico` casa `pedidos` com `clientes_finais` pelo mesmo critério de telefone usado em `montar_evento_saida` (migration `20261016110000_eventos_saida.sql`, perto da linha 250), ignora pedidos `cancelado`, só `consentimento_marketing_em is not null`, `reativacao` ordena pela atividade mais recente primeiro. Funções `security definer`, `set search_path = public, pg_temp`, `revoke all ... from public, anon, authenticated` e `grant execute ... to service_role` nas três RPCs de plataforma; `whatsapp_avaliacao_salvar` é `authenticated` e checa `usuario_tem_acesso_barraca`.

- [ ] **Step 1:** Escrever `tests/disparosMigration.test.ts` no estilo de `tests/acessoSuporteMigration.test.ts`: lê os dois arquivos e confere colunas, `default false`, constraint de tamanho, `security definer`, `set search_path`, grants (service_role nas de plataforma, authenticated só em `whatsapp_avaliacao_salvar`), ausência de `grant ... to anon`, e que o rollback está no cabeçalho.
- [ ] **Step 2:** `npm test -- tests/disparosMigration.test.ts` (ou o comando de teste único do repo). Esperado: FALHA.
- [ ] **Step 3:** Escrever as migrations. Aplicar no STAGING pelo MCP Supabase (`qzcqwovbbylqxljcrqhk`), nunca na produção. Verificar por SQL: coluna existe, `disparos_publico_contagem` na `jmal` roda, `authenticated` não consegue `update barracas set whatsapp_disparos_habilitado`.
- [ ] **Step 4:** Teste passa; commit `feat(disparos): colunas, RPCs de público e de configuração da avaliação`.

### Task B2: funções do servidor

**Files:** Create `supabase/functions/_shared/disparosCrm.ts`, `tests/disparosCrm.test.ts` (ou onde ficam os testes de `_shared/`, ver `crmConexao`), `supabase/functions/whatsapp-disparos/index.ts`. Modify `supabase/functions/integracao-v1/index.ts` e `_shared/integracaoV1.ts` (+ seus testes) para a ação `avaliacao_config`.

**Interfaces:** o contrato "Edge function" e "Ação nova da integracao-v1". `disparosCrm.ts` exporta `chamarDisparosCrm(a: { url; segredo; barracaId; requestId; corpo }, fetchFn?)` (mesma assinatura/`cabecalhosDoEvento`/`urlPermitida`/timeout 10 s/`redirect: 'manual'` de `crmConexao.ts`), validadores de resposta que rejeitam formato fora do contrato, `podeDisparar(acao, papel)` (`enviar` e `cancelar` só dono) e `validarEnvio(b: unknown)` (texto 1 a 600 após trim, `tipo`, `dias` em 15|30|60|90 para reativação). URL: `CRM_WHATSAPP_DISPAROS_URL`, com padrão derivado trocando o final de `CRM_WHATSAPP_CONEXAO_URL` de `whatsapp-conexao` para `whatsapp-disparos` (documentar). Segredo: `primeiroSegredo(WHATSAPP_CONEXAO_SEGREDO)`.

- [ ] **Step 1:** Testes: `podeDisparar`; validação de envio (texto vazio, só espaços, 601 caracteres, tipo inválido, `dias` ausente/fora da lista); corpo enviado ao CRM contém só os campos do contrato e telefone só com dígitos; resposta do CRM malformada → falha; `redirect: 'manual'` e timeout; `integracao_avaliacao_config` mapeada na ação nova com `ok` e `avaliacao`.
- [ ] **Step 2:** Rodar e ver falhar. Implementar. A função `whatsapp-disparos` confere JWT, vínculo, `whatsapp_disparos_habilitado` (403 `modulo_desligado`), papel, chama `disparos_publico`/`disparos_publico_contagem` com o cliente service role, corta em 500, usa `barracas.nome` como `barraca_nome`, devolve `sem_publico` quando a lista vem vazia. Nunca devolve erro cru do CRM nem telefones ao navegador.
- [ ] **Step 3:** `npm test`, `tsc -b`, lint sem erro novo. Publicar no staging com a CLI (`supabase functions deploy whatsapp-disparos --project-ref qzcqwovbbylqxljcrqhk` com JWT; `integracao-v1` sem JWT como já está; ler o segredo de `C:\Users\AORUS\saiae-integracao\staging-credenciais.txt` só se precisar, sem imprimir). Chamada real: `previa` na `jmal` devolve contagem.
- [ ] **Step 4:** Commit `feat(disparos): edge function whatsapp-disparos e ação avaliacao_config`.

### Task B3: tela

**Files:** Create `src/lib/disparos.ts`, `tests/disparos.test.ts`, `src/hooks/useWhatsappDisparos.ts`, `src/components/SecaoDisparos.tsx`. Modify `src/pages/Ajustes.tsx` (renderizar logo abaixo de `SecaoWhatsappAutomacao`, só se `barraca.whatsapp_disparos_habilitado`), `src/types/database.ts` (+ a lista de colunas que `useBarraca` seleciona, se houver).

**Interfaces:** `src/lib/disparos.ts` exporta `TIPOS_DISPARO`, `DIAS_REATIVACAO = [15, 30, 60, 90]`, `MAX_TEXTO_DISPARO = 600`, `TEXTOS_SUGERIDOS: Record<TipoDisparo, string[]>` (2 por tipo, com `{nome}` e `{barraca}`), `textoDisparoValido(t: string): boolean`, `rotuloEstadoCampanha(e)`, `resumoCampanha(c)` ("12 de 20 enviadas"), `mediaAvaliacoes(itens)`, `estrelas(n: number): string`. Hook: `useWhatsappDisparos(barracaId)` com `previa`, `enviar`, `cancelar`, `historico` pela função `whatsapp-disparos`, polling do histórico (15 s com aba visível, 5 s com campanha em andamento). Usar os componentes `ui/` existentes (`Card`, `Button`, `Textarea`, `Toggle`, `Icone`), o padrão de salvar de `SecaoWhatsappAutomacao.tsx` para a avaliação (RPC `whatsapp_avaliacao_salvar`) e a estética do restante de Ajustes.

Tela: (1) card "Avaliação após a entrega" (toggle + texto com variáveis e texto padrão visível); (2) card "Campanhas" com escolha Reativar quem sumiu (seletor de dias) ou Promoção do dia, textos sugeridos como botões, textarea com contador, prévia "Vai para X clientes que aceitaram receber ofertas" (e aviso quando passa de 500), botão "Enviar" desabilitado sem WhatsApp conectado, com confirmação em diálogo que repete o número de clientes e avisa que cada cliente recebe no máximo uma mensagem por dia e que o rodapé "SAIR" é incluído; (3) histórico de campanhas (estado, "x de y enviadas", Cancelar enquanto em andamento) e de avaliações (média, lista de notas com comentário). Estados de carregando, vazio e erro como nas outras seções. Mensagens de erro em português por `motivo`.

- [ ] **Step 1:** Testes de `disparos.test.ts` (funções puras acima, `textoDisparoValido` com vazio/espaços/601/600, `resumoCampanha`, `mediaAvaliacoes` vazia e com notas, mapa de motivos para frases).
- [ ] **Step 2:** Rodar e ver falhar. Implementar lib, hook, componente e ligação. `npm test`, `tsc -b`, lint sem erro novo, `npm run build`.
- [ ] **Step 3:** Commit `feat(disparos): tela de campanhas e avaliação em Ajustes`.

### Task B4: contrato e roteiro

**Files:** Create `docs/contrato/v1/whatsapp-disparos.md`, `docs/roteiro-whatsapp-disparos.md`.

- [ ] **Step 1:** Contrato = seção "Contrato CRM ↔ app" deste plano, em formato de contrato (estilo de `whatsapp-conexao.md`). Roteiro de teste com WhatsApp real para o João (ligar flag na `jmal`, avaliação, reativação, promoção, "SAIR", teto, cancelar) no estilo de `roteiro-whatsapp-bot.md`.
- [ ] **Step 2:** Commit `docs(disparos): contrato v1 e roteiro de teste`.

## Fechamento (orquestrador, depois das trilhas)

- [ ] Suítes completas dos dois repositórios, `tsc`, lint, build.
- [ ] Revisão independente (revisor-codigo) dos dois diffs com foco em segurança/privacidade e na lista "Review Focus"; corrigir críticos.
- [ ] Staging: ligar `whatsapp_disparos_habilitado` e `avaliacao_ativa` na `jmal` por SQL; validar a tela no navegador contra o staging (prévia, validações, histórico, confirmação); chamar a function real e, se o CRM de staging já tiver a rota (depende de o Railway publicar a branch), a campanha ponta a ponta com 1 destinatário de teste. O que depender do WhatsApp real fica no roteiro do João.
- [ ] `git push` das duas branches (PR #62 do CRM; app). Sem merge, sem produção.
- [ ] Atualizar memória (`saiae-crm-avisos-whatsapp.md`, `lembrete-teste-bot-whatsapp.md`).
