# Cabeçalhos sem quebra de linha no mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Em Lançar Pedido, Cozinha, Histórico e Faturamento (Desktop.tsx), o título do cabeçalho nunca quebra linha e os selos/botões à direita nunca empurram ou sobrepõem o título, em 360px, 390px e 768px.

**Architecture:** Extrair o padrão repetido "botão home + título + área de ações" num componente `CabecalhoPagina` (home à esquerda, título com `truncate`/`whitespace-nowrap` num container `min-w-0 flex-1`, ações à direita em container `shrink-0`). A lógica de classes do título fica numa função pura testável (convenção já usada em `estiloBotaoIcone.ts`). Selos de status (Online/Offline, Tempo real) escondem o texto abaixo de ~380px via variante Tailwind `max-[380px]:hidden`, mantendo o dot; o link "Histórico" (Cozinha) ganha uma versão ícone-only (`bar_chart`, já usado para Histórico em `BarraNavegacao`/`SidebarDesktop`) que aparece só abaixo de 380px.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS v4 (variantes arbitrárias `max-[380px]:`), Node test runner (`node --test`, sem DOM/testing-library disponível no repo).

**Spec:** Pedido do orquestrador (sprint 1, mensagem cross-session), resumido acima; sem arquivo de spec separado.

## Global Constraints

- Toque mínimo 44px em todo controle interativo (`classesBotaoIcone()` já cumpre, size-11).
- Canto balão só em badge/selo estático, nunca em controle interativo (`Badge` já usa `rounded-mesa-balao`, não mudar).
- Mostarda só no botão de ação principal da tela — cabeçalho não ganha mostarda nova.
- Mobile-first: 360px, 390px e 768px (`md:`) são os três alvos de verificação.
- Ícone novo em `<Icone nome="...">` precisa estar em `src/assets/fonts/icones.txt`; reusar `bar_chart` (já na lista, já usado para Histórico) em vez de adicionar ícone novo.
- Não mudar comportamento (navegação do botão home, conteúdo dos selos, rotas) — só o layout/responsividade.

## Review Focus

- Título muito longo (nome de barraca extremo não se aplica aqui, mas "Faturamento"/"Lançar Pedido" em 360px com todas as ações presentes ao mesmo tempo — pendentes>0 E offline) — cobrir com teste de classes do título (nowrap/truncate) e checagem visual no pior caso (offline + pendentes).
- `truncate` sem `min-w-0` no ancestor flex não funciona (continua empurrando) — garantir `min-w-0` no container do título em todas as 4 páginas.
- Badge de status some o texto mas o `dot` precisa continuar visível e com `aria`/texto acessível (não remover do DOM, só escondido visualmente) — manter o texto no DOM (classe `max-[380px]:hidden`), não condicional em JS, para leitor de tela continuar lendo "Online"/"Offline".
- Link "Histórico" trocando pra ícone-only precisa manter `aria-label` equivalente (Histórico) pra não perder acessibilidade ao esconder o texto visível.
- Faturamento (Desktop.tsx) só renderiza em `md:` — o breakpoint de 768px é o único relevante lá; não assumir que precisa do comportamento de <380px (nunca ocorre nessa página).

---

## Decisão de escopo (fora do componente)

`Ajustes.tsx` e `TelaChamada.tsx` estavam na lista original do orquestrador, mas depois de ler o código:
- **Chamada** (`TelaChamada.tsx`) não tem cabeçalho com título — é uma tela kiosk só com um botão de fechar. Nada a mudar.
- **Ajustes** (`Ajustes.tsx`) tem um padrão diferente (ícone chevron + título dentro do MESMO `<Link>`, sem área de ações à direita, abas de categoria embaixo só no desktop). Forçar o componente genérico mudaria o comportamento de tap-target (hoje ícone+título são um único link). Aplico só o fix mínimo (nowrap/truncate/min-w-0) sem trocar de componente, e reporto a decisão ao orquestrador.

### Task 1: Função pura de classes do cabeçalho (testável)

**Files:**
- Create: `src/lib/estiloCabecalhoPagina.ts`
- Test: `tests/estiloCabecalhoPagina.test.ts`

**Interfaces:**
- Produces: `classesTituloCabecalho(): string` — classes do `<h1>` (usado pelo componente da Task 2).

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classesTituloCabecalho } from '../src/lib/estiloCabecalhoPagina.ts'

