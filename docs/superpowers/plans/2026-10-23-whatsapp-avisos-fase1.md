# WhatsApp e Automação — Fase 1 (lado Sai aê) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono conecta o WhatsApp da loja por QR Code numa aba de Ajustes, configura os cinco avisos de status do pedido (recebido, pronto, saiu para entrega, entregue, cancelado) e vê o histórico, com o envio feito pelo CRM via Baileys.

**Architecture:** O Sai aê guarda a configuração dos avisos em `barracas.whatsapp_avisos` e a inclui, de forma aditiva, no `data` dos eventos `order.*` que o outbox já envia ao CRM. A aba fala com o CRM por uma edge function proxy (`whatsapp-conexao`, JWT do dono → HMAC de plataforma → uma única rota do CRM). O CRM avisa quedas por outra edge function (`crm-evento-sessao`). Tudo atrás da flag de visibilidade que já esconde "Atendente IA"/"Integração com o CRM".

**Tech Stack:** React 19 + Vite + TypeScript, Supabase (Postgres, RLS, RPC SECURITY DEFINER), edge functions Deno, `node --test` (com PGlite para migrations), `qrcode-generator` (já é dependência).

**Spec:** `docs/superpowers/specs/2026-10-23-whatsapp-automacao-design.md` (fase 1, §5). Pendências do CRM (Gael): `PENDENCIAS-CRM-GAEL.md`, itens 1 a 13. Este plano só cobre o Sai aê e o contrato entre os dois lados.

## Global Constraints

- Cinco avisos, chaves `recebido`, `pronto`, `saiu_entrega`, `entregue`, `cancelado`. Não existe "em preparo".
- Variáveis de texto: `{nome}`, `{senha}`, `{barraca}`; variável sem valor some da frase (reaproveitar `montarMensagemPronto` de `src/lib/avisoPronto.ts`).
- Validade de aviso atrasado (documentada no contrato, aplicada no CRM): `recebido` 30 min; `pronto`, `saiu_entrega`, `entregue` 15 min; `cancelado` 60 min.
- Aviso é transacional: não depende de `consentimento_contato`. Descadastro ("SAIR") sempre respeitado (no CRM).
- Contrato v1 só recebe mudanças **aditivas**. Segredos nunca em repositório, log ou navegador.
- Rotas assinadas: `X-Saiae-Timestamp` em segundos, janela de 5 min, `X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, timestamp + "." + corpo bruto)`, comparação em tempo constante, resposta idêntica em qualquer falha de autenticação.
- Segredo de plataforma novo: `WHATSAPP_CONEXAO_SEGREDO` (Sai aê) = `COMANDA_WHATSAPP_SEGREDO` (CRM), mínimo 16 caracteres. URL do CRM no Sai aê: `CRM_WHATSAPP_CONEXAO_URL` (https público, validada por `urlPermitida`).
- Logs sem telefone, nome, itens nem texto de mensagem.
- Migrations: arquivo novo em `supabase/migrations/`, com bloco `Rollback:` no topo (convenção dos testes de migration), nunca editar migration já aplicada.
- A seção nova fica escondida para todas as lojas, exceto as da lista `SLUGS_COM_IA_E_CRM` ou com `VITE_MOSTRAR_WHATSAPP_AUTOMACAO=1`.
- Testes: `npm test` (`node --test "tests/*.test.ts"`). Antes de entregar: `npm run lint` e `npm run build`.

## Review Focus

