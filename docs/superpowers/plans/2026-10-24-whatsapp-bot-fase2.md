# Bot de WhatsApp que atende e anota pedido (fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliente manda "oi" ao WhatsApp da loja e recebe o link do cardápio; se preferir, pede por mensagem e o bot anota o pedido (pagar na entrega ou Pix), sem a IA nunca somar preço.

**Architecture:** O Sai aê ganha a edge function `integracao-v1` (HMAC de plataforma, `barraca_id` no corpo) com quatro ações: `cardapio`, `rascunho`, `pedido`, `pix`. O CRM liga as mensagens recebidas pelo Baileys a um motor de bot próprio (`src/modules/bot-pedidos`), que só conhece a loja pela sessão (`BarracaSessao`) e fala com o Sai aê pelas quatro ações. O aviso "pedido recebido" que o fase 1 já envia cobre a confirmação do Pix (uma mensagem só).

**Tech Stack:** Supabase (Postgres, Edge Functions Deno), Next.js/Baileys/Prisma/Vitest (CRM), Anthropic SDK já usado em `ia-atendimento/llm.ts`.

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` (seções 6 e 10).

## Global Constraints

- Sem merge nem deploy em produção sem OK explícito do João. Só staging (`qzcqwovbbylqxljcrqhk`) e push de branch.
- Segredos nunca em chat nem digitados por agente em campos de serviços. Segredos do staging em `C:\Users\AORUS\saiae-integracao\staging-credenciais.txt`, usados sem imprimir.
- Commitar só arquivos da própria mudança (há alterações de outra sessão no working tree do app: pasta `.claude/`).
- A IA nunca informa nem soma valor: preço e total vêm de `resolver_carrinho`. Pedido só é criado depois de "sim" explícito do cliente ao resumo, verificado em código (não pelo modelo).
- Logs sem telefone, nome, itens ou texto de mensagem.
- Autenticação da `integracao-v1`: HMAC `X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpoBruto)`, `X-Saiae-Timestamp` em segundos, janela de 300 s, segredo `WHATSAPP_CONEXAO_SEGREDO` (lista separada por vírgula para rotação, cada um com 16+ caracteres). Este é um contrato novo, aditivo ao v1; o Bearer do `INTEGRACAO.md` §3 continua reservado para integrações de terceiros.
- Erros no padrão do contrato: 401 sem corpo (assinatura/janela), 405 se não for POST, 413 acima de 4 KB, 422 corpo fora do contrato sem ecoar valores, 503 sem segredo, 500 `{erro}` genérico.

## Review Focus

- Cliente diz "sim" a um resumo antigo ou a outro assunto: só vale "sim" logo após o resumo vigente (hash do rascunho).
- Mesmo `client_uuid` reenviado (reentrega, duplo "sim"): um único pedido (idempotência de `criar_pedido`).
- Loja com `ia_habilitada = false` ou fora do horário: bot só manda o link do cardápio, nunca cria pedido.
- Loja com `perfil_cliente_obrigatorio`: Pix recusado com 422 `perfil_obrigatorio`, bot cai para link do cardápio.
- Cliente em opt-out (SAIR) ou conversa pausada para humano: bot calado.
- Item esgotado, inexistente ou opção inválida: erro do resolver vira "não achei" + link, sem inventar.

---

## Contrato `integracao-v1` (fixo, os dois lados seguem)

`POST /functions/v1/integracao-v1`, corpo JSON `{ "barraca_id": uuid, "acao": "cardapio"|"rascunho"|"pedido"|"pix", ... }`. Resposta 200 sempre `{ ok: boolean, ... }`; erro de negócio é `ok:false` com `codigo` e `mensagem`.

- `cardapio` → `{ ok:true, loja:{ nome, slug, link_cardapio, aberta_agora:boolean, modos:string[], pagamentos:{ na_entrega:boolean, pix:boolean }, whatsapp_dono:string|null, bot_habilitado:boolean }, itens:[{ item_id, nome, descricao, preco_centavos, categoria, esgotado, grupos:[{ grupo_id, nome, minimo, maximo, opcoes:[{ opcao_id, nome, preco_adicional_centavos }] }] }] }`
- `rascunho` com `itens:[{item_id, quantidade, opcao_ids, observacao}]` → `{ ok:true, linhas:[{ item_id, nome_item, quantidade, preco_centavos_unitario, opcoes, observacao }], total_centavos }` ou `{ ok:false, codigo:"carrinho_invalido", erros:[{linha,item_id,codigo,mensagem}] }`
- `pedido` com `client_uuid`, `itens`, `cliente_nome`, `cliente_telefone` (só dígitos), `tipo_atendimento:"retirada"|"entrega"`, `entrega?` → cria via `criar_pedido` com método `na_entrega` → `{ ok:true, senha, total_centavos }`. Recusa se `bot_habilitado` falso (`bot_desligado`), loja fechada (`fechado`) ou `pagar_na_entrega_habilitado` falso (`sem_pagar_na_entrega`).
- `pix` com `client_uuid`, `conversa_id` (opaco), `itens`, `cliente_nome`, `cliente_telefone`, `tipo_atendimento:"retirada"` → grava `pagamentos_pendentes`, cria a cobrança no provedor → `{ ok:true, copia_cola, expira_em, total_centavos, pendente_id }`. Recusa com `perfil_obrigatorio`, `sem_pix`, `fechado`, `bot_desligado`. Pix só para Retirada nesta fase.

`barracas.ia_habilitada` é o interruptor do bot (já existe, nasce desligado). Sem o bot ligado a loja continua só com os avisos da fase 1.

---

### Task 1: Migration e núcleo puro da `integracao-v1` (app)

**Files:**
- Create: `supabase/migrations/20261031100000_integracao_v1_bot.sql`
- Create: `supabase/functions/_shared/integracaoV1.ts`
- Test: `tests/integracaoV1.test.ts`, `tests/integracaoV1Migration.test.ts`

**Interfaces:**
- Produces: `validarCorpoIntegracao(corpo: unknown): { ok:true; valor: CorpoIntegracao } | { ok:false }` (valida `barraca_id` uuid, `acao`, `itens` via `montarLinhas` com `maxLinhas: 40`, `client_uuid` uuid, telefone 10–13 dígitos), `verificarAssinaturaLista(segredos: string, timestamp: string|null, assinatura: string|null, corpoBruto: string, agoraMs?: number): Promise<boolean>` (testa cada segredo da lista), `type CorpoIntegracao`.
- Produces (SQL): `integracao_cardapio(p_barraca_id uuid) returns jsonb` (formato do `cardapio` acima, só itens ativos com grupos e opções ativas), `service_role` apenas; coluna `pagamentos_pendentes.conversa_id text` (nullable, opaca).

- [ ] Teste: assinatura válida passa; timestamp fora da janela, assinatura adulterada e segredo vazio falham; com lista de dois segredos qualquer um vale.
- [ ] Teste: corpo com `acao` desconhecida, `barraca_id` inválido e mais de 40 linhas é recusado; `itens` de uma linha válida passa.
- [ ] Teste de migration (lê o `.sql`): `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`, `set search_path`, comentário `-- Rollback:`.
- [ ] Implementar os dois arquivos; aplicar a migration no staging com o MCP do Supabase e conferir `integracao_cardapio` na loja `jmal` (id `cd4ac833-86de-4429-83d9-8b24c7ab23db`).
- [ ] `npm test` e `npx tsc -b` verdes; commit.

### Task 2: Edge function `integracao-v1`, ações `cardapio`, `rascunho` e `pedido` (app)

**Files:**
- Create: `supabase/functions/integracao-v1/index.ts`
- Test: `tests/integracaoV1Funcao.test.ts` (guardas estáticas: assinatura conferida antes de `createClient`, 503 sem segredo, nada de log de corpo)

**Interfaces:**
- Consumes: Task 1 (`validarCorpoIntegracao`, `verificarAssinaturaLista`, `integracao_cardapio`), `_shared/carrinho.ts` (`montarLinhas`, `interpretarResolver`, `respostaDeErros`), `_shared/horario.ts` (`barracaAbertaAgora`), RPCs `resolver_carrinho` e `criar_pedido`.
- Produces: o contrato acima para `cardapio`, `rascunho`, `pedido`.

- [ ] Teste estático: ordem (corpo lido com `req.text()`, assinatura antes do banco), 405/413/503, resposta 401 sem corpo.
- [ ] Implementar a função seguindo o molde de `crm-evento-sessao/index.ts`; `pedido` chama `resolver_carrinho` e depois `criar_pedido` com os `linhas` do resolver, `p_viagem` true, `p_tipo_atendimento` e `p_cliente_telefone`; idempotente por `client_uuid`.
- [ ] Publicar no staging com `--no-verify-jwt`; teste ao vivo com POST assinado (script em `$CLAUDE_JOB_DIR/tmp`, segredo lido do arquivo de staging sem imprimir) na `jmal` com `ia_habilitada` ligado por SQL: cardápio, rascunho com item real, pedido, mesmo `client_uuid` de novo devolve a mesma senha.
- [ ] `npm test`, `npx tsc -b`, `npm run lint` verdes; commit; push.

### Task 3: Ação `pix` (app)

**Files:**
- Modify: `supabase/functions/integracao-v1/index.ts`
- Test: `tests/integracaoV1Pix.test.ts` (funções puras novas em `_shared/integracaoV1.ts`)

**Interfaces:**
- Consumes: Task 2, `_shared/pagamento/{registro,token,expiracao,tipos}.ts`, `urlNotificacaoPagamento`, `buscarTokenDoProvedor`.

- [ ] Teste: loja com `perfil_cliente_obrigatorio` devolve `perfil_obrigatorio`; sem `pagamento_online_habilitado` devolve `sem_pix`; retry do mesmo `client_uuid` devolve o mesmo QR.
- [ ] Implementar: `resolver_carrinho`, insert em `pagamentos_pendentes` (`itens` = linhas, `conversa_id`, `cliente_telefone`, `tipo_atendimento` retirada), `provedor.criarCobranca` com referência = id do pendente. Não duplicar cupom, entrega nem pedido grátis (fora do bot).
- [ ] Teste ao vivo só até a geração da cobrança no staging (sem pagar); webhook não muda.
- [ ] Commit; push.

### Task 4: Ponte do Baileys para o bot (CRM)

**Files (repo `saiae-crm`):**
- Create: `src/modules/bot-pedidos/entrada.ts`, `src/modules/bot-pedidos/entrada.test.ts`
- Modify: `src/modules/whatsapp/instance.ts` (um `bindBotPedidos(sock, sessionId)` ao lado de `bindAgenteSalao`)

**Interfaces:**
- Produces: `bindBotPedidos(sock, sessionId, over?: Partial<DepsEntrada>): void` e `type EntradaBot = { sessionId: string; barracaId: string; jid: string; contactKey: string; nome: string|null; texto: string; messageId: string; timestamp: number }`; chama `deps.tratar(entrada)` (Task 5).

- [ ] Teste (socket falso como em `agente-salao/integracao.test.ts`): ignora grupo, status, `fromMe`, mensagem antiga (`IDADE_MAX_MS`), tipo diferente de `notify`, sessão sem `BarracaSessao`; texto de usuário vira `EntradaBot` com telefone só dígitos (`telefoneDe(jid, key.remoteJidAlt)`).
- [ ] Teste: `fromMe` que não foi enviada pelo CRM (`foiEnviadaPeloCrm` falso) chama `deps.humanoAssumiu(sessionId, contactKey)` para pausar o bot.
- [ ] Implementar seguindo `bindAgenteSalao` (agente.ts:246); não registrar em `WHATSAPP_CLOUD_SESSION_ID`.
- [ ] `npm test` e `npm run typecheck` verdes; commit; push.

### Task 5: Motor do bot (CRM)

**Files:**
- Create: `src/modules/bot-pedidos/{motor,ferramentas,estado,saiae,afirmativo}.ts` e um `.test.ts` por arquivo
- Modify: `src/modules/bot-pedidos/entrada.ts` (liga `tratar`), `src/server/index.ts` (nada além do necessário)

**Interfaces:**
- Consumes: Task 4 (`EntradaBot`), contrato `integracao-v1`, `assinar` de `comanda-contexto.ts`, `getProvider(sessionId).sendText`, `isOptOutText`/`isOptedOut`, `criarChamadorDono` não serve (é template Cloud): usar `sendText` para `whatsapp_dono`.
- Produces: `chamarSaiae(acao, barracaId, corpo, over?): Promise<RespostaSaiae>` (HMAC `WHATSAPP_CONEXAO_SEGREDO`/`COMANDA_WHATSAPP_SEGREDO`, URL `SAIAE_INTEGRACAO_V1_URL`, timeout 8 s, nunca lança, cache de 60 s do `cardapio`), `isAfirmativo(texto: string): boolean`, `tratar(entrada: EntradaBot, over?: Partial<DepsMotor>): Promise<void>`.

Regras do motor:
1. Conversa nova ou "oi": saudação curta + `loja.link_cardapio`. Sem LLM.
2. `bot_habilitado` falso ou erro do Sai aê: só o link (uma vez por dia por cliente), nada mais.
3. Idempotência por `messageId` (mapa em memória) e rate limit 8/min, 60/h por contato; opt-out e pausa para humano calam o bot.
4. LLM (reaproveita `LlmAnthropic`) com ferramentas `ver_cardapio`, `montar_rascunho(itens)` (chama `rascunho` e guarda o hash do resumo vigente), `confirmar_pedido` (código recusa se não há resumo vigente OU se a mensagem atual não é `isAfirmativo`), `chamar_dono(motivo)`. A resposta ao cliente cita preço e total só do retorno do resolver.
5. `chamar_dono`: `sendText` ao `loja.whatsapp_dono` (motivo, uma frase, nome do cliente), pausa a conversa 12 h, cliente recebe link do cardápio.
6. Pagamento: `pagamentos.pix` e `na_entrega` conforme a loja; Pix devolve `copia_cola` ao cliente; fora disso, "pagar na entrega".
7. Consumo: conta conversa em `IaConsumo` com `lojaCodigo = "bot:" + barracaId` e persiste tokens por `onUso`; acima de `BOT_FRANQUIA_CONVERSAS` (padrão 300/mês) o bot volta ao modo só-link.

- [ ] Testes: `isAfirmativo` ("sim", "pode", "confirmo", "s" sim; "não", "sim mas troca", "talvez" não); `confirmar_pedido` recusado sem resumo ou com texto não afirmativo; mesmo `messageId` duas vezes não responde duas vezes; opt-out e pausa calam; loja desligada manda só o link; Pix `perfil_obrigatorio` cai no link; franquia estourada volta ao modo só-link; nenhum log com texto/telefone.
- [ ] Implementar com dependências injetáveis (padrão de `consumer.test.ts`).
- [ ] `npm test` e `npm run typecheck` verdes; commit; push.

### Task 6: Validação ponta a ponta no staging

- [ ] Deploy automático do CRM staging (push) conferido; `ia_habilitada` ligado na `jmal` por SQL; `ANTHROPIC_API_KEY` presente no CRM staging (se faltar, parar e registrar: o João configura).
- [ ] Do WhatsApp de teste, conversar com o número conectado da `jmal`: "oi" → link; pedido por mensagem → resumo → "sim" → pedido criado, aviso "recebido" chega; "sim" repetido não duplica; item inexistente → link; Pix → copia e cola chega (sem pagar).
- [ ] Registrar resultado e falhas em `docs/roteiro-whatsapp-bot.md`; atualizar memória do projeto.

### Fora deste plano

Disparos (fase 3), Google Avaliações, preço do módulo (R$ 69,90 já decidido, cobrança não implementada), Pix para Entrega, cupom pelo bot, pagamento de produção, merge e deploy em produção.