test('título do cabeçalho nunca quebra linha e corta com ellipsis', () => {
  const classes = classesTituloCabecalho()
  assert.ok(classes.includes('whitespace-nowrap'))
  assert.ok(classes.includes('truncate'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test "tests/estiloCabecalhoPagina.test.ts"`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `classesTituloCabecalho(): string` in `src/lib/estiloCabecalhoPagina.ts`**

Mobile ~22–24px (usar `text-2xl`, já usado em 3 das 4 páginas), `md:text-[32px] md:leading-[40px]` (tamanho atual do Lançar Pedido/Ajustes no desktop); sempre `whitespace-nowrap truncate font-bold text-mesa-text-primary`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "tests/estiloCabecalhoPagina.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/estiloCabecalhoPagina.ts tests/estiloCabecalhoPagina.test.ts
git commit -m "feat(layout): classes puras e testáveis pro título do cabeçalho"
```

### Task 2: Componente `CabecalhoPagina`

**Files:**
- Create: `src/components/ui/CabecalhoPagina.tsx`

**Interfaces:**
- Consumes: `classesTituloCabecalho()` (Task 1); `BotaoHome` (`src/components/ui/BotaoHome.tsx`, já existe, props `onClick?`, `className?`).
- Produces: `CabecalhoPagina({ titulo, acoes, aoClicarHome, className }: { titulo: string; acoes?: ReactNode; aoClicarHome?: () => void; className?: string })` — usado pelas Tasks 3–6.

- [ ] **Step 1: Implementar o componente**

Estrutura: wrapper `flex items-center justify-between gap-3` (+ `className`); lado esquerdo `flex min-w-0 flex-1 items-center gap-1` com `<BotaoHome onClick={aoClicarHome} />` e `<h1 className={classesTituloCabecalho()}>{titulo}</h1>`; lado direito, só se `acoes` existir, `<div className="flex shrink-0 items-center gap-2">{acoes}</div>`.

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/CabecalhoPagina.tsx
git commit -m "feat(layout): componente CabecalhoPagina (home + título + ações)"
```

### Task 3: Aplicar em Lançar Pedido

**Files:**
- Modify: `src/pages/LancarPedido.tsx` (bloco do cabeçalho, atualmente por volta da linha 1101-1129)

**Interfaces:**
- Consumes: `CabecalhoPagina` (Task 2).

- [ ] **Step 1: Substituir o bloco do cabeçalho**

Trocar o `<div className="flex items-start justify-between...">...</div>` por `<CabecalhoPagina titulo="Lançar Pedido" acoes={...} />`, movendo pra dentro de `acoes` o bloco atual de badges (Online/Offline + pendentes) e o botão de tema. Dentro do badge Online/Offline, envolver o texto num `<span className="max-[380px]:hidden">`, mantendo o `dot` sempre visível.

- [ ] **Step 2: Verificar visualmente (ver Task 7) e commit**

```bash
git add src/pages/LancarPedido.tsx
git commit -m "feat(layout): Lançar Pedido usa CabecalhoPagina"
```

### Task 4: Aplicar em Cozinha

**Files:**
- Modify: `src/pages/Cozinha.tsx` (bloco do cabeçalho, atualmente por volta da linha 821-848)

**Interfaces:**
- Consumes: `CabecalhoPagina` (Task 2).

- [ ] **Step 1: Substituir o bloco do cabeçalho**

Mesmo padrão da Task 3. Dentro de `BadgeStatus`, envolver `{TEXTO_STATUS[status]}` num `<span className="max-[380px]:hidden">`. O link "Histórico" ganha uma versão ícone-only antes dele: `<Link to={...} aria-label="Histórico" className={clsx(classesBotaoIcone(), 'hidden max-[380px]:flex')}><Icone nome="bar_chart" size={20} /></Link>`, e a versão atual (texto) ganha `max-[380px]:hidden` na className existente.

- [ ] **Step 2: Verificar visualmente (ver Task 7) e commit**

```bash
git add src/pages/Cozinha.tsx
git commit -m "feat(layout): Cozinha usa CabecalhoPagina"
```

### Task 5: Aplicar em Histórico

**Files:**
- Modify: `src/pages/Historico.tsx` (bloco do cabeçalho, atualmente por volta da linha 655-680)

**Interfaces:**
- Consumes: `CabecalhoPagina` (Task 2).

- [ ] **Step 1: Substituir o bloco do cabeçalho**

Mesmo padrão; aqui as duas ações (tema, esconder filtros) já são ícone-only — não precisa de variante de largura.

- [ ] **Step 2: Verificar visualmente (ver Task 7) e commit**

```bash
git add src/pages/Historico.tsx
git commit -m "feat(layout): Histórico usa CabecalhoPagina"
```

### Task 6: Aplicar em Faturamento (Desktop.tsx)

**Files:**
- Modify: `src/pages/Desktop.tsx` (bloco do cabeçalho `md:block`, atualmente por volta da linha 273-286)

**Interfaces:**
- Consumes: `CabecalhoPagina` (Task 2).

- [ ] **Step 1: Substituir o bloco do cabeçalho**

Mesmo padrão; só o botão de tema como ação, já ícone-only.

- [ ] **Step 2: Verificar visualmente em 768px (ver Task 7) e commit**

```bash
git add src/pages/Desktop.tsx
git commit -m "feat(layout): Faturamento usa CabecalhoPagina"
```

### Task 7: Fix mínimo em Ajustes + verificação final

**Files:**
- Modify: `src/pages/Ajustes.tsx` (h1 por volta da linha 2840)

- [ ] **Step 1: Garantir nowrap/truncate no título de Ajustes sem trocar de componente**

No `<Link>` que envolve ícone+título, adicionar `min-w-0` e no `<h1>` adicionar `whitespace-nowrap truncate`.

- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.app.json`**

Expected: sem erros novos.

- [ ] **Step 3: `npx eslint` nos arquivos tocados**

Expected: sem erros novos (lint já tem `--max-warnings 13`, não introduzir warning novo).

- [ ] **Step 4: `node --test tests/estiloCabecalhoPagina.test.ts tests/icones.test.ts`**

Expected: PASS.

- [ ] **Step 5: Verificação visual em 360px, 390px e 768px**

Lançar Pedido, Cozinha, Histórico, Ajustes, Faturamento — com e sem o badge "pendente(s)"/offline simulado quando possível. Chamada: confirmar que não há regressão (nada a testar, só abrir e olhar).

- [ ] **Step 6: Commit final**

```bash
git add src/pages/Ajustes.tsx
git commit -m "fix(layout): título de Ajustes também não quebra linha"
```
