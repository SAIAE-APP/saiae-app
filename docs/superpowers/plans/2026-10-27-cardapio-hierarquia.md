# Cardápio público com hierarquia e pedido em todas as seções — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o cardápio público de "catálogo" em "caminho": bloco DESTAQUE novo, "Mais pedidos" antes de "Populares", botão de pedir mostarda de 44px em todo card, carrinho fixo em tinta e botões desabilitados fora do horário.

**Architecture:** A lógica nova (qual item é o destaque, em que estado fica o botão de pedir, se a loja está aberta, quais itens o dono pode escolher) vai para arquivos pequenos e puros em `src/lib/`, testados com `node --test`. Dois componentes novos e pequenos em `src/components/cardapio/` (`BotaoPedir`, `CardDestaque`) substituem `BotaoAdicionar` e `BotaoAdicionarCompacto` de `CardapioPublico.tsx`, que só os usa. O destaque vive em `barracas.item_destaque_id` (migration aditiva) e chega ao cliente por uma função nova `destaque_publico(p_slug)`; `cardapio_publico` NÃO é tocada.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4 (tokens `mesa-*`), Supabase (RPC `SECURITY DEFINER`, PGlite nos testes de migration), `node --test` com strip-types.

**Spec:** `docs/superpowers/specs/2026-10-27-cardapio-hierarquia-design.md`

**Branch:** `feat/cardapio-hierarquia` (criar a partir de `main` atualizado no Task 1; todos os commits nela; não mesclar nem publicar sem ordem do João).

## Global Constraints

- Cores de marca só mostarda `#FFC21A` (token `mesa-orange-500`) e tinta `#18171C` (`mesa-neutral-900`); texto sobre mostarda é SEMPRE tinta, nunca branco; nenhuma cor escrita direto no componente (só tokens/classes `mesa-*`).
- Área de toque mínima de 44px em todo botão de pedir (`Button size="md"` = `h-11`; `sm` = 36px NÃO serve aqui); `aria-label` em controles sem texto.
- Canto balão (`rounded-mesa-balao`) em selos/etiquetas estáticos; controles interativos em pílula; cartões `rounded-mesa-xl`; botões `--radius-mesa-btn` (já no `Button`).
- Números (preço, quantidade) em `font-mesa-display`.
- Ícones só do subset da fonte própria. Este projeto NÃO deve precisar de ícone novo (`add`, `remove`, `arrow_forward`, `star`, `image` já existem). Se algum task precisar de um ícone novo: acrescentar o nome em `src/assets/fonts/icones.txt`, rodar `node scripts/gerar-fonte-icones.mjs` (precisa de internet) e confirmar `node --test tests/icones.test.ts`.
- A tela pública lê por funções `SECURITY DEFINER` liberadas para `anon`; nunca RLS pública em `barracas` (guarda `taxa_debito_bps`/`taxa_credito_bps`).
- Migrations: SÓ no staging (projeto `qzcqwovbbylqxljcrqhk`), via MCP `apply_migration` (ferramenta `mcp__306f0696-2dad-4e39-9c67-d3870f07fa7e__apply_migration`, carregar com ToolSearch), UMA migration por vez. NUNCA `npm run staging:push` nem `staging:repair`. NUNCA tocar produção (`vimjwzumjggrlvlxdejr`).
- Fora de escopo: combo/preço próprio, checkout, pagamento, taxa, Pix/cartão, cupom, modelo de pedido, estoque, NFC-e, servidor (edge functions) e título de categoria em "Todos".
- Anti-metas: sem padrão escuro (cliente sempre vê o total e remove itens), sem esconder preço/esgotado/horário, sem contador de urgência, nenhum botão abre o carrinho ou rola a página sozinho.
- Tudo é opcional e degrada: sem capa, sem banner, sem destaque, sem mais pedidos, sem populares, sem horário cadastrado (= sempre aberta).
- Texto de código, docs e commits em português normal e completo. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verificação padrão por task: `node --test tests/<arquivo>.test.ts`; ao fim de cada task que toca `.tsx`: `npm run build` e `npm run lint` (lint tem teto de 13 avisos: `--max-warnings 13`, não aumentar).

