# Comanda aberta na Mesa, taxa de serviço e nomes dos tipos de pedido: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os nomes confusos dos tipos de pedido e permitir que a Mesa funcione com comanda aberta (vários lançamentos pelo celular do garçom, pago no fechamento), com taxa de serviço opcional e um interruptor por restaurante para incluir as taxas na NFC-e.

**Architecture:** Cada rodada continua sendo um `pedidos` (com senha, cozinha e estoque como hoje), nascido com `metodo_pagamento = 'na_entrega'` ("A receber"). Uma tabela nova `comandas` agrupa as rodadas de uma mesa; um trigger no banco liga cada pedido de Mesa à comanda aberta da mesa (cria se não existe), então `criar_pedido`, a fila offline e a idempotência por `client_uuid` não mudam. Fechar a comanda é uma RPC que define a forma de pagamento em todas as rodadas e grava a taxa de serviço; a regra "a receber não entra em forma de pagamento" já existe e é reaproveitada.

**Tech Stack:** React + Vite + TypeScript, Tailwind v4, Supabase (Postgres, RLS, Edge Functions), testes `node --test tests/*.test.ts`.

**Spec:** `docs/superpowers/specs/2026-10-23-comanda-aberta-mesa-design.md` (lê junto: `2026-10-08-pagar-depois-e-dividido-design.md`, que o plano reaproveita).

## Global Constraints

- Tudo atrás de interruptor por barraca, **desligado por padrão**; desligado, o app é exatamente o de hoje (exceto os nomes novos dos tipos).
- Migrations **aditivas**, aplicadas antes do deploy do app (nome `AAAAMMDDHHMMSS_*.sql`, depois de `20261025100000`); cada uma com comentário de rollback no topo, como `20261019170000_pagamento_depois.sql`.
- Lançar pedido e cozinha funcionam **offline**; enviar pedido é **idempotente**; nada bloqueia esperando rede.
- Áreas de toque de no mínimo 44px; sem cor nova fora de `src/styles/tokens.css`; textos em português.
- Multi-tenant: toda tabela nova tem `barraca_id`; RLS por `public.usuario_tem_acesso_barraca(barraca_id)`; RPC `security definer` com `set search_path = public, pg_temp`, `revoke ... from public, anon`, `grant execute ... to authenticated`.
- Item removido de comanda ativa é remoção lógica, nunca DELETE.
- Taxa de serviço aparece **à parte**, nunca somada ao faturamento dos itens. Padrão 10% (`1000` bps), editável; só no fechamento de comanda aberta da Mesa.
- O app só **registra** a forma de pagamento (não processa cartão). Um acesso só: nenhum login, papel ou área de garçom.
- Rótulo "Retirada" vira "Para viagem" só para o operador; o valor interno `retirada` e o cardápio público (cliente) não mudam.
- Testes: lógica pura em `tests/*.test.ts` (import com extensão `.ts`); migrations testadas como texto SQL (mesmo padrão de `tests/acessoSuporteMigration.test.ts`). Rodar com `node --test tests/<arquivo>`; no fim, `npm test`, `npm run build` e `npm run lint`.
- Mensagens de commit em português, redação normal, terminando com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Trabalhar na branch `feat/comanda-aberta-mesa`.

## Review Focus

1. Mesa digitada de formas diferentes ("5", "05", "Mesa 5", "mesa  5") cai na **mesma** comanda; "5" e "15" não.
2. Reenvio da fila ou duplo toque numa rodada não duplica o pedido; duas primeiras rodadas da mesma mesa ao mesmo tempo criam **uma** comanda só.
3. Fechar comanda: já fechada (mesmo método = ok, outro método = recusa), sem nenhuma rodada ativa, rodada cancelada no meio, forma inválida.
4. Taxa: desmarcada = 0; 0% ; arredondamento ao centavo; fechamento recalcula no servidor e nunca confia no valor do cliente; relatório não soma a taxa ao faturamento dos itens.
5. Restaurante liga a opção com pedidos de Mesa avulsos já pagos (não mexe neles) ou desliga com comandas abertas (continuam visíveis e fecháveis).