1. Config de avisos com chave desconhecida, `ativo` não booleano ou texto gigante chegando à RPC: recusar com `dados_invalidos`, nada gravado (Task 3).
2. Barraca sem config (`whatsapp_avisos` nulo, todas as lojas hoje): evento sai exatamente como antes, sem `avisos` (Task 3).
3. Dono de outra loja chamando `whatsapp-conexao` com o `barraca_id` alheio: 403 sem revelar se a loja existe (Task 4).
4. CRM fora do ar, lento ou respondendo fora do formato: 502 genérico, nunca o erro cru nem o segredo (Task 4).
5. Evento de queda com assinatura inválida, timestamp velho, barraca desconhecida ou `occurred_at` mais antigo que o estado gravado: recusado ou ignorado, estado não regride (Task 5).
6. Texto de aviso só com espaços, só com variáveis vazias, ou com mais de 500 caracteres: cai no texto padrão (Task 2).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `docs/contrato/v1/whatsapp-conexao.md` (novo) | Contrato da rota do CRM, do evento de queda e do campo `avisos` (fonte para o Gael) |
| `docs/contrato/v1/evento.schema.json` (alterar) | Campo opcional `data.avisos` |
| `docs/contrato/v1/exemplos/pedido-com-avisos.json` (novo) | Exemplo validado contra o schema |
| `src/lib/avisosWhatsapp.ts` (novo) | Tipos, textos padrão, normalização e renderização dos cinco avisos |
| `supabase/migrations/20261030100000_whatsapp_avisos.sql` (novo) | Coluna, RPC de salvar, `avisos` no evento |
| `supabase/migrations/20261030110000_whatsapp_status.sql` (novo) | Colunas de status da conexão e RPC de gravar |
| `supabase/functions/_shared/crmConexao.ts` (novo) | Chamada assinada ao CRM e normalização da resposta |
| `supabase/functions/whatsapp-conexao/index.ts` (novo) | Proxy autenticado por JWT do dono |
| `supabase/functions/crm-evento-sessao/index.ts` (novo) | Recebe queda/reconexão do CRM |
| `src/lib/estadoWhatsapp.ts` (novo) | Estado da tela a partir da resposta do proxy |
| `src/hooks/useWhatsappConexao.ts` (novo) | Polling do estado e ações |
| `src/components/SecaoWhatsappAutomacao.tsx` (novo) | A aba |
| `src/components/FaixaWhatsappCaiu.tsx` (novo) | Faixa de aviso de queda |
| `src/lib/visibilidadeIaCrm.ts`, `src/pages/Ajustes.tsx`, `src/components/LayoutBarraca.tsx`, `src/types/database.ts` (alterar) | Flag, montagem da seção, faixa, tipos |
| `docs/roteiro-whatsapp-avisos.md` (novo) | Roteiro de teste ponta a ponta em staging e ordem de deploy |

---

### Task 1: Contrato entre Sai aê e CRM

**Files:**
- Create: `docs/contrato/v1/whatsapp-conexao.md`, `docs/contrato/v1/exemplos/pedido-com-avisos.json`
- Modify: `docs/contrato/v1/evento.schema.json`
- Test: `tests/contratoAvisos.test.ts`

**Interfaces:**
- Produces: formato de `data.avisos`, da rota do CRM e do evento de queda (usados por Tasks 3, 4, 5 e pelo Gael).