## Review Focus

Entradas/condições que o spec implica mas que nenhum teste "óbvio" cobre; cada uma tem seu teste na task indicada.

1. Destaque apontando para item de OUTRA barraca (gravado por chamada direta): `destaque_publico` devolve nada (Task 1).
2. Destaque cujo item ficou "esgotado" só por causa das opções (`item_esgotado` derivado, não do banco): o bloco some (Task 2).
3. Loja fechada com janela que cruza a meia-noite e `status === null` (sem horário / todos os dias fechados): `null` = aberta; de madrugada vale a janela de ontem (Task 3).
4. Item já no carrinho quando a loja fecha: dá para diminuir/remover, não para aumentar (Task 3).
5. Migration ausente / RPC com erro / item do destaque apagado (`on delete set null`): cardápio carrega normal, sem destaque e sem erro na tela (Tasks 1 e 7).
6. Item de preço zero ("Sob consulta") com pagamento online ligado: botão segue desabilitado, em qualquer seção, inclusive no destaque (Task 3).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261105100000_destaque_cardapio.sql` | Criar | coluna `barracas.item_destaque_id` + RPC `destaque_publico` |
| `tests/destaqueMigration.test.ts` | Criar | texto + PGlite da migration |
| `src/lib/destaque.ts` | Criar | `resolverDestaque` (quando o bloco aparece) |
| `tests/destaque.test.ts` | Criar | testes puros do destaque |
| `src/lib/estadoBotaoPedir.ts` | Criar | `lojaAberta`, `estadoBotaoPedir` |
| `tests/estadoBotaoPedir.test.ts` | Criar | testes puros do estado do botão |
| `src/lib/itensParaDestaque.ts` | Criar | `itensElegiveisParaDestaque` (lista do seletor em Ajustes) |
| `tests/itensParaDestaque.test.ts` | Criar | testes puros |
| `src/components/cardapio/BotaoPedir.tsx` | Criar | botão/stepper único (substitui `BotaoAdicionar` e `BotaoAdicionarCompacto`) |
| `src/components/cardapio/CardDestaque.tsx` | Criar | herói mostarda do destaque |
| `src/pages/CardapioPublico.tsx` | Modificar | ordem, botões, destaque, horário, carrinho |
| `src/pages/Ajustes.tsx` | Modificar (`SecaoCardapioDigital`, ~l.1411) | seletor "Item em destaque" |
| `src/types/database.ts` | Modificar (`Barraca`) | `item_destaque_id: string \| null` |
| `docs/consulta-pedidos-cardapio-semana.sql` (ou nota) | Criar | fonte da métrica |
| `CLAUDE.md` | Modificar | leitura A de "um primário por tela" + trecho Cardápio Digital |

## Dependências e paralelismo

```
Task 1 (migration)  ──┐
Task 2 (destaque.ts) ─┤
Task 3 (estado botão)─┼─> Task 5 (componentes) ─> Task 6 (página: botões/ordem/carrinho) ─> Task 7 (página: destaque + horário) ─> Task 9 (CLAUDE.md + verificação final)
Task 4 (Ajustes)  ────┘   (4 precisa só de Task 1 aplicada no staging para o teste manual; edita arquivos próprios)
Task 8 (métrica)  ── independente de tudo; roda em paralelo com qualquer um
```

- **Podem rodar em paralelo (arquivos distintos):** Tasks 1, 2, 3, 4 e 8 (4 só espera a 1 para a verificação manual no staging, não para o código).
- **Task 5** espera 2 e 3. **Task 6 → 7** são sequenciais (mesmo arquivo `CardapioPublico.tsx`). **Task 9** por último.

---

### Task 1: Migration do destaque (só staging)

**Files:**
- Create: `supabase/migrations/20261105100000_destaque_cardapio.sql` (timestamp depois da mais recente, `20261104100000_pagamento_marketplace.sql`; o spec cita `20261103110000`, que ficou velho)
- Test: `tests/destaqueMigration.test.ts`

**Interfaces:**
- Produces: coluna `public.barracas.item_destaque_id uuid null references public.itens(id) on delete set null`; RPC `public.destaque_publico(p_slug text) returns table (item_id uuid)` (anon + authenticated).

- [ ] **Step 1: Criar a branch.** `git checkout main && git pull && git checkout -b feat/cardapio-hierarquia`.
- [ ] **Step 2: Escrever o teste falhando** em `tests/destaqueMigration.test.ts`, no formato de `tests/comandaAbertaMigration.test.ts` (leitura do `.sql` + PGlite; copiar dali a montagem mínima de schema `barracas`/`itens`). Testes:
  - `Rollback no topo` (regex `/Rollback:/` nas 40 primeiras linhas).
  - texto: `add column if not exists item_destaque_id uuid`, `on delete set null`, `security definer`, `set search_path = public, pg_temp`, `grant execute on function public.destaque_publico(text) to anon, authenticated`; e que `cardapio_publico` NÃO aparece no arquivo.
  - PGlite: item ativo da barraca → devolve 1 linha com o `item_id`; item inativo → 0 linhas; item de preço aberto → 0 linhas; **`item_destaque_id` de item da OUTRA barraca → 0 linhas** (Review Focus 1); slug inexistente → 0 linhas; apagar o item → `item_destaque_id` vira `null`.
- [ ] **Step 3: Rodar e ver falhar.** `node --test tests/destaqueMigration.test.ts` → FAIL (arquivo da migration não existe).
- [ ] **Step 4: Escrever a migration.** Cabeçalho com `Rollback:` (`drop function public.destaque_publico(text); alter table public.barracas drop column item_destaque_id;`). `alter table ... add column if not exists`; função `stable`, mesma forma de `banners_publicos`/`horarios_publicos` (ver `20260927170000_cardapio_publico_popular_banners.sql` l.65-84): join `barracas b` por `b.slug = p_slug`, `itens i` por `i.id = b.item_destaque_id and i.barraca_id = b.id and i.ativo and not i.preco_aberto`. Esgotado NÃO filtra aqui (decide o cliente).
- [ ] **Step 5: Rodar e ver passar.** `node --test tests/destaqueMigration.test.ts` → PASS.
- [ ] **Step 6: Conferir RLS.** Confirmar (grep nas migrations de `barracas` + `useSalvarBarraca`) que o dono atualiza colunas de `barracas` pelo mesmo caminho dos outros campos; registrar achado na mensagem do commit. Se a policy de update for por coluna, ajustar a migration.
- [ ] **Step 7: Aplicar no staging.** Carregar a ferramenta com `ToolSearch select:mcp__306f0696-2dad-4e39-9c67-d3870f07fa7e__apply_migration`; `apply_migration` com `project_id=qzcqwovbbylqxljcrqhk`, o SQL do arquivo, UMA chamada. Verificar com `list_migrations` e `execute_sql` (`select item_id from destaque_publico('<slug de teste>')` → 0 linhas). Não rodar `staging:push`/`repair`.
- [ ] **Step 8: Commit** `git add supabase/migrations/20261105100000_destaque_cardapio.sql tests/destaqueMigration.test.ts && git commit -m "feat(cardapio): coluna item_destaque_id e RPC destaque_publico"`.

---

### Task 2: Regra de quando o destaque aparece

**Files:**
- Create: `src/lib/destaque.ts`
- Test: `tests/destaque.test.ts`

**Interfaces:**
- Produces: `resolverDestaque<L extends { item_id: string; item_esgotado: boolean }>(itemId: string | null, linhas: L[], buscaAtiva: boolean): L | null` — devolve a linha do destaque ou `null`.

- [ ] **Step 1: Teste falhando** (`tests/destaque.test.ts`), com linhas `{ item_id, item_esgotado }`:
  - `itemId` null → null; item ausente de `linhas` (inativo/preço aberto já saem de `cardapio_publico`) → null.
  - item presente e disponível → a própria linha.
  - **`item_esgotado: true` (inclusive o derivado das opções, que já vem em `linhas`) → null** (Review Focus 2).
  - `buscaAtiva = true` → null mesmo com item válido.
- [ ] **Step 2:** `node --test tests/destaque.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `resolverDestaque`** em `src/lib/destaque.ts`: `find` por `item_id`, null se esgotado ou busca ativa.
- [ ] **Step 4:** `node --test tests/destaque.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(cardapio): regra pura de exibição do destaque`.