---

## Fase A: nomes dos tipos (entrega independente, menor risco)

### Task 1: Nomes, ajuda e aviso da cozinha

**Files:**
- Modify: `src/lib/atendimento.ts` (`ROTULO_MODO`, `DESCRICAO_MODO`, `faixaImpressao`; funções novas)
- Modify: `src/pages/CardapioPublico.tsx:571,1653,1656` (usar rótulo do cliente)
- Modify: `src/pages/LancarPedido.tsx:1150` (seletor com ajuda) e a área do seletor para o aviso
- Modify: `src/components/SeletorModos.tsx` (já usa `DESCRICAO_MODO`; só conferir)
- Test: `tests/nomesTiposPedido.test.ts` (criar); ajustar testes existentes que citam "Retirada"/`*** RETIRADA ***` (`grep -rn "RETIRADA\|Retirada" tests`)

**Interfaces:**
- Produces (em `src/lib/atendimento.ts`):
  - `ROTULO_MODO.retirada === 'Para viagem'`; `DESCRICAO_MODO.retirada === 'O cliente leva embalado'`
  - `export const ROTULO_MODO_CARDAPIO: Record<'retirada' | 'entrega', string>` = `{ retirada: 'Retirada', entrega: 'Entrega' }`
  - `export function ajudaDoModo(tipo: TipoAtendimento, barraca: { comanda_aberta_habilitada?: boolean; pagamento_depois_habilitado?: boolean } | null): string`
  - `export function avisoCozinha(tipo: TipoAtendimento): string`

- [ ] **Step 1: Escrever os testes que falham** em `tests/nomesTiposPedido.test.ts`:
  - `ROTULO_MODO.retirada` é `'Para viagem'` e `ROTULO_MODO_CARDAPIO.retirada` é `'Retirada'`.
  - `ajudaDoModo('mesa', {comanda_aberta_habilitada:true})` === `'Comer aqui · conta aberta, paga no fim'`; `ajudaDoModo('mesa', null)` === `'Comer aqui · paga agora'`; `ajudaDoModo('balcao', null)` === `'Comer aqui · paga agora'`; `ajudaDoModo('retirada', null)` === `'Embalado · paga agora'`; `ajudaDoModo('retirada', {pagamento_depois_habilitado:true})` === `'Embalado · paga agora ou depois'`; `ajudaDoModo('entrega', null)` === `'Embalado + endereço · paga agora'`.
  - `avisoCozinha('retirada')` === `'Cozinha vai receber: PARA VIAGEM (embalar)'`; `'mesa'` → `'Cozinha vai receber: MESA (comer aqui)'`; `'balcao'` → `'...BALCÃO (comer aqui)'`; `'entrega'` → `'...ENTREGA (embalar)'`.
  - `faixaImpressao('retirada', {colunasFaixa: 24})` === `'*** PARA VIAGEM ***'`; com `colunasFaixa: 16` === `'PARA VIAGEM'` (19 colunas não cabem, perde os asteriscos como a Mesa já faz).
- [ ] **Step 2:** `node --test tests/nomesTiposPedido.test.ts` → FAIL.
- [ ] **Step 3: Implementar** em `atendimento.ts` as constantes e funções acima; em `faixaImpressao`, aplicar à Retirada a mesma regra de largura da Mesa (com estrelas, sem estrelas, truncada). Em `CardapioPublico.tsx`, trocar `ROTULO_MODO[...]` por `ROTULO_MODO_CARDAPIO[...]`. Em `LancarPedido.tsx`, mostrar `ajudaDoModo(...)` abaixo do rótulo de cada modo do seletor e `avisoCozinha(tipoEfetivo)` como linha de apoio do tipo escolhido (um só modo ativo: mostra só o aviso).
- [ ] **Step 4:** corrigir os testes antigos afetados e rodar `npm test`; esperado: tudo passa.
- [ ] **Step 5: Commit** (`feat: renomeia Retirada para Para viagem e explica cada tipo de pedido`).

