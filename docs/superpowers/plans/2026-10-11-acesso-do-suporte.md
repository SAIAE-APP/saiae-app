# Acesso do suporte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono de uma barraca gera um código curto, de uso único, válido 24h; uma conta na allowlist `usuarios_suporte` resgata o código e ganha acesso de 7 dias àquela barraca (sem PIN de Ajustes), sem SQL manual. O dono vê e encerra o acesso quando quiser. Suporte não pode apagar a loja, trocar dono, mexer em assinatura/pagamento nem excluir a conta.

**Architecture:** Uma migration aditiva com 3 tabelas (`usuarios_suporte`, `codigos_suporte`, `acessos_suporte`) + RLS + 5 funções SECURITY DEFINER (gerar, resgatar, encerrar, meu-acesso, minhas-barracas-de-suporte) + `CREATE OR REPLACE` de `usuario_tem_acesso_barraca` (acrescenta uma condição OR, preserva o resto). O código nunca é guardado em texto puro — hash SHA-256 (via `pgcrypto.digest`, não bcrypt: a defesa aqui é validade curta + uso único + allowlist + limite de tentativas, não custo computacional do hash, e o lookup por igualdade precisa ser indexável). No front: `useBarracasDoUsuario` passa a unir `usuarios_barracas` com as barracas de suporte ativas (papel sintético `'suporte'`), o que faz `RotaProtegida`/`SelecionarBarraca` funcionarem sem mudança; `GateSenhaAdmin` pula o PIN quando `suporte_meu_acesso` diz que o acesso está ativo; duas faixas fixas em `LayoutBarraca` (uma pro suporte, uma pro dono).

**Tech Stack:** Supabase Postgres (SQL puro + plpgsql, SECURITY DEFINER), React + TypeScript, Node test runner com `@electric-sql/pglite` pros testes de banco (padrão já usado em `tests/iaLigarMigration.test.ts`).

**Spec:** `C:\Users\AORUS\Downloads\PROMPT-ACESSO-DO-SUPORTE.md` (texto completo do sprint, sem o "BLOCO COMUM" — usuário autorizou executar sem ele).

## Global Constraints

- NUNCA aplicar a migration em produção (`vimjwzumjggrlvlxdejr`); pode aplicar e testar em staging (`qzcqwovbbylqxljcrqhk`) com transação e rollback.
- Migration aditiva: só `create table if not exists` / `create or replace function`; a única alteração de função existente é `usuario_tem_acesso_barraca`, e só para ACRESCENTAR uma condição OR — o corpo original fica intacto.
- Nenhuma política ou função expõe `codigos_suporte.codigo_hash` a nenhum papel de cliente (nem select direto, nem devolvido por RPC).
- Toda função nova: `revoke all ... from public, anon, authenticated` seguido do `grant` explícito só pra quem precisa (padrão de `definir_metodo_pagamento.sql`).
- `usuarios_suporte` não tem nenhuma policy de INSERT/UPDATE/DELETE pro cliente — só o dono do projeto inclui linhas por SQL direto, uma vez.
- Ações já gated por `papel = 'dono'` (apagar barraca, excluir conta, etc.) NÃO mudam — um usuário de suporte nunca tem linha em `usuarios_barracas`, então já fica de fora delas por construção. Não criar nenhuma RPC nova de "trocar dono" (não existe hoje).
- 1 PR, branch nova a partir de `origin/main`, nunca mesclar.
- `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint <arquivos tocados>`, `node --test tests/<novos>.test.ts` e `tests/icones.test.ts` antes do PR; CI verde.

## Review Focus

- Código de suporte reaproveitado por duas barracas diferentes ao mesmo tempo (colisão do hash) — índice único em `codigo_hash` garante que isso nunca aconteça silenciosamente (erro de constraint em vez de resgate ambíguo); testar no PGlite.
- Acesso expirado ou revogado continuando a passar em `usuario_tem_acesso_barraca` por um erro de comparação de data/hora (`expira_em > now()` vs `>=`, fuso) — testar com acesso já expirado e já revogado explicitamente.
- Conta fora da allowlist conseguindo resgatar por engano (ou a allowlist vazando quem está nela via mensagem de erro diferente) — testar explicitamente que o erro é idêntico pra "não autorizado" e "código inválido".
- Dono de OUTRA barraca encerrando ou vendo o acesso de suporte de uma barraca que não é dele — testar isolamento multi-barraca no PGlite (mesmo padrão dos outros testes de RLS do repo).
- Rate limit: 5 tentativas erradas bloqueando a conta de suporte mesmo com código certo na 6ª tentativa, e o bloqueio expirando sozinho depois do intervalo — testar os dois lados (bloqueia e desbloqueia).

