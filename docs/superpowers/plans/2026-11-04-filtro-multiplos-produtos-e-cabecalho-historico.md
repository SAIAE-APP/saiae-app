# Filtro de vários produtos/categorias e cabeçalho fluido do Histórico — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir marcar vários produtos (ou uma categoria inteira) no Faturamento e no Histórico, e tornar o cabeçalho do Histórico um cabeçalho que encolhe aos poucos ao rolar.

**Architecture:** A lógica de agregação e de seleção vira funções puras em `src/lib` (testadas com `node --test`). O hook `useRelatorio` troca o `itemFiltradoId` único por um conjunto de ids. Um componente novo, `SeletorProdutos`, é usado pelas duas telas. O cabeçalho do Histórico reaproveita `useOcultarAoRolar`, mas em vez de esconder tudo, recolhe os filtros e deixa uma linha fina fixa.

**Tech Stack:** React, TypeScript, Supabase (PostgREST), Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-04-filtro-multiplos-produtos-e-cabecalho-historico-design.md`

## Global Constraints

- Textos da interface em português, no mesmo tom das telas atuais.
- Testes: `npm test` (`node --test "tests/*.test.ts"`); imports de `src/lib` com extensão `.ts`, como em `tests/pedidoGratis.front.test.ts`. Build: `npm run build` (`tsc -b && vite build`). Lint: `npm run lint` (`--max-warnings 13`; não aumentar o número de avisos).
- Comandas canceladas e itens com `removido = true` nunca entram nas somas (comportamento atual de `agregarProdutoIsolado`).
- Plano Essencial continua com histórico de 7 dias e sem exportar; as telas continuam atrás de `GateSenhaAdmin`.
- Funciona no celular e no Android (Capacitor). Não editar `android/` nem `android/app/src/main/assets/` (saída de build). Não commitar os dois arquivos `android/*.gradle` que já estão modificados na branch atual.
- Sem seleção, as duas telas se comportam exatamente como hoje.

## Review Focus

- Comanda com dois itens marcados: o pedido conta uma vez e cada item soma uma vez (nunca duplica a comanda).
- Comanda cancelada, ou item removido do produto marcado: não entra na soma do Faturamento e não faz a comanda aparecer no Histórico.
- Categoria sem nenhum produto ativo: não aparece no seletor (ou não faz nada ao tocar), sem quebrar.
- Trocar o período mantém os produtos marcados.
- Cabeçalho do Histórico ao rolar devagar perto do limite: não pisca nem entra em ciclo de recolher/expandir.

---

### Task 1: Lógica pura de soma e de seleção (+ `.gitignore`)

**Files:**
- Create: `src/lib/selecaoProdutos.ts`
- Modify: `src/lib/relatorio.ts:304-343`
- Modify: `.gitignore` (adicionar `.superpowers/`)
- Test: `tests/filtroProdutos.test.ts`

**Interfaces:**
- Produces, em `src/lib/relatorio.ts`:
  - `calcularSerieItemPorDia(pedidos: PedidoComItens[], itemIds: ReadonlySet<string>, inicio: string, fim: string): PontoSerie[]` (troca o `itemId: string` atual)
  - `calcularSerieItemPorHora(pedidos: PedidoComItens[], itemIds: ReadonlySet<string>): PontoSerie[]`
  - `agregarProdutosIsolados(pedidos: PedidoComItens[], itemIds: ReadonlySet<string>, intervalo: IntervaloData): { totalIsolado: number; unidadesVendidas: number; serieTemporal: ... }` (mesmo corpo de `agregarProdutoIsolado` em `useRelatorio.ts:142`, movido para cá e generalizado)
  - `pedidoTemItemSelecionado(pedido: PedidoComItens, itemIds: ReadonlySet<string>): boolean` (verdadeiro se algum item não removido tem `item_id` no conjunto)
- Produces, em `src/lib/selecaoProdutos.ts`:
  - `type EstadoCategoria = 'nenhum' | 'alguns' | 'todos'`
  - `estadoDaCategoria(selecionados: ReadonlySet<string>, idsDaCategoria: string[]): EstadoCategoria`
  - `alternarCategoria(selecionados: ReadonlySet<string>, idsDaCategoria: string[]): Set<string>` (se `todos`, desmarca todos da categoria; senão marca todos)
  - `alternarProduto(selecionados: ReadonlySet<string>, id: string): Set<string>`
  - `rotuloDaSelecao(selecionados: ReadonlySet<string>, nomesPorId: Map<string, string>): string | null` (`null` sem seleção; o nome do produto se for 1; `"N produtos"` se forem 2 ou mais)

- [ ] **Step 1: Escrever os testes que falham em `tests/filtroProdutos.test.ts`.** Montar pedidos mínimos com `itens_do_pedido` e cobrir:
  - `agregarProdutosIsolados` soma valor (`preco_centavos_unitario * quantidade`) e unidades de dois ids, ignorando `status: 'cancelado'` e `removido: true`;
  - um pedido com os dois ids marcados soma os dois itens (Review Focus 1) e a série diária tem um ponto com valor e quantidade somados;
  - `pedidoTemItemSelecionado` é falso quando o único item marcado está `removido`;
  - `alternarCategoria` marca tudo quando `nenhum` ou `alguns`, desmarca tudo quando `todos`, sem mexer em ids de outras categorias; `estadoDaCategoria` devolve os três estados; `rotuloDaSelecao` devolve `null`, o nome e `"3 produtos"`.
- [ ] **Step 2: Rodar `node --test tests/filtroProdutos.test.ts`.** Esperado: FALHA por exportações inexistentes.
- [ ] **Step 3: Implementar as funções acima.** Em `relatorio.ts`, as duas séries trocam `item.item_id !== itemId` por `!itemIds.has(item.item_id)`; `agregarProdutosIsolados` usa as séries novas. Em `selecaoProdutos.ts` as funções devolvem sempre um `Set` novo (nunca mutam o recebido).
- [ ] **Step 4: Adicionar `.superpowers/` ao `.gitignore`.**
- [ ] **Step 5: Rodar `node --test tests/filtroProdutos.test.ts`.** Esperado: PASSA. (`npm run build` só depois da Task 2, porque `useRelatorio.ts` ainda chama as séries com o `itemId` antigo.)
- [ ] **Step 6: Commit** `feat: soma e seleção de vários produtos (lógica pura)`.

---

### Task 2: `useRelatorio` aceita vários produtos

**Files:**
- Modify: `src/hooks/useRelatorio.ts` (busca em `83-99`, remoção de `agregarProdutoIsolado` em `142-168`, hook em `186-312`)

**Interfaces:**
- Consumes: `agregarProdutosIsolados`.
- Produces: `useRelatorio(barraca: Barraca, filtro: FiltroRelatorio, itensFiltradosIds?: readonly string[]): ResultadoRelatorio`. O tipo `ResultadoRelatorio` e o `AgregadoProdutoIsolado` não mudam. O modo é `'produto_isolado'` quando o array tem pelo menos um id; vazio ou ausente é `'completo'`.

- [ ] **Step 1: Trocar `buscarPedidosComItem(barracaId, itemId, ...)` por `buscarPedidosComItens(barracaId, itemIds: readonly string[], inicio, fim)`.** Mesma consulta com `!inner`, trocando `.eq('itens_do_pedido.item_id', itemId)` por `.in('itens_do_pedido.item_id', itemIds)`. O `!inner` devolve cada pedido uma vez, com só as linhas dos itens marcados.
- [ ] **Step 2: Atualizar o hook.** Dentro do hook, montar `const idsChave = itensFiltradosIds?.join(',') ?? ''` e `const idsSet = useMemo(() => new Set(itensFiltradosIds ?? []), [idsChave])`. Usar `idsChave` na lista de dependências do `useEffect` (não o array, que muda de referência a cada render) e `idsSet.size > 0` no lugar dos testes de `itemFiltradoId`. Remover `agregarProdutoIsolado` do arquivo e importar `agregarProdutosIsolados`.
- [ ] **Step 3: Rodar `npm run build` e `npm test`.** Esperado: o build ainda falha só nas telas que passam `itemFiltradoId` (`Desktop.tsx`); os testes passam. Se o build acusar outro erro, corrigir aqui.
- [ ] **Step 4: Commit** `feat(relatorio): hook aceita vários produtos`.

---

### Task 3: Componente `SeletorProdutos`

**Files:**
- Create: `src/components/SeletorProdutos.tsx`
- Modify: `src/components/ui/index.ts` não precisa mudar; o componente fica em `src/components/`.

**Interfaces:**
- Consumes: `estadoDaCategoria`, `alternarCategoria`, `alternarProduto`, `rotuloDaSelecao` de `src/lib/selecaoProdutos.ts`; `Item`, `Categoria` de `src/types/database.ts`; `Checkbox`, `Chip`, `BottomSheet`, `Icone` de `src/components/ui`.
- Produces: `SeletorProdutos({ itens, categorias, selecionados, onChange, className }: { itens: Item[]; categorias: Categoria[]; selecionados: ReadonlySet<string>; onChange: (proximo: Set<string>) => void; className?: string })` e o hook `useCategoriasDaBarraca(barracaId: string): Categoria[]` no mesmo arquivo (busca `categorias` filtrando `barraca_id`, ordenado por `ordem`, mesmo padrão do efeito de `itens` em `Historico.tsx:509-526`).

- [ ] **Step 1: Escrever o componente.** Um botão com o rótulo atual (`"Todos os produtos"` sem seleção, senão `rotuloDaSelecao(...)`) abre um `BottomSheet`. Dentro: itens agrupados por categoria na ordem de `categorias`, produtos sem categoria (ou de categoria sem registro) no grupo `"Sem categoria"` no fim; cada grupo tem um `Checkbox` de categoria (`indeterminate` quando `alguns`) e, abaixo, um `Checkbox` por produto. Categoria sem produtos ativos não aparece. Botão `"Limpar"` chama `onChange(new Set())`. Cada mudança chama `onChange` na hora, sem botão de confirmar.
- [ ] **Step 2: Rodar `npm run build`.** Esperado: o componente compila (erros restantes só nas telas das Tasks 4 e 5).
- [ ] **Step 3: Commit** `feat: seletor de produtos e categorias`.

---

### Task 4: Faturamento usa o seletor

**Files:**
- Modify: `src/pages/Desktop.tsx:59-91` e o `<select>` em `305-318`
- Modify: `src/components/PainelRelatorio.tsx` (prop `nomeItemFiltrado`, usada em `218` e `252`)

**Interfaces:**
- Consumes: `SeletorProdutos`, `useCategoriasDaBarraca`, `rotuloDaSelecao`, `useRelatorio(..., itensFiltradosIds)`.
- Produces: nenhuma mudança de assinatura em `PainelRelatorio`; `nomeItemFiltrado` passa a receber o rótulo da seleção (nome do produto, ou `"3 produtos"`).

- [ ] **Step 1: Em `Desktop.tsx`, trocar `itemFiltradoId` por `selecionados: Set<string>` (estado inicial `new Set()`).** Passar `Array.from(selecionados)` para `useRelatorio`; calcular `nomeItemFiltrado` com `rotuloDaSelecao(selecionados, nomesPorId)`. Substituir o `<select>` por `<SeletorProdutos ... />` (largura total no celular, como o `select` atual).
- [ ] **Step 2: Conferir `PainelRelatorio.tsx`.** O título `Relatório de {nomeItemFiltrado ?? 'produto'} ...` precisa ler bem com `"3 produtos"`; ajustar o texto só se ficar estranho.
- [ ] **Step 3: Rodar `npm run build` e `npm run lint`.** Esperado: build passa (agora só falta `Historico.tsx` se ainda usar o tipo antigo; ele não usa o hook, então deve passar); lint sem aumentar os avisos.
- [ ] **Step 4: Conferir no navegador (`npm run dev`).** Em Faturamento: sem seleção, o relatório completo igual ao de antes; marcar uma categoria soma os produtos dela; trocar o período mantém a seleção (Review Focus 4); com um produto sem vendas aparece `"Ainda não há vendas para analisar"`.
- [ ] **Step 5: Commit** `feat(faturamento): filtrar por vários produtos e categorias`.

---

### Task 5: Histórico filtra por vários produtos

**Files:**
- Modify: `src/pages/Historico.tsx:460-461`, `528-533`, `726-737`, e `temFiltroAtivo` em `558-560`

**Interfaces:**
- Consumes: `SeletorProdutos`, `useCategoriasDaBarraca`, `pedidoTemItemSelecionado`.

- [ ] **Step 1: Trocar `itemFiltradoId` por `selecionados: Set<string>`.** O filtro de `pedidosDoPeriodoComItemFiltrado` vira `selecionados.size === 0 ? pedidosDoPeriodo : pedidosDoPeriodo.filter((p) => pedidoTemItemSelecionado(p, selecionados))`. `temFiltroAtivo` usa `selecionados.size > 0`. Substituir o `<select>` por `<SeletorProdutos ... />`. O texto de "Apagar período" não muda: continua agindo sobre `pedidosExibidos`.
- [ ] **Step 2: Rodar `npm run build` e `npm test`.** Esperado: passam.
- [ ] **Step 3: Conferir no navegador.** Marcar dois produtos mostra só as comandas com algum deles; uma comanda cancelada ou com o item removido do produto marcado não aparece (Review Focus 2); `"Apagar período"` com seleção diz `"filtrado"` no texto de confirmação.
- [ ] **Step 4: Commit** `feat(historico): filtrar por vários produtos e categorias`.

---

### Task 6: Cabeçalho do Histórico que encolhe ao rolar

**Files:**
- Modify: `src/pages/Historico.tsx:645-815` (cabeçalho e o botão flutuante "Filtros")
- Modify (só se necessário): `src/hooks/useOcultarAoRolar.ts`

**Interfaces:**
- Consumes: o `[filtrosEscondidos, esconderFiltros, exibirFiltros]` atual de `useOcultarAoRolar`. Aqui `filtrosEscondidos` significa "recolhido".

- [ ] **Step 1: Reestruturar o cabeçalho fixo em duas partes.** Parte fixa (sempre visível, uma linha): título/ações já existentes, mais a linha fina com o período (um `<select>` compacto com `periodosDisponiveis`), o campo de busca e um botão de filtros que chama `exibirFiltros` e mostra quantos filtros estão ativos. Parte recolhível (período em `SegmentedControl`, datas, seletor de produtos, chips de consumo e de pagamento, contador e "Apagar período"): fica dentro de um contêiner que anima a altura (`grid` com `grid-rows-[1fr]`/`grid-rows-[0fr]` e `transition-[grid-template-rows]`) em vez de `-translate-y-full`. Remover o botão flutuante "Filtros" e o `pointer-events-none` do cabeçalho.
- [ ] **Step 2: Evitar o ciclo de recolher/expandir.** Como recolher muda a altura da página, conferir que o limiar de `useOcultarAoRolar` (`LIMIAR_ESCONDER_PX = 40`, `LIMIAR_TOPO_PX = 24`) não reexpande sozinho no meio da lista. Se reexpandir, aumentar a folga entre os dois limiares no hook, sem mudar o comportamento do outro uso (`Cozinha`, se houver — conferir com `grep useOcultarAoRolar src`).
- [ ] **Step 3: Rodar `npm run build` e `npm run lint`.** Esperado: passam, sem novos avisos.
- [ ] **Step 4: Conferir no navegador em tela de celular (largura ~390px) e no desktop.** No topo está completo; ao rolar devagar recolhe suave e sobra a linha fina; o botão de filtros reexpande; rolar de volta ao topo reexpande; rolar devagar perto do limite não pisca (Review Focus 5); a busca e o período da linha fina funcionam igual aos do cabeçalho completo; o tema escuro continua legível.
- [ ] **Step 5: Commit** `feat(historico): cabeçalho que encolhe ao rolar`.

---

## Autoavaliação

- **Cobertura do spec:** seleção múltipla e categoria inteira nas duas telas (Tasks 1, 3, 4, 5); soma, evolução e comparação no Faturamento (Tasks 1, 2); Histórico mostra comandas com algum item marcado (Tasks 1, 5); cabeçalho opção B (Task 6); `.gitignore` (Task 1). Os não-objetivos não têm tarefa, como deve ser.
- **Consistência de nomes:** `itemIds: ReadonlySet<string>` nas funções puras, `itensFiltradosIds: readonly string[]` só no hook, `selecionados: Set<string>` nas telas e no seletor, usados do mesmo jeito em todas as tarefas.
- **Testes:** só a lógica pura tem teste automatizado (Task 1). O repositório não tem teste de componente React; as Tasks 4 a 6 terminam com conferência manual no navegador.