---

## Fase B: comanda aberta (atrás de `comanda_aberta_habilitada`)

### Task 2: Banco: interruptores, comandas e trigger

**Files:**
- Create: `supabase/migrations/20261026100000_comanda_aberta.sql`
- Modify: `src/types/database.ts` (`Barraca`, `Pedido`, novo `Comanda`)
- Test: `tests/comandaAbertaMigration.test.ts`

**Interfaces:**
- Produces (SQL):
  - `barracas.comanda_aberta_habilitada boolean not null default false`, `barracas.taxa_servico_habilitada boolean not null default false`, `barracas.taxa_servico_bps integer not null default 1000 check (taxa_servico_bps between 0 and 3000)`
  - `public.normalizar_mesa(p_texto text) returns text` (imutável): minúsculo, sem acento, tira o prefixo "mesa", colapsa espaços, tira zeros à esquerda ("05" → "5"), `''` se vazio (mesmo estilo de `normalizar_bairro`)
  - tabela `public.comandas(id uuid pk, barraca_id uuid not null, mesa text not null, mesa_normalizada text not null, status text not null default 'aberta' check (status in ('aberta','fechada')), aberta_em timestamptz not null default now(), fechada_em timestamptz, fechada_por uuid, metodo_pagamento text, taxa_servico_bps integer, taxa_servico_centavos integer not null default 0)`; índice único parcial `(barraca_id, mesa_normalizada) where status = 'aberta'`; RLS select por `usuario_tem_acesso_barraca`, sem insert/update/delete direto (só trigger e RPC)
  - `pedidos.comanda_id uuid references comandas(id)` + índice
  - trigger `pedidos_atribuir_comanda` BEFORE INSERT em `pedidos` (função `security definer`): se `new.tipo_atendimento = 'mesa'`, `normalizar_mesa(new.mesa) <> ''`, `new.metodo_pagamento = 'na_entrega'` e a barraca tem `comanda_aberta_habilitada`, preenche `new.comanda_id` com a comanda aberta da mesa; se não existe, `insert ... on conflict do nothing` e relê (corrida entre dois primeiros lançamentos). Caso contrário não mexe em nada.
  - `comandas` entra na publicação Realtime do mesmo jeito que `pedidos` (copiar o padrão da migration que publica `pedidos`).
- Consumes: `usuario_tem_acesso_barraca(uuid)`, trigger/colunas de `pedidos` existentes.

- [ ] **Step 1: Escrever `tests/comandaAbertaMigration.test.ts`** lendo o SQL como texto e afirmando: as 3 colunas de `barracas` com os defaults acima; `create unique index ... (barraca_id, mesa_normalizada) where status = 'aberta'`; `enable row level security` em `comandas`; presença de `pedidos_atribuir_comanda`, `security definer`, `on conflict do nothing`, `normalizar_mesa`; comentário `Rollback:` no topo.
- [ ] **Step 2:** rodar o teste → FAIL.
- [ ] **Step 3: Escrever a migration** e os tipos (`Barraca.comanda_aberta_habilitada?`, `taxa_servico_habilitada?`, `taxa_servico_bps?`; `Pedido.comanda_id?: string | null`; `Comanda` com os campos da tabela). Se o ambiente de staging estiver disponível (`npm run staging:push`), aplicar lá e conferir com um SQL manual: dois `criar_pedido` de Mesa "5" e "05" caem na mesma comanda; "15" em outra.
- [ ] **Step 4:** rodar o teste → PASS.
- [ ] **Step 5: Commit** (`feat: comandas abertas por mesa no banco, atrás de interruptor`).

### Task 3: Regras puras da comanda

**Files:**
- Create: `src/lib/comandaAberta.ts`
- Test: `tests/comandaAberta.test.ts`