---

### Task 1: Lib pura — formato do código e data curta

**Files:**
- Create: `src/lib/acessoSuporte.ts`
- Test: `tests/acessoSuporte.test.ts`
- Modify: `src/lib/datas.ts` (nova função, sem mudar as existentes)

**Interfaces:**
- Produces: `ALFABETO_CODIGO_SUPORTE: string` (constante, sem `0OIl1`); `normalizarCodigoSuporte(input: string): string` (maiúsculas, remove espaços/traços); `formatoCodigoSuporteValido(codigo: string): boolean` (8 chars, só alfabeto); `formatarDataCurta(data: Date): string` → `"DD/MM"` em `src/lib/datas.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ALFABETO_CODIGO_SUPORTE, normalizarCodigoSuporte, formatoCodigoSuporteValido } from '../src/lib/acessoSuporte.ts'
import { formatarDataCurta } from '../src/lib/datas.ts'

test('alfabeto não tem 0, O, 1, I', () => {
  for (const c of '0O1I') assert.ok(!ALFABETO_CODIGO_SUPORTE.includes(c))
  assert.equal(ALFABETO_CODIGO_SUPORTE.length, new Set(ALFABETO_CODIGO_SUPORTE).size)
})

test('normaliza maiúsculas e remove espaços/traços', () => {
  assert.equal(normalizarCodigoSuporte(' ab-cd 2345 '), 'ABCD2345')
})

test('formato válido só com 8 caracteres do alfabeto', () => {
  assert.equal(formatoCodigoSuporteValido('ABCD2345'), true)
  assert.equal(formatoCodigoSuporteValido('ABCD234'), false) // 7
  assert.equal(formatoCodigoSuporteValido('ABCD23456'), false) // 9
  assert.equal(formatoCodigoSuporteValido('ABCD023I'), false) // caractere fora do alfabeto
})

test('data curta DD/MM', () => {
  assert.equal(formatarDataCurta(new Date('2026-03-05T12:00:00Z')), '05/03')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/acessoSuporte.test.ts"`
Expected: FAIL (módulos não existem / função não existe)

- [ ] **Step 3: Implement**

`src/lib/acessoSuporte.ts`: `ALFABETO_CODIGO_SUPORTE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` (mesmo alfabeto de `ia_gerar_codigo`, sem repetir 0/O/1/I); `normalizarCodigoSuporte` faz `.toUpperCase()` + remove tudo que não é do alfabeto (`replace(/[^A-Z0-9]/g, '')` antes de filtrar, ou regex direta contra o alfabeto); `formatoCodigoSuporteValido` testa `^[alfabeto]{8}$`. `formatarDataCurta` em `datas.ts`: `String(dia).padStart(2,'0') + '/' + String(mes).padStart(2,'0')`, hora em UTC (mesmo padrão de `formatarDataISO` nesse arquivo — ver como ele lê `getUTC*` ou local antes de decidir).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "tests/acessoSuporte.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/acessoSuporte.ts src/lib/datas.ts tests/acessoSuporte.test.ts
git commit -m "feat(suporte): formato do código de acesso e data curta"
```

### Task 2: Migration — schema, RLS e funções

**Files:**
- Create: `supabase/migrations/20261023100000_acesso_suporte.sql`

**Interfaces:**
- Produces (chamáveis pelo front, Tasks 6-9): `suporte_gerar_codigo(p_barraca_id uuid) returns jsonb` (`{estado:'ok', codigo, expira_em}` | `{estado:'sem_acesso'}`); `suporte_resgatar_codigo(p_codigo text) returns jsonb` (`{estado:'ok', barraca_id, slug, nome, expira_em}` | `{estado:'codigo_invalido'}` | `{estado:'bloqueado', ate}` | `{estado:'nao_autenticado'}`); `suporte_encerrar_acesso(p_acesso_id uuid) returns jsonb` (`{estado:'ok'}` | `{estado:'sem_acesso'}` | `{estado:'nao_encontrado'}`); `suporte_meu_acesso(p_barraca_id uuid) returns jsonb` (`{ativo:boolean, expira_em: text|null}`); `suporte_minhas_barracas() returns table(barraca_id uuid, nome text, slug text, logo_url text, expira_em timestamptz)`.
- Modifica (preserva assinatura e comportamento original, só acrescenta): `usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean`.

- [ ] **Step 1: Escrever a migration**

Estrutura (nessa ordem, um `create table if not exists` por tabela):

```sql
-- usuarios_suporte: allowlist. Sem policy nenhuma pro cliente — só leitura interna
-- das funções SECURITY DEFINER. Inclusão é manual por SQL (o dono do projeto).
create table if not exists public.usuarios_suporte (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_suporte enable row level security;

create table if not exists public.codigos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  usado_por uuid references auth.users(id),
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);
create unique index if not exists codigos_suporte_hash_idx on public.codigos_suporte (codigo_hash);
alter table public.codigos_suporte enable row level security;
-- sem nenhuma policy de select/insert/update pro cliente: só por RPC (ninguém lê o hash).