- [ ] **Step 1: Escrever o teste que falha.** `tests/contratoAvisos.test.ts` lê `evento.schema.json` e o exemplo `pedido-com-avisos.json` e valida com o mesmo mecanismo dos testes de contrato existentes (conferir como `tests/` já valida `exemplos/pedido-itens-com-opcoes.json`; usar a mesma biblioteca/abordagem). Assertivas: exemplo com `data.avisos` válido passa; `avisos.pronto.texto` com 501 caracteres falha; chave `em_preparo` falha; exemplo sem `avisos` continua passando.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/contratoAvisos.test.ts` → FAIL (exemplo/regras inexistentes).
- [ ] **Step 3: Alterar o schema.** Em `data` de `order.*`, propriedade opcional `avisos`: objeto com `additionalProperties: false` e as cinco chaves, cada uma `{ "ativo": boolean, "texto": string|null (maxLength 500) }`. Criar o exemplo.
- [ ] **Step 4: Escrever `whatsapp-conexao.md`** com: (a) rota única do CRM `POST /api/integracao/comanda/v1/whatsapp-conexao`, corpo `{ barraca_id, acao, request_id }`, `acao` ∈ `iniciar | status | desconectar | historico`; resposta `{ estado: "sem_sessao"|"aguardando_qr"|"conectado"|"desconectado", qr: string|null, numero: string|null, avisos: [{ pedido_id, tipo, estado, motivo, em }] }` (`qr` é o texto bruto do QR, `numero` só dígitos, `avisos` só em `historico`, máximo 20); estados do aviso `pendente|enviado|falhou|pulado_sem_telefone|pulado_optout|pulado_desconectado`; erros 401 (igual em toda falha de autenticação), 422, 429, 503; (b) evento de queda CRM → Sai aê `POST {SUPABASE}/functions/v1/crm-evento-sessao`, corpo `{ barraca_id, estado: "conectado"|"desconectado"|"caiu", occurred_at, request_id }`; (c) o campo `data.avisos` e seu uso pelo CRM (ausente = texto padrão e aviso ativo); (d) tabela de validade por aviso (Global Constraints); (e) o segredo de plataforma e as URLs.
- [ ] **Step 5: Rodar e ver passar.** `node --test tests/contratoAvisos.test.ts` → PASS.
- [ ] **Step 6: Commit** `docs: contrato v1 de avisos e conexão WhatsApp`.

---

### Task 2: Biblioteca dos avisos

**Files:**
- Create: `src/lib/avisosWhatsapp.ts`
- Test: `tests/avisosWhatsapp.test.ts`

**Interfaces:**
- Consumes: `montarMensagemPronto(modelo, { nome, senha, barraca })` de `src/lib/avisoPronto.ts`.
- Produces:
  - `type AvisoTipo = 'recebido' | 'pronto' | 'saiu_entrega' | 'entregue' | 'cancelado'`
  - `const AVISO_TIPOS: readonly AvisoTipo[]` (nessa ordem)
  - `type AvisoConfig = { ativo: boolean; texto: string | null }`
  - `type AvisosConfig = Record<AvisoTipo, AvisoConfig>`
  - `const AVISOS_PADRAO: Record<AvisoTipo, { ativo: true; texto: string }>`
  - `const MAX_TEXTO_AVISO = 500`
  - `normalizarAvisos(bruto: unknown): AvisosConfig` (aceita `null`/lixo, devolve as cinco chaves)
  - `textoDoAviso(tipo: AvisoTipo, config: AvisosConfig, valores: { nome?: string | null; senha: number | string | null; barraca: string }): string`

- [ ] **Step 1: Testes que falham.** Casos (nome → asserção): `padrao_para_null` (`normalizarAvisos(null)` tem as 5 chaves, `ativo: true`, `texto: null`); `descarta_chave_desconhecida` (`em_preparo` some); `texto_so_espacos_vira_null`; `texto_acima_de_500_vira_null`; `textoDoAviso` com `texto: null` usa `AVISOS_PADRAO` e preenche `{nome}`/`{senha}`/`{barraca}` (ex.: nome "Maria Silva" → "Maria", senha 42 → "#42"); `variavel_sem_valor_some` (sem nome: "Olá!" sem espaço sobrando); cada um dos cinco padrões contém `{senha}` ou `{barraca}` e nenhum menciona "em preparo".
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/avisosWhatsapp.test.ts` → FAIL.
- [ ] **Step 3: Implementar** as assinaturas acima em `src/lib/avisosWhatsapp.ts`. Textos padrão em português, curtos e informais, no estilo de `MSG_PRONTO_PADRAO`. `textoDoAviso` renderiza com `montarMensagemPronto`.
- [ ] **Step 4: Rodar e ver passar.** `node --test tests/avisosWhatsapp.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: textos e normalização dos avisos de WhatsApp`.

---

### Task 3: Migration da configuração e `avisos` no evento

**Files:**
- Create: `supabase/migrations/20261030100000_whatsapp_avisos.sql`
- Test: `tests/whatsappAvisosMigration.test.ts` (modelo: `tests/comandaAbertaMigration.test.ts`, PGlite)