**Interfaces:**
- Produces:
  - `comandaAbertaLigada(barraca: { comanda_aberta_habilitada?: boolean } | null | undefined): boolean` (só `true` literal liga)
  - `modoUsaComanda(barraca, tipo: TipoAtendimento | string | null | undefined): boolean` (ligada **e** `tipo === 'mesa'`)
  - `normalizarMesa(texto: string): string` (mesma regra do SQL `normalizar_mesa`)
  - `subtotalDaComanda(pedidos: { status: string; itens: { quantidade: number; preco_centavos_unitario: number; removido?: boolean }[] }[]): number` (ignora pedido cancelado e item removido)
  - `taxaServicoCentavos(subtotalCentavos: number, bps: number): number` (arredonda ao centavo mais próximo, metade para cima; `bps <= 0` → 0)
  - `totalDoFechamento(subtotal: number, cobrarTaxa: boolean, bps: number): { taxaCentavos: number; totalCentavos: number }`
  - `taxaPadraoMarcada(barraca: { taxa_servico_habilitada?: boolean }): boolean`

- [ ] **Step 1: Testes que falham:** `normalizarMesa('Mesa 05')`, `'5'`, `' mesa  5 '` → todos `'5'`; `'15'` → `'15'`; `'Varanda 2'` → `'varanda 2'`; `''` → `''`. `taxaServicoCentavos(8750, 1000) === 875`; `(1005, 1000) === 101`; `(1004, 1000) === 100`; `(8750, 0) === 0`. `subtotalDaComanda` ignora cancelado e removido. `totalDoFechamento(10000, false, 1000)` → `{taxaCentavos:0,totalCentavos:10000}`. `modoUsaComanda({comanda_aberta_habilitada:true},'balcao') === false`; barraca `null` → `false`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.
- [ ] **Step 5: Commit** (`feat: regras puras da comanda aberta e da taxa de serviço`).

### Task 4: Lançar na Mesa com comanda aberta

**Files:**
- Modify: `src/lib/pagarDepois.ts` (`podeEnviarAReceber`)
- Modify: `src/pages/LancarPedido.tsx` (mesa obrigatória no modo comanda; receber `comandaMesa` por `location.state`)
- Modify: `src/pages/ConfirmarPedido.tsx` (sem escolha de pagamento no modo comanda; botão com o texto certo)
- Test: `tests/comandaLancar.test.ts`

**Interfaces:**
- Consumes: `modoUsaComanda`, `normalizarMesa` (Task 3).
- Produces:
  - `podeEnviarAReceber(barraca, tipo)` passa a aceitar também `tipo === 'mesa'` quando `comandaAbertaLigada(barraca)`.
  - `export function textoBotaoEnviar(modoComanda: boolean, mesa: string, mesaTemComanda: boolean): string` em `src/lib/comandaAberta.ts` → `mesaTemComanda ? 'Adicionar à comanda da Mesa X' : 'Abrir comanda da Mesa X'`; fora do modo comanda devolve o texto atual do botão (ler em `ConfirmarPedido.tsx`).

- [ ] **Step 1: Testes que falham:** `podeEnviarAReceber({comanda_aberta_habilitada:true},'mesa') === true`, sem a flag `false`, `'balcao'` sempre `false`; `textoBotaoEnviar(true,'5',true) === 'Adicionar à comanda da Mesa 5'`, `(true,'5',false) === 'Abrir comanda da Mesa 5'`.
- [ ] **Step 2:** FAIL. **Step 3: Implementar.** No modo comanda: Lançar Pedido exige o número da mesa (hoje opcional) e trava o tipo em `mesa` quando vem `comandaMesa`; Confirmar Pedido manda `p_metodo_pagamento = METODO_NA_ENTREGA` sem mostrar as formas de pagamento; o payload de `criar_pedido` **não muda** (o trigger liga a comanda). `mesaTemComanda` vem de `useComandasAbertas` (Task 5); enquanto não carregou, usar o texto "Enviar para a cozinha". Fora do modo comanda nada muda.
- [ ] **Step 4:** PASS + `npm test`.
- [ ] **Step 5: Commit** (`feat: lançar na Mesa em comanda aberta, sem cobrar na hora`).