create table if not exists public.acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  usuario_suporte_id uuid not null references auth.users(id),
  concedido_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  codigo_id uuid not null references public.codigos_suporte(id)
);
alter table public.acessos_suporte enable row level security;

create policy "dono ve acessos de suporte da propria loja" on public.acessos_suporte
for select
using (exists (
  select 1 from public.usuarios_barracas ub
  where ub.barraca_id = acessos_suporte.barraca_id and ub.usuario_id = auth.uid() and ub.papel = 'dono'
));

create table if not exists public.suporte_tentativas (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  tentativas integer not null default 0,
  bloqueado_ate timestamptz
);
alter table public.suporte_tentativas enable row level security;
```

Depois as funções, cada uma com `revoke all on function ... from public, anon, authenticated;` seguido do `grant execute ... to authenticated` (nenhuma vai pra `anon`). `suporte_gerar_codigo` e `suporte_encerrar_acesso` checam `papel = 'dono'` (mesmo padrão de `apagar_barraca.sql`) antes de qualquer coisa. `suporte_gerar_codigo` gera o código com o mesmo laço de `ia_gerar_codigo()` (alfabeto de `acessoSuporte.ts`, repetido em SQL — PL/pgSQL não importa TS), guarda só `encode(digest(v_codigo, 'sha256'), 'hex')`, devolve o texto puro UMA vez. `suporte_resgatar_codigo`: normaliza igual ao front (`upper`, remove não-alfabeto — repetir a mesma regra em SQL), confere allowlist e bloqueio ANTES de gastar uma tentativa à toa, busca por `codigo_hash = encode(digest(v_codigo,'sha256'),'hex') and expira_em > now() and usado_em is null`; sucesso: marca `usado_em`/`usado_por`, insere em `acessos_suporte` com `expira_em = now() + interval '7 days'`, zera tentativas, devolve dados da barraca; falha: incrementa `suporte_tentativas` (upsert), bloqueia 10 minutos na 5ª, sempre devolve `{estado:'codigo_invalido'}` tanto pra "fora da allowlist" quanto pra "código não casou" (nunca revela qual dos dois). `usuario_tem_acesso_barraca`: `create or replace`, corpo original + `or exists (select 1 from acessos_suporte where usuario_suporte_id = auth.uid() and barraca_id = p_barraca_id and expira_em > now() and revogado_em is null)`.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20261023100000_acesso_suporte.sql
git commit -m "feat(suporte): migration de acesso do suporte (tabelas, RLS, RPCs)"
```

### Task 3: Teste de banco (PGlite) da migration inteira

**Files:**
- Create: `tests/acessoSuporteMigration.test.ts`