---

### Task 3: Estado do botão de pedir e loja aberta

**Files:**
- Create: `src/lib/estadoBotaoPedir.ts`
- Test: `tests/estadoBotaoPedir.test.ts`

**Interfaces:**
- Produces:
  - `lojaAberta(status: { aberto: boolean } | null): boolean` (null = sempre aberta).
  - `type TipoBotaoPedir = 'esgotado' | 'fechado' | 'escolher' | 'adicionar' | 'contador'`
  - `estadoBotaoPedir(p: { esgotado: boolean; lojaAberta: boolean; podeAdicionar: boolean; comOpcoes: boolean; quantidade: number }): { tipo: TipoBotaoPedir; desabilitado: boolean; podeAumentar: boolean; podeDiminuir: boolean }`
- Consumes: `statusFuncionamento` de `src/lib/horarioFuncionamento.ts` (só no teste de integração do Review Focus 3).

Precedência: `esgotado` > `contador` (sem opções e `quantidade > 0`: `podeDiminuir` sempre true; `podeAumentar = lojaAberta && podeAdicionar`) > `fechado` > `escolher`/`adicionar` (`desabilitado = !podeAdicionar`).

- [ ] **Step 1: Testes falhando:**
  - `lojaAberta(null) === true`; `{aberto:true}` → true; `{aberto:false}` → false.
  - esgotado → `{tipo:'esgotado', desabilitado:true}` mesmo com quantidade > 0 ou loja fechada.
  - item simples, loja aberta, quantidade 0 → `adicionar`, habilitado; com `comOpcoes` → `escolher`.
  - quantidade 2, aberta → `contador`, `podeAumentar` e `podeDiminuir` true.
  - **quantidade 2, fechada → `contador`, `podeAumentar:false`, `podeDiminuir:true`** (Review Focus 4).
  - fechada, quantidade 0 → `fechado`, desabilitado.
  - **`podeAdicionar:false` (preço zero com pagamento online), quantidade 0 → `adicionar`/`escolher` com `desabilitado:true`** (Review Focus 6).
  - Review Focus 3, usando `statusFuncionamento` com horários 18:00–02:00 sexta/sábado: sábado 01:00 → `lojaAberta` true; sábado 03:00 → false; `horarios=[]` → `statusFuncionamento` null → aberta.