### Task 5: Lista de mesas abertas e detalhe

**Files:**
- Create: `src/hooks/useComandas.ts`, `src/pages/Mesas.tsx`
- Modify: `src/App.tsx` (rota `mesas` junto das de `/:slug`), `src/pages/Dashboard.tsx` (cartão "Mesas abertas", só com `comandaAbertaLigada`), `src/components/BarraNavegacao.tsx` apenas se o Hub já usa a barra para atalhos operacionais (conferir; não criar item novo se não couber)
- Test: `tests/comandasAbertasLista.test.ts` (parte pura)

**Interfaces:**
- Produces:
  - `type ComandaAberta = { id: string; mesa: string; abertaEm: string; subtotalCentavos: number; rodadas: { pedidoId: string; senha: number | null; criadoEm: string; status: string; itens: { nome: string; quantidade: number }[] }[] }`
  - `useComandasAbertas(barracaId: string): { comandas: ComandaAberta[]; carregando: boolean; erro: string | null; recarregar: () => void }` (consulta `comandas` com `status = 'aberta'` + `pedidos` + `itens_do_pedido`, Realtime em `comandas` e `pedidos`, cache local para abrir offline, como `useBairrosEntrega`)
  - `agruparComandas(linhas: LinhaBanco[]): ComandaAberta[]` em `src/lib/comandaAberta.ts` (pura, ordena da mais antiga para a mais nova)
- Mesas.tsx: lista (mesa, total parcial, nº de rodadas, tempo aberta) → toque abre o detalhe com as rodadas e dois botões: **"Adicionar item à Mesa X"** (navega para `lancar` com `state { tipoAtendimento: 'mesa', comandaMesa: mesa }`) e **"Fechar comanda e cobrar"** (Task 7). Comanda de barraca que desligou a opção continua listada e fecháveis (rota `mesas` sempre disponível por URL; o cartão do Hub aparece se ligada **ou** houver comanda aberta).

- [ ] **Step 1: Testes que falham** de `agruparComandas`: duas linhas da mesma comanda viram uma com 2 rodadas e subtotal somado; rodada cancelada não entra no subtotal nem na lista de rodadas ativas; ordem por `abertaEm`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar hook, página, rota e cartão. **Step 4:** PASS + `npm run build`.
- [ ] **Step 5: Commit** (`feat: tela de mesas abertas com rodadas e total parcial`).

### Task 6: RPC `fechar_comanda` e fila offline

**Files:**
- Create: `supabase/migrations/20261026110000_fechar_comanda.sql`, `src/lib/fecharComandaFila.ts`
- Modify: `src/lib/fila.ts` (tipo de operação `fechar_comanda`), `src/hooks/useSincronizacao.ts` (novo `case 'fechar_comanda'`, ao lado de `definir_metodo`)
- Test: `tests/fecharComandaMigration.test.ts`, `tests/fecharComandaFila.test.ts`

**Interfaces:**
- Produces (SQL): `public.fechar_comanda(p_comanda_id uuid, p_metodo text, p_cobrar_taxa_servico boolean) returns jsonb` com `estado` em: `ok` (traz `taxa_servico_centavos`, `total_centavos`), `ja_fechada` (mesmo método = devolve `ok`; outro método = `ja_fechada`), `metodo_invalido` (só `dinheiro|debito|credito|pix`), `sem_itens`, `sem_acesso` (mesma resposta para "não existe" e "sem acesso"), `nao_autenticado`. `for update` na comanda; define `metodo_pagamento`, `metodo_definido_em/por` em cada pedido **não cancelado** da comanda (o trigger do evento SAI-001 existente dispara sozinho ao sair de `na_entrega`); soma os itens não removidos desses pedidos; calcula a taxa no servidor com `barracas.taxa_servico_bps` quando `p_cobrar_taxa_servico` e `taxa_servico_habilitada`; grava `status='fechada'`, `fechada_em`, `fechada_por`, `metodo_pagamento`, `taxa_servico_bps`, `taxa_servico_centavos`.
- Produces (TS): `desfechoFecharComanda(error: { code?: string } | null, data: { estado?: string } | null): 'concluida' | 'adiar' | 'falha'` (espelha `src/lib/definirMetodoFila.ts`: `ok`/`ja_fechada` com mesmo método = concluída; `PGRST202` = adiar; demais = falha). Payload da fila: `{ comanda_id: string; metodo: string; cobrar_taxa_servico: boolean }`.