**Interfaces:**
- Consumes: `usuario_tem_acesso_barraca(uuid)`; `montar_evento_saida(uuid)` atual de `20261016110000_eventos_saida.sql` (e qualquer migration posterior que o tenha redefinido: **conferir com `grep -l montar_evento_saida supabase/migrations/*` e partir da definição mais recente**).
- Produces: `barracas.whatsapp_avisos jsonb null`; `whatsapp_avisos_salvar(p_barraca_id uuid, p_avisos jsonb) returns jsonb` com `{ estado: 'ok' | 'nao_autenticado' | 'sem_acesso' | 'dados_invalidos' }`; `data.avisos` nos eventos `order.*` quando a coluna não é nula.

- [ ] **Step 1: Testes que falham** (texto + PGlite, como o modelo): `Rollback:` no topo; coluna `whatsapp_avisos jsonb` nula por padrão com check `jsonb_typeof(...) = 'object'`; RPC: dono salva config válida → `ok` e `select` devolve igual; outra loja → `sem_acesso`; sem login → `nao_autenticado`; chave `em_preparo`, `ativo: "sim"` e texto de 501 caracteres → `dados_invalidos` e coluna inalterada; anon sem execute; `montar_evento_saida` de uma barraca **sem** config devolve `data` sem a chave `avisos` (igual ao resultado antes da migration); com config devolve `data.avisos` idêntico à coluna; evento `customer.*` nunca leva `avisos`.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/whatsappAvisosMigration.test.ts` → FAIL.
- [ ] **Step 3: Escrever a migration.** Coluna + check; RPC `security definer`, `set search_path = public, pg_temp`, `revoke ... from public, anon`, `grant execute ... to authenticated`, validação das chaves/tipos/tamanho; `create or replace function montar_evento_saida` = a definição vigente + `'avisos'` dentro de `data` só para tipos `order.*` e só se `b.whatsapp_avisos is not null`. Não tocar em mais nada da função.
- [ ] **Step 4: Rodar e ver passar.** `node --test tests/whatsappAvisosMigration.test.ts` → PASS; depois `npm test` inteiro (os testes de migrations antigas, em especial os do outbox, não podem quebrar).
- [ ] **Step 5: Commit** `feat: configuração dos avisos de WhatsApp e campo avisos no evento`.

---

### Task 4: Proxy `whatsapp-conexao`

**Files:**
- Create: `supabase/functions/_shared/crmConexao.ts`, `supabase/functions/whatsapp-conexao/index.ts`
- Test: `tests/crmConexao.test.ts` (modelo: `tests/codigoCrm.test.ts`)

**Interfaces:**
- Consumes: `cabecalhosDoEvento(segredo, eventoId, timestamp, corpo)` e `urlPermitida(url)` de `_shared/eventosSaida.ts`.
- Produces:
  - `type AcaoConexao = 'iniciar' | 'status' | 'desconectar' | 'historico'`
  - `type EstadoConexao = { estado: 'sem_sessao'|'aguardando_qr'|'conectado'|'desconectado'; qr: string | null; numero: string | null; avisos: AvisoHistorico[] }`
  - `chamarConexaoCrm(a: { url: string; segredo: string; barracaId: string; acao: AcaoConexao; requestId: string }, fetchFn?: typeof fetch): Promise<{ ok: true; dados: EstadoConexao } | { ok: false; motivo: string }>`
  - Edge function: `POST` com JWT, corpo `{ barraca_id, acao }`; respostas 200 `{ ok: true, ...EstadoConexao }`, 400, 401, 403, 502 `{ erro: 'Conexão indisponível' }`.

- [ ] **Step 1: Testes que falham** em `tests/crmConexao.test.ts`: corpo assinado no padrão do contrato (cabeçalhos e HMAC recalculado no teste); URL `http://` ou IP privado → `ok: false` sem chamar a rede; status 401/422/503 do CRM → `ok: false`; resposta com `estado` desconhecido ou `qr` que não é string → `ok: false`; `numero` com letras → `ok: false`; erro de rede e timeout (10 s) → `ok: false`; `motivo` nunca contém o segredo nem o corpo; `avisos` truncado em 20 itens; `redirect: 'manual'`.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/crmConexao.test.ts` → FAIL.
- [ ] **Step 3: Implementar `crmConexao.ts`** com o formato de `codigoCrm.ts` e validação estrita da resposta.
- [ ] **Step 4: Implementar a edge function** no formato de `ia-consumo/index.ts`: valida o JWT, valida `barraca_id` (UUID), confere `usuarios_barracas` (qualquer papel da loja, como o `ia-consumo`; **ação `desconectar` e `iniciar` exigem `papel = 'dono'`**, decisão minha), 403 genérico sem vínculo, lê `CRM_WHATSAPP_CONEXAO_URL` e `WHATSAPP_CONEXAO_SEGREDO`, chama `chamarConexaoCrm`, loga só "conexão indisponível". Ação `status` com `estado = 'conectado'` nunca devolve `qr`.
- [ ] **Step 5: Teste da regra de acesso** (função pura extraída, ex. `podeExecutar(acao, papel)` em `crmConexao.ts`): `suporte` e `operador` só `status`/`historico`; `dono` todas.
- [ ] **Step 6: Rodar e ver passar.** `node --test tests/crmConexao.test.ts` → PASS.
- [ ] **Step 7: Commit** `feat: proxy assinado de conexão do WhatsApp com o CRM`.