- [ ] **Step 2:** `node --test tests/estadoBotaoPedir.test.ts` → FAIL.
- [ ] **Step 3: Implementar** as duas funções em `src/lib/estadoBotaoPedir.ts`, sem dependência de React.
- [ ] **Step 4:** `node --test tests/estadoBotaoPedir.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(cardapio): estado puro do botão de pedir e loja aberta`.

---

### Task 4: Seletor "Item em destaque" em Ajustes

**Files:**
- Create: `src/lib/itensParaDestaque.ts`
- Test: `tests/itensParaDestaque.test.ts`
- Modify: `src/types/database.ts` (interface `Barraca`: `item_destaque_id: string | null`)
- Modify: `src/pages/Ajustes.tsx` (`SecaoCardapioDigital`, logo abaixo do botão "Compartilhar cardápio")

**Interfaces:**
- Produces: `itensElegiveisParaDestaque<I extends { id: string; nome: string; ativo: boolean; esgotado: boolean; preco_aberto?: boolean }>(itens: I[]): I[]` — só ativos, não esgotados, não de preço aberto, ordenados por nome (`localeCompare('pt-BR')`).

- [ ] **Step 1: Teste falhando** (`tests/itensParaDestaque.test.ts`): filtra inativo, esgotado e `preco_aberto`; mantém os demais ordenados por nome; lista vazia → `[]`.
- [ ] **Step 2:** `node --test tests/itensParaDestaque.test.ts` → FAIL.
- [ ] **Step 3: Implementar `itensElegiveisParaDestaque`** em `src/lib/itensParaDestaque.ts`.
- [ ] **Step 4:** `node --test tests/itensParaDestaque.test.ts` → PASS.
- [ ] **Step 5: `Barraca` em `src/types/database.ts`** ganha `item_destaque_id: string | null`.
- [ ] **Step 6: UI em `SecaoCardapioDigital`.** Campo "Item em destaque": reaproveitar o componente de seleção já usado em `Ajustes.tsx` (procurar `<select`/`SegmentedControl`/`Input` de escolha; não criar componente novo em `src/components/ui`), opções = `itensElegiveisParaDestaque` dos itens da barraca (hook que já alimenta a lista de itens de Ajustes) + "Nenhum". Salva na hora com `useSalvarBarraca(barraca).salvar({ item_destaque_id })`, mostrando erro/"Sem internet. Não foi salvo." como as outras seções. Alvo de toque ≥ 44px. Texto de apoio: "Mostra este item no topo do cardápio, com o preço normal dele. Se ele esgotar, o destaque some sozinho." Se o item atual do destaque deixou de ser elegível, mantê-lo visível na lista com a marca "(indisponível)" para o dono poder trocá-lo.
- [ ] **Step 7: Verificar.** `npm run build && npm run lint`; teste manual no staging (`npm run dev:staging`, depende da Task 1 aplicada): escolher item, recarregar Ajustes, valor persiste; escolher "Nenhum" grava `null`.
- [ ] **Step 8: Commit** `feat(ajustes): seletor de item em destaque do cardápio`.