- [ ] **Step 1: Testes que falham:** migration (texto): contém `security definer`, `for update`, `revoke all on function public.fechar_comanda`, `grant execute ... to authenticated`, `metodo_invalido`, `sem_itens`, `ja_fechada`; fila: `desfechoFecharComanda(null,{estado:'ok'}) === 'concluida'`, `({code:'PGRST202'}, null) === 'adiar'`, `(null,{estado:'sem_acesso'}) === 'falha'`.
- [ ] **Step 2:** FAIL. **Step 3:** escrever a RPC (ler `20261010100000_definir_metodo_pagamento.sql` para o padrão de estados) e o `case` na fila (operação idempotente; banco sem a RPC fica adiada sem travar as outras, via `OperacaoAdiadaError`). Se houver staging: fechar uma comanda de 2 rodadas e conferir que ambos os pedidos ficaram com o método e a taxa bate com 10% do subtotal.
- [ ] **Step 4:** PASS + `npm test`.
- [ ] **Step 5: Commit** (`feat: fechar comanda define a forma de pagamento e a taxa de serviço`).

### Task 7: Tela de fechamento e configuração

**Files:**
- Create: `src/components/FecharComandaSheet.tsx`, `src/components/SecaoComandaAberta.tsx`
- Modify: `src/pages/Mesas.tsx` (abrir a folha), `src/pages/Ajustes.tsx` (incluir a seção em "Cardápio & Operação", como `SecaoPagamentoDepois`)
- Test: `tests/fecharComandaTela.test.ts` (parte pura)

**Interfaces:**
- Consumes: `totalDoFechamento`, `taxaPadraoMarcada` (Task 3), operação de fila `fechar_comanda` (Task 6), `METODOS_DISPONIVEIS`/`metodos_pagamento_ativos`.
- Produces: `FecharComandaSheet({ comanda: ComandaAberta; barraca: Barraca; aoFechar: () => void; aoCancelar: () => void })`: mostra rodadas, subtotal, a caixa **"Taxa de serviço (10%)"** marcada por padrão quando `taxa_servico_habilitada` (percentual vindo de `taxa_servico_bps`; o operador pode desmarcar), total, escolha da forma de pagamento (só as ativas da barraca) e o botão "Fechar comanda"; enfileira `fechar_comanda` e fecha a folha (com rede, aguarda o resultado e mostra erro real; offline, avisa que sincroniza depois).
- `SecaoComandaAberta({ barraca })`: toggle "Comanda aberta na Mesa", toggle "Cobrar taxa de serviço" e campo do percentual (salvo por botão `BotaoSalvarCampo`, regra de Ajustes), usando `useRascunho`/`useSalvarBarraca` como `SecaoPagamentoDepois`; percentual validado entre 0 e 30. Barraca com a coluna ausente: seção não aparece.

- [ ] **Step 1: Teste que falha:** função pura `percentualDeBps(bps: number): string` (`1000` → `'10'`, `750` → `'7,5'`) e `bpsDePercentual(texto: string): number | null` (`'10'` → `1000`, `'7,5'` → `750`, `'31'` → `null`, `'abc'` → `null`), em `src/lib/comandaAberta.ts`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar funções, folha e seção. **Step 4:** PASS + `npm run build` + `npm run lint`.
- [ ] **Step 5: Commit** (`feat: fechamento de comanda com taxa de serviço e ajustes da comanda aberta`).