---

### Task 5: Queda da conexão (CRM → Sai aê)

**Files:**
- Create: `supabase/migrations/20261030110000_whatsapp_status.sql`, `supabase/functions/crm-evento-sessao/index.ts`, `supabase/functions/_shared/crmSessaoEvento.ts`
- Test: `tests/whatsappStatusMigration.test.ts`, `tests/crmSessaoEvento.test.ts`

**Interfaces:**
- Consumes: formato do contrato (Task 1); verificação HMAC no estilo de `_shared/iaAssinatura.ts` (**ler esse arquivo e reaproveitar a verificação em vez de reescrever**).
- Produces: `barracas.whatsapp_status text null check in ('conectado','desconectado','caiu')`, `barracas.whatsapp_status_em timestamptz null`; RPC `whatsapp_status_gravar(p_barraca_id uuid, p_estado text, p_em timestamptz) returns text` (`'ok' | 'ignorado'`, só `service_role`); `validarEventoSessao(corpo: unknown): { ok: true; evento: EventoSessao } | { ok: false }`.

- [ ] **Step 1: Testes que falham.** Migration (PGlite): `Rollback:` no topo; RPC grava `caiu`; `p_em` mais antigo que `whatsapp_status_em` → `ignorado` e estado inalterado; estado fora da lista → erro; `authenticated`/`anon` sem execute. Função: assinatura válida aceita; assinatura trocada, timestamp > 5 min, `barraca_id` que não é UUID, `estado` desconhecido e corpo > 4 KB → recusados com a mesma resposta 401/422 do contrato; `request_id` repetido → 200 sem regravar.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/whatsappStatusMigration.test.ts tests/crmSessaoEvento.test.ts` → FAIL.
- [ ] **Step 3: Implementar** migration, `validarEventoSessao` e a edge function (`--no-verify-jwt`, secret `WHATSAPP_CONEXAO_SEGREDO`, 503 se ausente ou com menos de 16 caracteres, nunca aceita sem segredo). Barraca inexistente: 200 igual ao sucesso (não revela se existe) e nada gravado.
- [ ] **Step 4: Rodar e ver passar** os dois arquivos → PASS.
- [ ] **Step 5: Commit** `feat: estado da conexão do WhatsApp avisado pelo CRM`.

---

### Task 6: A aba "WhatsApp e Automação"

**Files:**
- Create: `src/lib/estadoWhatsapp.ts`, `src/hooks/useWhatsappConexao.ts`, `src/components/SecaoWhatsappAutomacao.tsx`
- Modify: `src/lib/visibilidadeIaCrm.ts`, `src/pages/Ajustes.tsx` (junto de `SecaoIntegracaoCrm`, ~linha 2993), `src/types/database.ts`
- Test: `tests/estadoWhatsapp.test.ts`, `tests/visibilidadeWhatsapp.test.ts`

**Interfaces:**
- Consumes: `AvisosConfig`/`normalizarAvisos`/`textoDoAviso` (Task 2); RPC `whatsapp_avisos_salvar` (Task 3); edge function `whatsapp-conexao` (Task 4); `useRascunho`/`useSalvarBarraca`/`BotaoSalvarCampo` como em `SecaoAvisoPronto.tsx`.
- Produces:
  - `mostrarWhatsappAutomacao(barraca: { slug?: string | null }, flag: unknown): boolean`
  - `telaDaConexao(r: EstadoConexao | null, erro: boolean): { tipo: 'carregando'|'erro'|'sem_sessao'|'qr'|'conectado'|'desconectado'; qr?: string; numeroMascarado?: string }`
  - `mascararNumero(digitos: string): string` (ex.: `5561999990001` → `(61) 9••••-0001`)
  - `useWhatsappConexao(barracaId: string): { tela; iniciar(): Promise<void>; desconectar(): Promise<void>; recarregar(): void }` com polling de 3 s em `aguardando_qr` e 15 s nos demais estados, parado com a aba escondida.

- [ ] **Step 1: Testes que falham.** `telaDaConexao` para cada estado e para `null`/erro; `qr` só aparece em `aguardando_qr`; `mascararNumero` nunca devolve o número completo; `mostrarWhatsappAutomacao` verdadeiro para `qa-teste-varredura` e para `flag === '1'`, falso para outra loja.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/estadoWhatsapp.test.ts tests/visibilidadeWhatsapp.test.ts` → FAIL.
- [ ] **Step 3: Implementar as funções puras e a flag** (`VITE_MOSTRAR_WHATSAPP_AUTOMACAO`, mesma lista `SLUGS_COM_IA_E_CRM`).
- [ ] **Step 4: Implementar o hook e a seção.** Desconectado: botão "Conectar WhatsApp" → `iniciar`, depois o QR renderizado com `qrcode-generator`, os 3 passos ("Aparelhos conectados → Conectar aparelho") e o aviso de risco do Baileys em linguagem simples. Conectado: número mascarado, "Desconectar" (com confirmação), cinco linhas (`Toggle` + `Textarea` + prévia com `textoDoAviso`), salvando por botão via `whatsapp_avisos_salvar` (padrão `BotaoSalvarCampo`, erro real na tela), e o histórico dos últimos 20 avisos com estado em português. Sem acesso ao CRM: mensagem de erro e botão "Tentar de novo". Mobile primeiro, alvos de toque de 44 px como nas outras seções.
- [ ] **Step 5: Tipos.** Acrescentar `whatsapp_avisos`, `whatsapp_status`, `whatsapp_status_em` em `Barraca` (`src/types/database.ts`).
- [ ] **Step 6: Montar em `Ajustes.tsx`** atrás de `mostrarWhatsappAutomacao`, só com Supabase configurado (mesmo padrão de `semBanco`).
- [ ] **Step 7: Verificar.** `npm test`, `npm run lint`, `npm run build` → todos passam.
- [ ] **Step 8: Commit** `feat: aba WhatsApp e Automação em Ajustes`.