---

### Task 5: Componentes `BotaoPedir` e `CardDestaque`

**Files:**
- Create: `src/components/cardapio/BotaoPedir.tsx`
- Create: `src/components/cardapio/CardDestaque.tsx`

**Interfaces:**
- Consumes: `estadoBotaoPedir`, `TipoBotaoPedir` (Task 3); `Button`, `Icone` de `src/components/ui`.
- Produces:
  - `BotaoPedir(props: { esgotado: boolean; lojaAberta: boolean; podeAdicionar: boolean; comOpcoes?: boolean; quantidadeNoCarrinho: number; textoFechado?: string; larguraTotal?: boolean; variante?: 'mostarda' | 'tinta'; onAdicionar: () => void; onRemover: () => void })`
  - `CardDestaque(props: { item: LinhaCardapioPublico; formatarPreco: (centavos: number) => string; botao: ReactNode; textoFechado?: string })` — o `botao` vem pronto da página (um `BotaoPedir variante="tinta" larguraTotal`), para a página manter a lógica de carrinho.
  - `LinhaCardapioPublico` hoje é tipo local de `CardapioPublico.tsx` (l.44-69): exportá-lo (`export type`) sem mover.

Regras de `BotaoPedir` (do spec 5.3/5.8): `adicionar`/`escolher` = `Button variant="primary" size="md"` (mostarda, tinta, 44px) com ícone `add`, rótulos "Adicionar" / "Escolher" / "Escolher (N)"; `esgotado` = `Button variant="outline" size="md" disabled` "Esgotado" (neutro, nunca mostarda); `fechado` = `Button variant="outline" size="md" disabled` "Fechado" com `aria-label={`Fechado. ${textoFechado}`}`; `contador` = o stepper atual de `BotaoAdicionar` (botões com `size-11 -m-2`), `Aumentar` com `disabled={!podeAumentar}`. `variante="tinta"` usa `Button variant="confirm"` (texto claro) para sobre fundo mostarda. `larguraTotal` aplica `w-full` (cards horizontais de 144px e herói). Nenhum estilo do stepper no tamanho de 20px.