### Task 8: Relatórios, Histórico e Caixa

**Files:**
- Modify: `src/lib/relatorio.ts`, `src/components/SecaoCaixa.tsx`, `src/pages/Historico.tsx`, `src/components/DetalheComanda.tsx`
- Test: `tests/relatorioComanda.test.ts`

**Interfaces:**
- Produces: `somarTaxasServico(comandas: { fechada_em: string; taxa_servico_centavos: number; metodo_pagamento: string | null }[], de: Date, ate: Date): { totalCentavos: number; porMetodo: Record<string, number> }` em `src/lib/relatorio.ts`.
- Regras: pedido de comanda ainda aberta continua só no balde "a receber" (nunca em forma de pagamento nem no caixa de dinheiro); a taxa de serviço é uma linha própria "Taxa de serviço" em Relatório/Faturamento e na planilha exportada, fora do "Recebido nos itens"; o **Caixa** soma a taxa de comandas fechadas em dinheiro ao dinheiro esperado (decisão minha: o dinheiro entrou na gaveta); Histórico/Detalhe mostram "Taxa de serviço: R$ X" no pedido ligado a uma comanda fechada e a etiqueta "Mesa X · comanda aberta" nas rodadas abertas. Carregar `comandas` fechadas do período numa consulta paginada, sem N+1 (padrão de `exportarClientes.ts`).

- [ ] **Step 1: Testes que falham:** `somarTaxasServico` soma só comandas dentro do período e separa por método; comanda com taxa 0 não aparece como linha; `relatorio` com pedido `na_entrega` de Mesa em comanda aberta não incrementa nenhuma forma de pagamento (usar o helper que `relatorio.ts` já expõe para classificar por método).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS + `npm test`.
- [ ] **Step 5: Commit** (`feat: taxa de serviço nos relatórios e no caixa`).

### Task 9: Pergunta no assistente de configuração

**Files:**
- Create: `supabase/migrations/20261026120000_onboarding_comanda.sql` (estende `onboarding_salvar_passo` para o passo 8; ler `20261020100000_onboarding_config.sql` por volta das linhas 317-340 e manter tudo que a função já valida)
- Modify: `src/pages/Configurar.tsx` (passo 8, perto da linha 1090), `src/lib/onboardingConfig.ts` (`resumoDoAssistente`), `tests/onboarding*.test.ts` que enumeram os campos do passo 8
- Test: `tests/onboardingComanda.test.ts`

**Interfaces:**
- Produces: `opcoesCobrancaMesa: { chave: 'na_hora' | 'comanda_aberta'; titulo: string; descricao: string }[]` em `src/lib/onboardingConfig.ts`; o passo 8 mostra a pergunta **"Como você cobra a Mesa?"** só quando o modo `mesa` está marcado; "Comanda aberta" revela "Cobrar 10% de taxa de serviço?" (sim/não). Grava `comanda_aberta_habilitada`, `taxa_servico_habilitada`. Padrão da pergunta: "Paga na hora" (nada muda para quem não responder).

- [ ] **Step 1: Testes que falham:** `opcoesCobrancaMesa` tem as duas chaves; `resumoDoAssistente` cita "Comanda aberta" quando ligada; migration (texto) contém os dois campos novos e preserva a validação de `modos_atendimento`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (a tela fica atrás de `VITE_ONBOARDING_CONFIG` como o resto do assistente). **Step 4:** PASS + `npm test`.
- [ ] **Step 5: Commit** (`feat: assistente de configuração pergunta como a Mesa é cobrada`).

---

## Fase C: NFC-e e as taxas (depende de confirmação fiscal)

### Task 10: Interruptor "incluir as taxas na NFC-e" para a taxa de serviço