---

### Task 7: Faixa de queda

**Files:**
- Create: `src/components/FaixaWhatsappCaiu.tsx`
- Modify: `src/components/LayoutBarraca.tsx` (ao lado de `FaixaSuporte`)
- Test: `tests/faixaWhatsapp.test.ts`

**Interfaces:**
- Consumes: `barraca.whatsapp_status`, `whatsapp_status_em` (Task 5); `mostrarWhatsappAutomacao` (Task 6).
- Produces: `deveMostrarFaixaCaiu(barraca: Pick<Barraca, 'slug' | 'whatsapp_status'>, flag: unknown): boolean`

- [ ] **Step 1: Teste que falha:** `caiu` + loja liberada → true; `conectado`, `desconectado`, `null` → false; loja não liberada → false.
- [ ] **Step 2: Rodar e ver falhar** → FAIL.
- [ ] **Step 3: Implementar** a função e a faixa: texto "O WhatsApp da loja desconectou. Os avisos automáticos estão parados. Reconecte em Ajustes.", botão que leva à aba. A faixa não bloqueia nenhuma tela do operador.
- [ ] **Step 4: Rodar e ver passar** → PASS; `npm run build` passa.
- [ ] **Step 5: Commit** `feat: faixa de aviso quando o WhatsApp da loja cai`.