`CardDestaque`: `<section aria-labelledby={id}>` fundo `bg-mesa-orange-500`, TODO texto `text-mesa-neutral-900`, `rounded-mesa-xl`; rótulo "Destaque da casa" (id do `aria-labelledby`); foto grande (`<img alt="">`, ou `Icone nome="image"` sem foto); nome; descrição `line-clamp-2`; preço em `font-mesa-display` com "a partir de" quando `item.a_partir_de`; sem selo Popular/Top 1; se `textoFechado` existir, mostra-o em texto tinta acima do botão. Fotos reduzidas se não couber (spec 10, 360px).

- [ ] **Step 1: Criar `BotaoPedir.tsx`** copiando a marcação do stepper de `BotaoAdicionar` (l.160-242 de `CardapioPublico.tsx`) e delegando TODA decisão de estado a `estadoBotaoPedir` (nenhuma lógica de estado duplicada no componente).
- [ ] **Step 2: Criar `CardDestaque.tsx`** conforme as regras acima.
- [ ] **Step 3: Verificar.** `npm run build && npm run lint` → sem erros (componentes ainda não usados; sem aviso novo de lint).
- [ ] **Step 4: Commit** `feat(cardapio): BotaoPedir e CardDestaque`.

---

### Task 6: Página — botões mostarda de 44px, ordem e carrinho em tinta

**Files:**
- Modify: `src/pages/CardapioPublico.tsx` (`BotaoAdicionar` l.160-242, `CardItemPublico` l.244-306, `BotaoAdicionarCompacto` l.438-489, `CardItemHorizontal` l.495-555, blocos Populares l.1604-1621 / Mais pedido l.1623-1640, barra do carrinho l.1707-1728)

**Interfaces:**
- Consumes: `BotaoPedir` (Task 5), `lojaAberta` (Task 3, por ora fixa `true` aqui; o horário real entra na Task 7).

- [ ] **Step 1: `CardItemPublico`** passa a usar `BotaoPedir` (variante mostarda, `lojaAberta`, `podeAdicionar={!podeComprar || item.item_preco_centavos > 0}`, `comOpcoes={item.com_opcoes === true}`). Remover `BotaoAdicionar` do arquivo. Ajustar espaçamento do card para os 44px.
- [ ] **Step 2: `CardItemHorizontal`** (144px): botão em linha própria abaixo do preço com `larguraTotal`, mesmo `BotaoPedir`. Remover `BotaoAdicionarCompacto` do arquivo. Conferir que `quantidadeDoItem` (l.1120) segue sendo a fonte da quantidade (mesmo item = mesma quantidade em todas as seções).
- [ ] **Step 3: Trocar a ordem** dos blocos: "Mais pedidos" (algorítmico, `MAXIMO_MAIS_PEDIDOS = 8`) ANTES de "Populares"; ambos continuam somindo em busca ou vazios.
- [ ] **Step 4: Barra do carrinho fixo** (l.1707-1728): fundo tinta mantido; o pill "Ver pedido" deixa de ser mostarda e passa a claro sobre tinta (`bg-mesa-neutral-50 text-mesa-neutral-900`; no escuro, o inverso já coberto pelo token do tema), contraste conferido. Total e "N itens" sempre visíveis; nada abre o carrinho sozinho; `pb-24` da lista permanece.
- [ ] **Step 5: Verificar.** `npm test` (suite inteira, incluindo `tests/icones.test.ts` e `tests/modosCardapio.test.ts`), `npm run build`, `npm run lint`. Conferir no navegador (`mcp__Claude_Browser__*`, `npm run dev:staging`) com viewport mobile 360px: botão mostarda com texto tinta em todos os cards, alvo ≥ 44px (inspecionar altura), esgotado neutro, pill do carrinho claro.
- [ ] **Step 6: Commit** `feat(cardapio): botão de pedir mostarda de 44px, Mais pedidos antes de Populares, carrinho em tinta`.