**Files:**
- Create: `supabase/migrations/20261026130000_nfce_incluir_taxas.sql`, `supabase/functions/_shared/taxaServicoNfce.ts`
- Modify: `supabase/functions/emitir-nfce/handler.ts`, `src/components/EmitenteFiscal.tsx` (ou `SecaoFiscal`, o que já reúne os campos fiscais) para o toggle
- Test: `tests/taxaServicoNfce.test.ts`, ajustar `tests/emitirNfceTrava.test.ts` se necessário

**Interfaces:**
- Produces:
  - `barracas.nfce_incluir_taxas boolean not null default false`
  - `ratearTaxaServico(totaisItensCentavos: number[], taxaCentavos: number): number[]` em `taxaServicoNfce.ts` (rateio proporcional ao total de itens de cada rodada, maior resto, soma exatamente `taxaCentavos`; mesmo estilo de `_shared/descontoNfce.ts`, ler antes)
- Regras: com o interruptor **desligado** (padrão), `emitir-nfce` e `montarCupomFiscal` ficam idênticos a hoje. Ligado e o pedido pertencendo a uma comanda fechada com taxa > 0, a nota daquela rodada leva a sua parte da taxa (campo de acréscimo por item da FocusNFe), e a soma das `formas_pagamento` continua batendo com o valor da nota. A taxa de entrega **não** muda nesta fase (continua fora da nota; entra no mesmo interruptor numa fase própria).
- **Portão de verificação:** antes de codar o payload, confirmar na documentação oficial da FocusNFe o nome do campo de acréscimo/outras despesas por item da NFC-e (não confiar na memória). Se o campo não existir ou não for aceito para NFC-e, **parar e perguntar ao João**; o toggle fica escondido até lá.

- [ ] **Step 1: Testes que falham:** `ratearTaxaServico([1000, 2000, 3000], 600)` → `[100, 200, 300]`; `([333, 333, 334], 100)` soma 100; `([1000], 0)` → `[0]`; lista vazia → `[]`; rodada com total 0 recebe 0.
- [ ] **Step 2:** FAIL. **Step 3:** implementar função, migration e a integração no handler (injetável nos testes, como já é). **Step 4:** PASS + `npm test`; em homologação, emitir uma nota de rodada de comanda fechada com taxa e conferir valor da nota = itens + parte da taxa.
- [ ] **Step 5: Commit** (`feat: interruptor para incluir a taxa de serviço na NFC-e`).

---

## Verificação final e ordem de publicação

- [ ] `npm test`, `npm run build`, `npm run lint` verdes na branch.
- [ ] Roteiro manual no staging com a opção **desligada** (tudo como antes, só os nomes novos) e **ligada** (abrir mesa 5, adicionar rodada pelo celular, fechar com e sem taxa, fechar offline).
- [ ] Ordem de deploy: migrations → edge functions → app; ligar o interruptor primeiro num restaurante de teste.
- [ ] Atualizar o `CLAUDE.md` (seção de regras de produto) com a comanda aberta, a taxa de serviço e o interruptor da NFC-e.

## Autoverificação do plano contra a spec

- Nomes (spec 3.1, 4): Task 1. Comanda aberta configurável (3.2, 7): Tasks 2–5. Adicionar à comanda pelo celular (3.3): Tasks 4–5. Fechar por garçom ou caixa, registra forma (3.4): Tasks 6–7 (mesmo app, mesma tela). Pergunta no onboarding (3.5): Task 9. Um acesso só (3.6): nenhum login novo. Taxa de serviço, 10% marcada e desmarcável (3.7): Tasks 3, 6, 7, 8. Interruptor NFC-e (5): Task 10. "Pedido em aberto não entra no faturamento nem no caixa" (7): Task 8.
- **Limite assumido (fora da spec):** a NFC-e continua uma nota **por rodada** (como é por pedido hoje); uma nota única por comanda não está neste plano e fica registrada como pendência para o João decidir.
- Decisões minhas neste plano: trigger no banco em vez de novo argumento em `criar_pedido`; senha continua por rodada (Cozinha/Chamada inalteradas); arredondamento da taxa ao centavo mais próximo; taxa em dinheiro entra no Caixa.