---

### Task 8: Roteiro de teste e ordem de deploy

**Files:**
- Create: `docs/roteiro-whatsapp-avisos.md`
- Modify: `CLAUDE.md` (uma entrada em "Regras de produto", no estilo das demais, com a ordem de deploy)

- [ ] **Step 1: Escrever o roteiro** para a loja `qa-teste-varredura` em staging, cada passo com resultado esperado: conectar por QR; os cinco avisos chegam, **um de cada, uma vez só**, ao percorrer `a_fazer → pronto → saiu_entrega → entregue` e ao cancelar outro pedido; pedido sem telefone não envia; editar o texto e ver o novo texto no próximo aviso; desligar um aviso; reiniciar o CRM no meio e confirmar que não repete; derrubar a conexão e ver a faixa e o aviso `pulado_desconectado`; "SAIR" para o aviso seguinte; segunda loja de teste não enxerga QR, número nem histórico da primeira; pedido de balcão nascido `entregue` não avisa "entregue".
- [ ] **Step 2: Ordem de deploy** (no roteiro e no `CLAUDE.md`): (1) CRM do Gael com a rota `whatsapp-conexao`, o mapeamento e as tabelas de log, e o segredo `COMANDA_WHATSAPP_SEGREDO`; (2) migrations `20261030100000` e `20261030110000`; (3) secrets `WHATSAPP_CONEXAO_SEGREDO` e `CRM_WHATSAPP_CONEXAO_URL`; (4) deploy das functions `whatsapp-conexao` e `crm-evento-sessao`; (5) app. A seção continua escondida até o João liberar lojas.
- [ ] **Step 3: Commit** `docs: roteiro e ordem de deploy dos avisos de WhatsApp`.

---

## Self-review

- **Cobertura da spec (§5):** 5.1 aba → Task 6; 5.2 mapeamento sessão↔loja → CRM (Gael itens 1-2), contrato na Task 1; 5.3 canal Baileys → CRM (item 6); 5.4 eventos → CRM, `data.avisos` na Task 3; 5.5 idempotência/log → CRM (itens 5, 7), histórico exibido na Task 6; 5.6 textos → Tasks 2, 3, 6; 5.7 regras de envio → CRM (item 12), aviso de risco na Task 6; 5.8 opt-out → CRM (item 13); 5.9 segurança → Tasks 4, 5. Queda → Tasks 5 e 7.
- **Fora deste plano:** tudo o que roda no CRM (lista em `PENDENCIAS-CRM-GAEL.md`, itens 1-13). Fases 2 e 3.
- **Consistência de nomes:** `AvisoTipo`, `AvisosConfig`, `EstadoConexao`, `AcaoConexao`, `whatsapp_avisos`, `whatsapp_status`, `WHATSAPP_CONEXAO_SEGREDO` usados com o mesmo nome em todas as tasks.
- **Pontos a conferir na execução (não verificados na leitura):** a definição vigente de `montar_evento_saida` (pode ter sido redefinida depois de `20261016110000`); como `tests/` valida exemplos contra o schema; o papel exato devolvido por `usuarios_barracas` para "suporte"/"operador".
- **Decisões minhas neste plano:** rota única no CRM; segredo de plataforma e não por loja; `iniciar`/`desconectar` só para o dono; todos os avisos ativos por padrão (a aba inteira já fica escondida e depende de conexão ativa); flag de visibilidade reaproveitando a lista de lojas liberadas.