---

### Task 7: Página — destaque e fora do horário

**Files:**
- Modify: `src/pages/CardapioPublico.tsx` (efeitos de carga perto de l.722/801, `status` l.876, render entre banner e Mais pedidos, barra do carrinho)

**Interfaces:**
- Consumes: `resolverDestaque` (Task 2), `lojaAberta` (Task 3), `BotaoPedir`/`CardDestaque` (Task 5), RPC `destaque_publico` (Task 1).

- [ ] **Step 1: Carga do destaque.** Novo `useEffect` ao lado do de `opcoes_publicas`: `supabase.rpc('destaque_publico', { p_slug: slug })` → estado `itemDestaqueId: string | null`. Erro (migration ausente, rede) = `console.warn` e segue sem destaque, sem toast nem tela de erro (Review Focus 5); chamada paralela, não bloqueia a tela.
- [ ] **Step 2: Render do destaque.** `const destaque = useMemo(() => resolverDestaque(itemDestaqueId, linhas, buscaAtiva), [...])`; entre o `CarrosselBanners` e "Mais pedidos", `{destaque && <CardDestaque ... botao={<BotaoPedir variante="tinta" larguraTotal ... />} />}`. Item do destaque continua nas outras seções (sem remover).
- [ ] **Step 3: Relógio.** Estado `agora: Date`, atualizado no carregamento e em `visibilitychange`/`focus` da janela (remover os listeners no cleanup); `status = useMemo(() => statusFuncionamento(horarios, agora), [horarios, agora])`; `const aberta = lojaAberta(status)`.
- [ ] **Step 4: Propagar `aberta` e `textoFechado`** (`status?.texto`) a todo `BotaoPedir` (cards, horizontais, herói). Na barra do carrinho: se `!aberta`, "Ver pedido" fica desabilitado com o texto "Fechado" (total continua visível, a remoção continua possível dentro do "Seu pedido"/steppers). Preço, itens e descrição nunca somem.
- [ ] **Step 5: Verificar.** `npm test`, `npm run build`, `npm run lint`. No navegador (staging, Task 1 aplicada, 360px): (a) sem destaque escolhido → tela começa em Mais pedidos; (b) com destaque → herói mostarda, botão tinta, "− N +" após adicionar, mesma quantidade nos outros cards; (c) destaque esgotado ou busca ativa → bloco some; (d) barraca com horário fechado → todos os botões "Fechado" desabilitados, selo com o horário, stepper de item já no carrinho ainda diminui; (e) item com opções abre `SeletorOpcoes`; (f) pagamento online desligado → adicionar funciona e finalizar mostra "Finalize no caixa"; (g) sem a RPC (simular erro) → cardápio normal.
- [ ] **Step 6: Portão de aceite visual (spec 10).** Conferir 360px: primeira tela mostra selo/horário e destaque (ou início de Mais pedidos); botões ≥ 44px; se ficar "amarelo demais", aplicar o recuo (herói com borda mostarda em vez de fundo cheio) e registrar. A decisão final do visual é do João em celular real.
- [ ] **Step 7: Commit** `feat(cardapio): bloco destaque e botões desabilitados fora do horário`.

---

### Task 8: Fonte da métrica (pedidos por semana por barraca)

**Files:**
- Create: `docs/consulta-pedidos-cardapio-semana.sql` (consulta) OU a nota por escrito dentro do próprio arquivo dizendo que não há fonte confiável

**Interfaces:** nenhuma (independente do resto).

- [ ] **Step 1: Investigar no staging, somente leitura** (`execute_sql` no projeto `qzcqwovbbylqxljcrqhk`): como distinguir pedido do cardápio público do pedido de balcão em `pedidos` (colunas como `tipo_atendimento`, `client_uuid`, vínculo com `pagamentos_pendentes`, `cliente_telefone`; lembrar que `cardapio_pedidos_log` retém só 2 dias e NÃO serve).
- [ ] **Step 2: Escrever** a consulta (pedidos por semana por `barraca_id`, excluindo cancelados) ou declarar por escrito no cabeçalho do arquivo que não há fonte confiável e o que faltaria (ex.: coluna de origem). Rodar a consulta uma vez no staging para provar que executa.
- [ ] **Step 3: Commit** `docs(cardapio): consulta da métrica de pedidos por semana`.