**Interfaces:**
- Consumes: Task 2 (migration completa), mesmo bootstrap de `tests/iaLigarMigration.test.ts` (roles `authenticated`/`anon`, stub de `auth.uid()`, tabelas `barracas`/`usuarios_barracas` e a função original de `usuario_tem_acesso_barraca` ANTES de rodar a migration real por cima, pra provar que o `create or replace` preserva o comportamento velho). Fixtures de teste (forçar código expirado, zerar bloqueio) rodam como o superusuário padrão do PGlite, não como uma role dedicada — o PGlite não dá bypass de RLS pra uma role criada à mão sem privilégio explícito.

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const B1 = 'b1000000-0000-4000-8000-000000000001'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const SUPORTE_OK = 'a2000000-0000-4000-8000-000000000002'
const SUPORTE_FORA = 'a3000000-0000-4000-8000-000000000003'

let db: PGlite
async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create extension pgcrypto;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean language sql stable security definer set search_path to 'public','pg_temp'
      as $$ select exists(select 1 from usuarios_barracas where barraca_id = p_barraca_id and usuario_id = auth.uid()) $$;
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1');
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono');
  `)
  await db.exec(sql('20261023100000_acesso_suporte.sql'))
  await db.exec('reset role') // volta pro superusuário padrão do PGlite
  await db.exec(`insert into public.usuarios_suporte (usuario_id) values ('${SUPORTE_OK}')`)
})

after(async () => { await db.close() })

async function gerar(uid: string) {
  await como(uid)
  return (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_gerar_codigo($1) as r`, [B1])).rows[0].r
}
async function resgatar(uid: string, codigo: string) {
  await como(uid)
  return (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_resgatar_codigo($1) as r`, [codigo])).rows[0].r
}

describe('acesso do suporte', () => {
  test('só o dono gera código; outra conta recebe sem_acesso', async () => {
    assert.equal((await gerar(SUPORTE_FORA)).estado, 'sem_acesso')
    const r = await gerar(DONO)
    assert.equal(r.estado, 'ok')
    assert.match(r.codigo as string, /^[A-HJKMNP-Z2-9]{8}$/)
  })

  test('conta fora da allowlist e código errado dão o MESMO erro genérico', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    const foraDaLista = await resgatar(SUPORTE_FORA, codigo)
    const codigoErrado = await resgatar(SUPORTE_OK, 'ZZZZZZZZ')
    assert.deepEqual(foraDaLista, { estado: 'codigo_invalido' })
    assert.deepEqual(codigoErrado, { estado: 'codigo_invalido' })
  })

  test('allowlist resgata com sucesso e ganha acesso por 7 dias; usuario_tem_acesso_barraca passa a ser true', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await como(SUPORTE_OK)
    assert.equal(
      (await db.query<{ v: boolean }>(`select public.usuario_tem_acesso_barraca($1) as v`, [B1])).rows[0].v,
      false,
    )
    const r = await resgatar(SUPORTE_OK, codigo)
    assert.equal(r.estado, 'ok')
    assert.equal(r.barraca_id, B1)
    assert.equal(
      (await db.query<{ v: boolean }>(`select public.usuario_tem_acesso_barraca($1) as v`, [B1])).rows[0].v,
      true,
    )
  })

  test('código já usado não resgata de novo (uso único)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('código expirado não resgata', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await db.exec('reset role')
    await db.exec(`update public.codigos_suporte set expira_em = now() - interval '1 minute' where codigo_hash = encode(digest('${codigo}','sha256'),'hex')`)
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('5 tentativas erradas bloqueiam; código certo na 6ª ainda falha', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    for (let i = 0; i < 5; i++) await resgatar(SUPORTE_OK, 'ZZZZZZZZ')
    const r = await resgatar(SUPORTE_OK, codigo)
    assert.equal(r.estado, 'bloqueado')
  })

  test('dono encerra o acesso; usuario_tem_acesso_barraca volta a false; outro dono não pode encerrar', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    const resgate = await resgatar(SUPORTE_OK, codigo)
    await como(DONO)
    const lista = await db.query<{ id: string }>(`select id from public.acessos_suporte where barraca_id = $1`, [B1])
    const acessoId = lista.rows[0].id
    await como('aFFFFFFF-0000-4000-8000-00000000000f') // outro usuário, sem vínculo
    const negado = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(negado.estado, 'sem_acesso')
    await como(DONO)
    const ok = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(ok.estado, 'ok')
    await como(SUPORTE_OK)
    assert.equal(
      (await db.query<{ v: boolean }>(`select public.usuario_tem_acesso_barraca($1) as v`, [B1])).rows[0].v,
      false,
    )
  })

  test('suporte_meu_acesso e suporte_minhas_barracas refletem o acesso ativo', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await resgatar(SUPORTE_OK, codigo)
    await como(SUPORTE_OK)
    const meu = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_meu_acesso($1) as r`, [B1])).rows[0].r
    assert.equal(meu.ativo, true)
    const minhas = await db.query(`select * from public.suporte_minhas_barracas()`)
    assert.equal(minhas.rows.length, 1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "tests/acessoSuporteMigration.test.ts"`
Expected: FAIL (migration ainda não existe — ver Task 2; se a Task 2 já estiver feita, rodar ANTES de escrever a migration pra confirmar que falha por função inexistente, depois a Task 2 fica "verde" quando esta Task 3 passar)

- [ ] **Step 3: Run tests to verify they pass (depois da Task 2 implementada)**

Run: `node --test "tests/acessoSuporteMigration.test.ts"`
Expected: PASS — todos os `describe` acima

- [ ] **Step 4: Commit**

```bash
git add tests/acessoSuporteMigration.test.ts
git commit -m "test(suporte): cobertura PGlite da migration de acesso do suporte"
```

### Task 4: Aplicar e testar em STAGING (transação + rollback), nunca produção

**Files:** nenhum arquivo novo — validação operacional.

- [ ] **Step 1: Rodar a migration em staging dentro de uma transação, conferir, dar rollback**

```bash
npx supabase db query --linked --project-ref qzcqwovbbylqxljcrqhk -f - <<'EOF'
begin;
-- colar o conteúdo de supabase/migrations/20261023100000_acesso_suporte.sql aqui
select proname from pg_proc where proname like 'suporte_%'; -- confirma que as funções existem
rollback;
EOF
```

Expected: a query de conferência lista as 5 funções novas; o `rollback` garante que staging não fica com a mudança aplicada de verdade nesta etapa de teste (a aplicação real pro staging, se o dono quiser, é outro passo manual dele — `supabase db push` precisa de Docker, que não está disponível neste ambiente).

- [ ] **Step 2: Registrar no PR que a migration foi validada só por transação+rollback em staging, não por `db push` (Docker indisponível aqui)**

### Task 5: GateSenhaAdmin pula o PIN com acesso de suporte ativo

**Files:**
- Modify: `src/components/GateSenhaAdmin.tsx`

**Interfaces:**
- Consumes: RPC `suporte_meu_acesso(p_barraca_id)` (Task 2) → `{ativo: boolean, expira_em: string | null}`.

- [ ] **Step 1: Implementar**

Novo estado inicial `'verificando_suporte'` antes de `'verificando'`: chama `supabase.rpc('suporte_meu_acesso', { p_barraca_id: barracaId })`; se `data?.ativo`, vai direto pra `'liberado'` (sem marcar `sessionStorage` — a cada carga confere de novo, já que o acesso pode ter sido encerrado); se não, cai no fluxo atual (`'verificando'` → `senha_admin_configurada`). Erro na chamada (offline etc.) não trava: cai no fluxo atual também, fail-open pro fluxo que já existia (nunca fail-open pra "liberado" por erro).

- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.app.json` e `npx eslint src/components/GateSenhaAdmin.tsx`**

Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/components/GateSenhaAdmin.tsx
git commit -m "feat(suporte): GateSenhaAdmin pula o PIN com acesso de suporte ativo"
```

### Task 6: `useBarracasDoUsuario` inclui barracas de suporte ativas

**Files:**
- Modify: `src/hooks/useBarracasDoUsuario.ts`

**Interfaces:**
- Consumes: RPC `suporte_minhas_barracas()` (Task 2).
- Produces: `BarracaComPapel.papel` pode valer `'suporte'`; novo campo opcional `expiraEmSuporte?: string` no mesmo tipo, usado pelas Tasks 8/9.

- [ ] **Step 1: Implementar**

Em `buscarBarracasDoUsuario`, além da query atual, chamar `supabase.rpc('suporte_minhas_barracas')` em paralelo (`Promise.all`); mapear o resultado pra `BarracaComPapel` com `papel: 'suporte'` e `expiraEmSuporte` preenchido; concatenar com o resultado de `usuarios_barracas` (uma barraca nunca deveria aparecer nas duas listas ao mesmo tempo — suporte não ganha linha em `usuarios_barracas` — mas se acontecer, priorizar a entrada normal: `dedupe por barraca_id, usuarios_barracas primeiro`). Erro na chamada de suporte não derruba a lista principal (local independente, `error` ignorado/logado, não propaga pro `erro` do hook).

- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.app.json`**

Expected: sem erros (checar os outros 8 arquivos que usam `useBarracasDoUsuario`/`BarracaComPapel` — nenhum deveria quebrar por campo opcional novo).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useBarracasDoUsuario.ts
git commit -m "feat(suporte): barracas com acesso de suporte ativo entram na lista do usuário"
```

### Task 7: "Tenho um código de suporte" em Selecionar barraca

**Files:**
- Modify: `src/pages/SelecionarBarraca.tsx`

**Interfaces:**
- Consumes: RPC `suporte_resgatar_codigo(p_codigo)` (Task 2); `normalizarCodigoSuporte`/`formatoCodigoSuporteValido` (Task 1).

- [ ] **Step 1: Implementar**

Campo/botão "Tenho um código de suporte" (abre um `BottomSheet` simples, reaproveitando `Input`/`Button` já importados nessa tela) tanto no estado vazio (`barracas.length === 0`) quanto na lista normal. Ao confirmar: normaliza, valida formato localmente (mensagem imediata se não bate o formato, sem round-trip), chama a RPC; `estado === 'ok'` → `await recarregar()` (pra lista já trazer a barraca nova via Task 6) → `navigate('/'+slug)`; `codigo_invalido` → "Código inválido ou expirado"; `bloqueado` → "Muitas tentativas. Tente de novo em alguns minutos."; `nao_autenticado` não deveria acontecer aqui (tela já exige login), tratar como erro genérico.

- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.app.json` e `npx eslint src/pages/SelecionarBarraca.tsx`**

Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/pages/SelecionarBarraca.tsx
git commit -m "feat(suporte): resgatar código de suporte em Selecionar barraca"
```

### Task 8: Faixas fixas em LayoutBarraca

**Files:**
- Create: `src/components/FaixaSuporte.tsx` (duas variantes: visão do suporte, visão do dono)
- Modify: `src/layouts/LayoutBarraca.tsx`

**Interfaces:**
- Consumes: `useBarracasDoUsuario` (Task 6, pro lado do suporte — já tem `papel`/`expiraEmSuporte` sem round-trip extra); select direto em `acessos_suporte` filtrando `barraca_id` e `revogado_em is null and expira_em > now()` (RLS já restringe a dono) pro lado do dono; `suporte_encerrar_acesso` (Task 2) pro botão "Encerrar"; `formatarDataCurta` (Task 1).

- [ ] **Step 1: Implementar**

Mesmo padrão visual de `BannerTrial.tsx` (`min-h-11 w-full`, cor neutra pra não competir com mostarda — isto não é CTA de conversão). `FaixaSuporte` variant `'suporte'`: "Você está como SUPORTE nesta loja até {formatarDataCurta}" (lido de `barracasDoUsuario.find(b => b.barraca_id === barraca.id)`, sem chamada nova). Variant `'dono'`: busca acessos ativos (useEffect simples, mesmo padrão de outros hooks do arquivo), se houver algum mostra "Suporte com acesso até {data} [Encerrar]"; `onClick` do botão chama `suporte_encerrar_acesso` e remove da lista local em caso de sucesso. Em `LayoutBarraca.tsx`, renderizar ao lado de `BannerTrial` (antes do `Outlet`, mesmo nível).

- [ ] **Step 2: `npx tsc --noEmit -p tsconfig.app.json` e `npx eslint src/components/FaixaSuporte.tsx src/layouts/LayoutBarraca.tsx`**

Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/components/FaixaSuporte.tsx src/layouts/LayoutBarraca.tsx
git commit -m "feat(suporte): faixas fixas de acesso de suporte (suporte e dono)"
```

### Task 9: Seção "Acesso do suporte" em Ajustes (só dono)

**Files:**
- Create: `src/components/SecaoAcessoSuporte.tsx`
- Modify: `src/pages/Ajustes.tsx`

**Interfaces:**
- Consumes: `suporte_gerar_codigo`, `suporte_encerrar_acesso` (Task 2); select em `acessos_suporte` (mesma lógica de leitura da Task 8, pode extrair um hook compartilhado `useAcessosSuporteAtivos(barracaId)` em vez de duplicar — ver Step 1).

- [ ] **Step 1: Implementar**

Extrair `useAcessosSuporteAtivos(barracaId)` (novo hook em `src/hooks/useAcessosSuporteAtivos.ts`) usado pela Task 8 (`FaixaSuporte` dono) e por esta seção, evita duplicar a query. `SecaoAcessoSuporte`: mesmo padrão de `ehDono` client-side de `EnderecoCardapio.tsx` — se não for dono, não renderiza nada (a RPC já barra no servidor; isto é só UX). Botão "Gerar código de suporte" → chama a RPC, mostra o código em destaque (fonte grande, copiável) + validade 24h + texto explicativo em português simples (literal do spec). Lista de acessos ativos (via o hook) com "até quando" e botão "Encerrar acesso agora" por linha.

- [ ] **Step 2: Inserir em Ajustes.tsx**

Dentro do grupo `conta`/`ajuda` (mesmo grupo de `SecaoAjudaSuporte`), logo depois dela: `<SecaoDaCategoria categoria="conta" grupo="ajuda" atual={categoria}><SecaoAcessoSuporte barraca={barraca} /></SecaoDaCategoria>`.

- [ ] **Step 3: `npx tsc --noEmit -p tsconfig.app.json` e `npx eslint src/components/SecaoAcessoSuporte.tsx src/hooks/useAcessosSuporteAtivos.ts src/pages/Ajustes.tsx src/components/FaixaSuporte.tsx`**

Expected: sem erros novos (reaproveitar o hook na Task 8 pode exigir reabrir aquele arquivo — tudo bem, mesma task de revisão).

- [ ] **Step 4: Commit**

```bash
git add src/components/SecaoAcessoSuporte.tsx src/hooks/useAcessosSuporteAtivos.ts src/pages/Ajustes.tsx src/components/FaixaSuporte.tsx
git commit -m "feat(suporte): seção Acesso do suporte em Ajustes > Conta"
```

### Task 10: Teste estático de ligação, CLAUDE.md e verificação final

**Files:**
- Create: `tests/acessoSuporteLigacao.test.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the failing test**

Mesmo estilo de `tests/secoesAjustes.test.ts` (regex sobre o texto-fonte, sem DOM): assert que `Ajustes.tsx` importa e renderiza `SecaoAcessoSuporte`; que `LayoutBarraca.tsx` importa e renderiza `FaixaSuporte`; que `GateSenhaAdmin.tsx` chama `suporte_meu_acesso`; que `SelecionarBarraca.tsx` chama `suporte_resgatar_codigo`.

- [ ] **Step 2: Run to verify it fails, then passes depois das Tasks 5-9**

Run: `node --test "tests/acessoSuporteLigacao.test.ts"`

- [ ] **Step 3: Atualizar CLAUDE.md**

Entrada curta em "Regras de produto" (abaixo da última): o que é, as 3 tabelas, que `usuario_tem_acesso_barraca` foi estendida, que suporte nunca tem linha em `usuarios_barracas` (por isso fica fora de tudo que é `papel = 'dono'`), que a allowlist começa vazia.

- [ ] **Step 4: Verificação final completa**

`npx tsc --noEmit -p tsconfig.app.json`; `npx eslint` em todos os arquivos tocados; `node --test tests/acessoSuporte.test.ts tests/acessoSuporteMigration.test.ts tests/acessoSuporteLigacao.test.ts tests/icones.test.ts`; `npm test` completo (conferir que a única falha continua sendo o CRLF conhecido do webhookCupom).

- [ ] **Step 5: Commit**

```bash
git add tests/acessoSuporteLigacao.test.ts CLAUDE.md
git commit -m "docs(suporte): CLAUDE.md e teste de ligação do acesso de suporte"
```