---

### Task 9: CLAUDE.md e verificação final

**Files:**
- Modify: `CLAUDE.md` (regra "Um primário por tela" em "Regras de tema", ~l.647; trecho de Cardápio Digital — localizar com `grep -n "Cardápio Digital" CLAUDE.md`, já que o arquivo tem 1162 linhas)

- [ ] **Step 1: Registrar a leitura A** na frase "Um primário por tela": no cardápio público o papel principal é "pedir" e todo botão que o cumpre é mostarda (mesma ação repetida); esgotado/fechado são neutros; carrinho fixo é tinta com pill claro; herói do destaque é mostarda com botão tinta. Acrescentar no trecho do Cardápio Digital: ordem das seções, `barracas.item_destaque_id` + `destaque_publico`, "Ajustes > Cardápio digital > Item em destaque", botões desabilitados fora do horário (só na tela; o servidor só recusa com `bloquear_fora_do_horario`), migration `20261105100000` antes do app, ordem de deploy migration → app, e a consulta da métrica (Task 8). Texto em português normal e completo.
- [ ] **Step 2: Verificação final (evidência antes de afirmar):** `npm test` (tudo verde, em especial `tests/icones.test.ts`), `npm run lint` (≤ 13 avisos), `npm run build`.
- [ ] **Step 3: Revisar o diff da branch** contra o spec seção por seção (5.1 a 5.8, 6) e confirmar: nenhuma migration aplicada fora do staging, nenhum `staging:push/repair` executado, nenhum arquivo de servidor/edge function alterado.
- [ ] **Step 4: Commit** `docs: leitura A de "um primário por tela" no cardápio público e destaque`.

## Self-review (feito)

- Cobertura do spec: 5.1 (sem mudança, nada a fazer) · 5.2 → Tasks 5, 7 · 5.3 → Tasks 5, 6 · 5.4 → Task 6 · 5.5 → Task 6 (só botão) · 5.6 → Task 6 · 5.7 → Task 7 passo 5 · 5.8 → Tasks 3, 7 · 6 → Tasks 1, 4 · 7 → Task 8 · 8/10 → Review Focus, Tasks 7 passo 6 e 9 · CLAUDE.md → Task 9.
- Consistência de nomes: `resolverDestaque`, `lojaAberta`, `estadoBotaoPedir`, `itensElegiveisParaDestaque`, `BotaoPedir`, `CardDestaque`, `item_destaque_id`, `destaque_publico` iguais em todas as tasks.

## Decisões tomadas ao planejar

1. Timestamp da migration `20261105100000` (a mais recente do repo é `20261104100000`; o spec cita `20261103110000`, defasado).
2. Sem biblioteca de teste de componente no projeto (só `node --test` em `.ts`): a lógica de estado do botão e do destaque foi extraída para funções puras testadas; os componentes `.tsx` são verificados por build, lint e conferência visual no navegador.
3. `BotaoAdicionar` e `BotaoAdicionarCompacto` são removidos (não viram casca): um só `BotaoPedir`.
4. Preço aberto não precisa de filtro no cliente: `cardapio_publico` já oculta esses itens, então `resolverDestaque` os trata como ausentes; a RPC filtra também por segurança.
5. O relógio da loja recalcula ao carregar e ao voltar o foco da aba (não por timer), como diz o spec.
6. Item do destaque no seletor de Ajustes que ficou indisponível continua listado como "(indisponível)" para o dono poder trocá-lo.
7. A consulta da métrica entra como Task 8 independente; se não houver fonte confiável, o entregável é a declaração por escrito (critério de aceite do spec).
