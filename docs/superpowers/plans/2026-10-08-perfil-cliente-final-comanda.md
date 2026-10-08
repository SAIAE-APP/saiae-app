# Perfil do cliente final — plano de implementação (lado Comanda)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cliente final um perfil por loja (cadastro com telefone confirmado por código no WhatsApp, endereços, histórico, "pedir de novo", apagar dados), usado no fechamento do pedido do cardápio digital.

**Architecture:** Login próprio na Comanda: três edge functions públicas (`cliente-pedir-codigo`, `cliente-verificar-codigo`, `cliente-sessao`) sobre tabelas fechadas (`cliente_codigos`, `cliente_sessoes`) e a tabela existente `clientes_finais` evoluída para ser o perfil. O CRM só envia o código pelo modelo de autenticação da Meta (plano irmão: `2026-10-08-perfil-cliente-final-crm.md`). Obrigatoriedade no fechamento fica atrás de uma flag por barraca, desligada por padrão, para ligar só depois do teste.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind v4, Supabase (Postgres, RLS, edge functions Deno), `node --test` com arquivos `.ts`.

**Spec:** `docs/superpowers/specs/2026-10-08-perfil-cliente-final-design.md` (PR #69). Ler antes de começar.

## Desvios da spec (decididos ao escrever o plano)
1. **Sem `apagado_em`:** "Apagar meus dados" faz exclusão física (perfil, endereços, sessões, códigos) e anonimiza pedidos. Mais simples e mais fiel à LGPD. A Task 11 corrige a spec.
2. **Flags novas em `barracas`:** `perfil_cliente_obrigatorio` (default `false`) e `codigos_dia_max` (default 100). O dono liga a obrigatoriedade só depois do teste.
3. **Coluna `pagamentos_pendentes.cliente_id`:** o Pix cria o pedido depois (webhook), então o vínculo viaja pela cobrança pendente.
4. **RPC `perfil_cliente_config(slug)`** (anon): o front descobre se o perfil é obrigatório sem mexer na assinatura de `cardapio_publico`.

## Global Constraints
- Nada em produção nem em staging sem o dono pedir; migrations só aditivas e reversíveis; testar no staging antes (`docs/staging.md`; nunca `--linked` na pasta do dono, ela aponta para a produção).
- Cada frente só edita o próprio repositório; contrato muda só por PR aprovado pelas duas frentes.
- Telefone só com dígitos e sem o 55 do país (`normalizarTelefone`): com 10 ou 11 dígitos o "55" é o DDD de Santa Maria/RS.
- Código de 6 dígitos, validade 5 min, uso único, máx. 5 tentativas; limites: 3 códigos/telefone/hora, 10/IP/hora, `codigos_dia_max` por loja em 24 h, reenvio só após 60 s.
- Sessão do cliente: token opaco de 32 bytes, 30 dias, **só o hash** (HMAC com `CLIENTE_HASH_PEPPER`) no banco; código também só em hash.
- Nunca registrar em log código, token, telefone completo ou corpo de pedido de código.
- Resposta de `cliente-pedir-codigo` idêntica para telefone novo ou já cadastrado.
- UI: identidade Sai aê (um primário mostarda por tela, texto sobre mostarda sempre tinta, toque ≥ 44 px, selos em canto balão, mobile-first), sem cor escrita no componente (tokens em `src/styles/tokens.css`).
- Tabelas `cliente_codigos` e `cliente_sessoes`: RLS ligada, **sem policy**, sem grant para `anon`/`authenticated`.
- Lint: `npm run lint` com no máximo 13 warnings; `npx tsc -b` limpo; `npm test` verde.

## Review Focus
1. **Telefone sem DDD, com 55, com máscara ou texto** → recusa com mensagem clara; com 55+DDD+número entra normalizado (Task 1 e 4).
2. **Código digitado com espaço, traço ou colado com mais dígitos** → limpa para 6 dígitos ou recusa sem consumir tentativa extra (Task 5).
3. **Dois cliques em "verificar" ao mesmo tempo** → só uma sessão nasce, o código vale uma vez (Task 4, atualização condicional).
4. **Sessão expirada ou revogada no meio do fechamento** → o front volta à etapa do código sem perder o carrinho (Task 7 e 8).
5. **"Pedir de novo" com item esgotado, removido, com preço novo ou que tinha adicionais** → avisa antes e nunca monta carrinho errado em silêncio (Task 9).
6. **Perfil antigo (cadastro de entrega) com o mesmo telefone** → ao confirmar, assume o cadastro existente sem duplicar nem perder endereço (Task 2).
7. **Exclusão de dados com pedido de entrega já feito** → pedido fica anonimizado e a exclusão não falha por constraint (Task 2).

---

## File Structure
**Criar**
- `supabase/migrations/20261017100000_perfil_cliente_final.sql` — schema, RLS, RPCs.
- `supabase/functions/_shared/telefone.ts` — normalização/validação de telefone (Deno e Node).
- `supabase/functions/_shared/clienteCodigo.ts` — código, hash, avaliação, limites, sessão válida (funções puras).
- `supabase/functions/_shared/codigoCrm.ts` — chamada assinada ao CRM.
- `supabase/functions/_shared/clienteSessao.ts` — autenticar token de sessão.
- `supabase/functions/cliente-pedir-codigo/index.ts`
- `supabase/functions/cliente-verificar-codigo/index.ts`
- `supabase/functions/cliente-sessao/index.ts`
- `src/lib/clienteSessaoLocal.ts` — token no aparelho (puro, sem imports: testável no Node).
- `src/lib/clienteApi.ts` — chamadas às functions (usa o arquivo acima).
- `src/lib/clientePerfil.ts` — validações e "pedir de novo" (puros).
- `src/hooks/useClienteSessao.ts`
- `src/components/cliente/ModalIdentificacao.tsx` — etapas dados e código.
- `src/pages/PerfilCliente.tsx` — rota `/:slug/perfil`.
- `tests/clienteTelefone.test.ts`, `tests/clienteCodigo.test.ts`, `tests/codigoCrm.test.ts`, `tests/perfilClienteMigration.test.ts`, `tests/clientePerfil.test.ts`
- `docs/perfil-cliente.md` — operação, secrets, rollout.

**Modificar**
- `supabase/functions/criar-pedido-cardapio/index.ts`, `supabase/functions/criar-pagamento-pix/index.ts`, `supabase/functions/webhook-mercadopago/index.ts` — vincular `cliente_id`, exigir perfil quando a flag estiver ligada.
- `src/pages/CardapioPublico.tsx` — gate no fechamento e link "Entrar/Meu perfil".
- `src/App.tsx` — rota `/:slug/perfil`.
- `src/types/database.ts`, `src/lib/clientesFinais.ts`, `src/components/SecaoClientesEntrega.tsx` — tela "Clientes" do dono.
- `INTEGRACAO.md` — addendum do endpoint de código.

---

### Task 1: Telefone e código (funções puras, testadas)

**Files:**
- Create: `supabase/functions/_shared/telefone.ts`
- Create: `supabase/functions/_shared/clienteCodigo.ts`
- Test: `tests/clienteTelefone.test.ts`, `tests/clienteCodigo.test.ts`

**Interfaces:**
- Produces: `normalizarTelefone(texto): string`, `telefoneValido(texto): boolean`, `limparCodigo(texto): string | null`, `gerarCodigo(): string`, `hashSegredo(pimenta, escopo, valor): Promise<string>`, `gerarTokenSessao(): string`, `iguaisConstante(a, b): boolean`, `avaliarCodigo(reg, hashInformado, agora): DecisaoCodigo`, `decidirLimites(e): DecisaoLimite`, `sessaoValida(reg, agora): boolean`, constantes `VALIDADE_CODIGO_MS`, `MAX_TENTATIVAS`, `VALIDADE_SESSAO_MS`, `REENVIO_MIN_MS`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/clienteTelefone.test.ts`:
```ts
// Telefone do cliente final (servidor e app usam a mesma regra). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizarTelefone, telefoneValido } from '../supabase/functions/_shared/telefone.ts'

describe('normalizarTelefone', () => {
  test('tira máscara e o 55 quando sobram 12 ou 13 dígitos', () => {
    assert.equal(normalizarTelefone('+55 (61) 99953-1848'), '61999531848')
    assert.equal(normalizarTelefone('556133334444'), '6133334444')
  })
  test('com 10 ou 11 dígitos o 55 é o DDD de Santa Maria e fica', () => {
    assert.equal(normalizarTelefone('55 99999-1234'), '55999991234')
  })
})

describe('telefoneValido', () => {
  test('aceita fixo (10) e celular (11) com DDD', () => {
    assert.equal(telefoneValido('(61) 99953-1848'), true)
    assert.equal(telefoneValido('6133334444'), true)
  })
  test('recusa sem DDD, curto, longo e texto', () => {
    for (const t of ['99953-1848', '', 'abc', '123456789012345', '5561']) assert.equal(telefoneValido(t), false, t)
  })
})
```

`tests/clienteCodigo.test.ts`:
```ts
// Código de verificação, sessão e limites do perfil do cliente. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  MAX_TENTATIVAS,
  REENVIO_MIN_MS,
  VALIDADE_CODIGO_MS,
  VALIDADE_SESSAO_MS,
  avaliarCodigo,
  decidirLimites,
  gerarCodigo,
  gerarTokenSessao,
  hashSegredo,
  iguaisConstante,
  limparCodigo,
  sessaoValida,
} from '../supabase/functions/_shared/clienteCodigo.ts'

describe('gerarCodigo', () => {
  test('sempre 6 dígitos, inclusive com zeros à esquerda', () => {
    for (let i = 0; i < 2000; i++) assert.match(gerarCodigo(), /^\d{6}$/)
  })
  test('não repete sempre o mesmo valor', () => {
    const vistos = new Set(Array.from({ length: 200 }, gerarCodigo))
    assert.ok(vistos.size > 150)
  })
})

describe('limparCodigo', () => {
  test('aceita espaço, traço e ponto; recusa o que não é 6 dígitos', () => {
    assert.equal(limparCodigo('123 456'), '123456')
    assert.equal(limparCodigo('123-456'), '123456')
    for (const t of ['12345', '1234567', 'abcdef', '', null, undefined]) assert.equal(limparCodigo(t as string), null, String(t))
  })
})

describe('hashSegredo', () => {
  test('determinístico e dependente de pimenta, escopo e valor', async () => {
    const a = await hashSegredo('p', 'codigo', '123456')
    assert.equal(a, await hashSegredo('p', 'codigo', '123456'))
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.notEqual(a, await hashSegredo('outra', 'codigo', '123456'))
    assert.notEqual(a, await hashSegredo('p', 'sessao', '123456'))
    assert.notEqual(a, await hashSegredo('p', 'codigo', '123457'))
  })
})

describe('gerarTokenSessao', () => {
  test('43 caracteres url-safe e únicos', () => {
    const a = gerarTokenSessao()
    assert.match(a, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(a, gerarTokenSessao())
  })
})

describe('iguaisConstante', () => {
  test('compara igualdade e tamanho', () => {
    assert.equal(iguaisConstante('abc', 'abc'), true)
    assert.equal(iguaisConstante('abc', 'abd'), false)
    assert.equal(iguaisConstante('abc', 'abcd'), false)
  })
})

describe('avaliarCodigo', () => {
  const agora = Date.parse('2026-10-08T12:00:00Z')
  const base = { codigo_hash: 'h', usado_em: null, tentativas: 0, expira_em: new Date(agora + 60_000).toISOString() }
  test('ok', () => assert.equal(avaliarCodigo(base, 'h', agora), 'ok'))
  test('incorreto', () => assert.equal(avaliarCodigo(base, 'x', agora), 'incorreto'))
  test('expirado', () => assert.equal(avaliarCodigo({ ...base, expira_em: new Date(agora - 1).toISOString() }, 'h', agora), 'expirado'))
  test('usado vale uma vez só', () => assert.equal(avaliarCodigo({ ...base, usado_em: new Date(agora).toISOString() }, 'h', agora), 'usado'))
  test('excedido mesmo com o código certo', () => assert.equal(avaliarCodigo({ ...base, tentativas: MAX_TENTATIVAS }, 'h', agora), 'excedido'))
})

describe('decidirLimites', () => {
  const e = { pedidosTelefoneHora: 0, pedidosIpHora: 0, enviosLoja24h: 0, tetoLoja: 100, msDesdeUltimoEnvio: null as number | null }
  test('ok', () => assert.equal(decidirLimites(e), 'ok'))
  test('muito cedo', () => assert.equal(decidirLimites({ ...e, msDesdeUltimoEnvio: REENVIO_MIN_MS - 1 }), 'muito_cedo'))
  test('após 60 s libera', () => assert.equal(decidirLimites({ ...e, msDesdeUltimoEnvio: REENVIO_MIN_MS }), 'ok'))
  test('telefone: 3 por hora', () => assert.equal(decidirLimites({ ...e, pedidosTelefoneHora: 3 }), 'limite_telefone'))
  test('ip: 10 por hora', () => assert.equal(decidirLimites({ ...e, pedidosIpHora: 10 }), 'limite_ip'))
  test('loja: teto diário', () => assert.equal(decidirLimites({ ...e, enviosLoja24h: 100 }), 'limite_loja'))
  test('teto zero desliga o envio', () => assert.equal(decidirLimites({ ...e, tetoLoja: 0 }), 'limite_loja'))
})

describe('sessaoValida', () => {
  const agora = Date.parse('2026-10-08T12:00:00Z')
  test('valida, expirada e revogada', () => {
    assert.equal(sessaoValida({ expira_em: new Date(agora + VALIDADE_SESSAO_MS).toISOString(), revogada_em: null }, agora), true)
    assert.equal(sessaoValida({ expira_em: new Date(agora - 1).toISOString(), revogada_em: null }, agora), false)
    assert.equal(sessaoValida({ expira_em: new Date(agora + 1000).toISOString(), revogada_em: new Date(agora).toISOString() }, agora), false)
  })
  test('validade do código é 5 min', () => assert.equal(VALIDADE_CODIGO_MS, 300_000))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/clienteTelefone.test.ts tests/clienteCodigo.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`supabase/functions/_shared/telefone.ts`:
```ts
// Telefone do cliente final: mesma regra do app (src/lib/entrega.ts) e do trigger do banco.

export function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '')
}

/** Só dígitos, sem o 55 do país (só sai com 12 ou 13 dígitos: com 10/11 o 55 é o DDD de Santa Maria/RS). */
export function normalizarTelefone(texto: string): string {
  const d = somenteDigitos(texto)
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
}

/** Telefone brasileiro com DDD: 10 (fixo) ou 11 (celular) dígitos. WhatsApp internacional fica fora desta versão. */
export function telefoneValido(texto: string): boolean {
  const d = normalizarTelefone(texto)
  return d.length === 10 || d.length === 11
}
```

`supabase/functions/_shared/clienteCodigo.ts`:
```ts
// Código de verificação, sessão e limites do perfil do cliente final. Funções puras (Deno e Node).

export const CODIGO_DIGITOS = 6
export const VALIDADE_CODIGO_MS = 5 * 60 * 1000
export const MAX_TENTATIVAS = 5
export const REENVIO_MIN_MS = 60 * 1000
export const VALIDADE_SESSAO_MS = 30 * 24 * 60 * 60 * 1000
export const LIMITE_TELEFONE_HORA = 3
export const LIMITE_IP_HORA = 10

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 6 dígitos uniformes (rejeição para não enviesar), com zeros à esquerda. */
export function gerarCodigo(): string {
  const limite = 4294967296 - (4294967296 % 1_000_000)
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limite)
  return String(buf[0] % 1_000_000).padStart(CODIGO_DIGITOS, '0')
}

/** Aceita "123 456", "123-456" e "123.456"; qualquer outra coisa que não seja 6 dígitos vira null. */
export function limparCodigo(texto: string | null | undefined): string | null {
  const limpo = String(texto ?? '').replace(/[\s.-]/g, '')
  return /^\d{6}$/.test(limpo) ? limpo : null
}

/** HMAC-SHA256 em hex de `${escopo}:${valor}` com a pimenta do servidor. Nunca guardar o valor em claro. */
export async function hashSegredo(pimenta: string, escopo: string, valor: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', encoder.encode(pimenta), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', chave, encoder.encode(`${escopo}:${valor}`)))
}

/** 32 bytes aleatórios em base64url (43 caracteres). */
export function gerarTokenSessao(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Comparação em tempo constante (mesmo tamanho). */
export function iguaisConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type RegistroCodigo = { codigo_hash: string; usado_em: string | null; tentativas: number; expira_em: string }
export type DecisaoCodigo = 'ok' | 'expirado' | 'usado' | 'excedido' | 'incorreto'

/** Ordem: usado, expirado, excedido, incorreto. O chamador conta a tentativa só em 'incorreto'. */
export function avaliarCodigo(reg: RegistroCodigo, hashInformado: string, agora: number): DecisaoCodigo {
  if (reg.usado_em) return 'usado'
  if (agora > Date.parse(reg.expira_em)) return 'expirado'
  if (reg.tentativas >= MAX_TENTATIVAS) return 'excedido'
  return iguaisConstante(reg.codigo_hash, hashInformado) ? 'ok' : 'incorreto'
}

export type EntradaLimites = {
  pedidosTelefoneHora: number
  pedidosIpHora: number
  enviosLoja24h: number
  tetoLoja: number
  /** ms desde o último código enviado a este telefone nesta loja; null se nunca. */
  msDesdeUltimoEnvio: number | null
}
export type DecisaoLimite = 'ok' | 'muito_cedo' | 'limite_telefone' | 'limite_ip' | 'limite_loja'

export function decidirLimites(e: EntradaLimites): DecisaoLimite {
  if (e.tetoLoja <= 0 || e.enviosLoja24h >= e.tetoLoja) return 'limite_loja'
  if (e.msDesdeUltimoEnvio !== null && e.msDesdeUltimoEnvio < REENVIO_MIN_MS) return 'muito_cedo'
  if (e.pedidosTelefoneHora >= LIMITE_TELEFONE_HORA) return 'limite_telefone'
  if (e.pedidosIpHora >= LIMITE_IP_HORA) return 'limite_ip'
  return 'ok'
}

export function sessaoValida(reg: { expira_em: string; revogada_em: string | null }, agora: number): boolean {
  return !reg.revogada_em && Date.parse(reg.expira_em) > agora
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/clienteTelefone.test.ts tests/clienteCodigo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/telefone.ts supabase/functions/_shared/clienteCodigo.ts tests/clienteTelefone.test.ts tests/clienteCodigo.test.ts
git commit -m "feat(cliente): funções puras de telefone, código, sessão e limites"
```

---

### Task 2: Migration do perfil (schema, RLS, RPCs)

**Files:**
- Create: `supabase/migrations/20261017100000_perfil_cliente_final.sql`
- Test: `tests/perfilClienteMigration.test.ts`

**Interfaces:**
- Produces (SQL): colunas `clientes_finais.telefone_confirmado_em`, `aceita_avisos_pedido`; tabelas `cliente_enderecos`, `cliente_codigos`, `cliente_sessoes`; `pedidos.cliente_id`; `pagamentos_pendentes.cliente_id`; `barracas.perfil_cliente_obrigatorio`, `barracas.codigos_dia_max`; funções `cliente_registrar_verificado(p_barraca_id uuid, p_telefone text, p_nome text, p_aceita_promocoes boolean) returns uuid`, `cliente_apagar_dados(p_cliente_id uuid) returns void` (só o papel de serviço do servidor), `perfil_cliente_config(p_slug text) returns table (obrigatorio boolean)` (`anon`).

- [ ] **Step 1: Teste de texto da migration (falha)**

`tests/perfilClienteMigration.test.ts`:
```ts
// A migration do perfil precisa fechar as tabelas sensíveis e ser aditiva. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261017100000_perfil_cliente_final.sql', import.meta.url), 'utf8')

test('tabelas de código e sessão: RLS ligada e nenhum acesso para anon/authenticated', () => {
  for (const t of ['cliente_codigos', 'cliente_sessoes']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated`))
    assert.doesNotMatch(sql, new RegExp(`create policy[^;]*on public\\.${t}`))
  }
})

test('só o hash é guardado', () => {
  assert.match(sql, /codigo_hash text not null/)
  assert.match(sql, /token_hash text not null/)
  assert.doesNotMatch(sql, /\bcodigo text\b/)
})

test('funções sensíveis só para o papel de serviço; config pública para anon', () => {
  for (const f of ['cliente_registrar_verificado', 'cliente_apagar_dados']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`))
  }
  assert.match(sql, /grant execute on function public\.perfil_cliente_config\(text\) to anon/)
})

test('aditiva: nada de drop table, delete de dados nem truncate', () => {
  assert.doesNotMatch(sql, /drop table|truncate|drop column/i)
})

test('um endereço padrão por cliente', () => {
  assert.match(sql, /create unique index[^;]*cliente_enderecos[^;]*where padrao/i)
})

test('flags nascem desligadas', () => {
  assert.match(sql, /perfil_cliente_obrigatorio boolean not null default false/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/perfilClienteMigration.test.ts`
Expected: FAIL (arquivo não existe).

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261017100000_perfil_cliente_final.sql`:
```sql
-- Perfil do cliente final por loja (spec 2026-10-08). ADITIVA: colunas nullable ou com default,
-- tabelas novas, funções novas. App e functions antigas ignoram tudo isto.

-- 1) Flags por barraca (nascem desligadas).
alter table public.barracas
  add column if not exists perfil_cliente_obrigatorio boolean not null default false,
  add column if not exists codigos_dia_max integer not null default 100;
alter table public.barracas drop constraint if exists barracas_codigos_dia_max_valido;
alter table public.barracas
  add constraint barracas_codigos_dia_max_valido check (codigos_dia_max between 0 and 5000);

-- 2) clientes_finais vira o perfil. Endereço deixa de ser obrigatório (retirada não tem).
alter table public.clientes_finais
  add column if not exists telefone_confirmado_em timestamptz,
  add column if not exists aceita_avisos_pedido boolean not null default true;
alter table public.clientes_finais
  alter column rua drop not null,
  alter column numero drop not null,
  alter column bairro drop not null;

-- 3) Endereços (vários por cliente).
create table if not exists public.cliente_enderecos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes_finais(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  apelido text not null default 'Casa' check (char_length(apelido) between 1 and 30),
  rua text not null check (char_length(rua) between 1 and 120),
  numero text not null check (char_length(numero) between 1 and 20),
  bairro text not null check (char_length(bairro) between 1 and 80),
  referencia text check (referencia is null or char_length(referencia) <= 120),
  padrao boolean not null default false,
  criado_em timestamptz not null default now()
);
create unique index if not exists cliente_enderecos_um_padrao on public.cliente_enderecos (cliente_id) where padrao;
create index if not exists cliente_enderecos_cliente_idx on public.cliente_enderecos (cliente_id);
alter table public.cliente_enderecos enable row level security;
drop policy if exists "dono ve enderecos dos clientes da barraca" on public.cliente_enderecos;
create policy "dono ve enderecos dos clientes da barraca"
  on public.cliente_enderecos for select to authenticated
  using (usuario_tem_acesso_barraca(barraca_id));

-- Backfill: o endereço único que já existe vira o endereço padrão.
insert into public.cliente_enderecos (cliente_id, barraca_id, apelido, rua, numero, bairro, referencia, padrao)
select c.id, c.barraca_id, 'Casa', c.rua, c.numero, c.bairro, c.referencia, true
  from public.clientes_finais c
 where coalesce(c.rua, '') <> '' and coalesce(c.numero, '') <> '' and coalesce(c.bairro, '') <> ''
   and not exists (select 1 from public.cliente_enderecos e where e.cliente_id = c.id);

-- 4) Códigos de verificação (só hash; sem policy: só service role).
create table if not exists public.cliente_codigos (
  id uuid primary key default gen_random_uuid(),
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,11}$'),
  codigo_hash text not null,
  expira_em timestamptz not null,
  usado_em timestamptz,
  tentativas integer not null default 0,
  ip_hash text,
  criado_em timestamptz not null default now()
);
create index if not exists cliente_codigos_telefone_idx on public.cliente_codigos (barraca_id, telefone, criado_em desc);
create index if not exists cliente_codigos_ip_idx on public.cliente_codigos (ip_hash, criado_em desc);
create index if not exists cliente_codigos_loja_idx on public.cliente_codigos (barraca_id, criado_em desc);
alter table public.cliente_codigos enable row level security;
revoke all on table public.cliente_codigos from anon, authenticated;

-- 5) Sessões do cliente (só hash do token; sem policy).
create table if not exists public.cliente_sessoes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes_finais(id) on delete cascade,
  barraca_id uuid not null references public.barracas(id) on delete cascade,
  token_hash text not null,
  aparelho text check (aparelho is null or char_length(aparelho) <= 80),
  expira_em timestamptz not null,
  ultimo_uso_em timestamptz not null default now(),
  revogada_em timestamptz,
  criado_em timestamptz not null default now()
);
create unique index if not exists cliente_sessoes_token_idx on public.cliente_sessoes (token_hash);
create index if not exists cliente_sessoes_cliente_idx on public.cliente_sessoes (cliente_id);
alter table public.cliente_sessoes enable row level security;
revoke all on table public.cliente_sessoes from anon, authenticated;

-- 6) Vínculo do pedido com o cliente (histórico = consulta por cliente_id).
alter table public.pedidos add column if not exists cliente_id uuid references public.clientes_finais(id) on delete set null;
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id, criado_em desc) where cliente_id is not null;
alter table public.pagamentos_pendentes add column if not exists cliente_id uuid references public.clientes_finais(id) on delete set null;

-- 7) Criar/atualizar o perfil depois do código certo. Assume o cadastro de entrega que já existe.
create or replace function public.cliente_registrar_verificado(
  p_barraca_id uuid, p_telefone text, p_nome text, p_aceita_promocoes boolean
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.clientes_finais
    (barraca_id, nome, telefone, telefone_confirmado_em, consentimento_lgpd_em, consentimento_marketing_em)
  values
    (p_barraca_id, left(trim(p_nome), 80), p_telefone, now(), now(), case when p_aceita_promocoes then now() end)
  on conflict (barraca_id, telefone) do update set
    nome = left(trim(excluded.nome), 80),
    telefone_confirmado_em = now(),
    consentimento_lgpd_em = coalesce(public.clientes_finais.consentimento_lgpd_em, now()),
    consentimento_marketing_em = case
      when p_aceita_promocoes then coalesce(public.clientes_finais.consentimento_marketing_em, now())
      else null end,
    atualizado_em = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- 8) "Apagar meus dados": apaga perfil, endereços, sessões e códigos; anonimiza os pedidos.
create or replace function public.cliente_apagar_dados(p_cliente_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barraca uuid;
  v_telefone text;
begin
  select barraca_id, telefone into v_barraca, v_telefone from public.clientes_finais where id = p_cliente_id;
  if not found then
    return;
  end if;
  update public.pedidos
     set cliente_id = null, cliente_nome = null, cliente_telefone = null,
         entrega_nome = null, entrega_telefone = null, entrega_rua = null,
         entrega_numero = null, entrega_bairro = null, entrega_referencia = null
   where cliente_id = p_cliente_id;
  update public.pagamentos_pendentes set cliente_id = null where cliente_id = p_cliente_id;
  delete from public.cliente_codigos where barraca_id = v_barraca and telefone = v_telefone;
  delete from public.clientes_finais where id = p_cliente_id; -- sessões e endereços saem em cascata
end;
$$;

-- 9) O cardápio descobre se o perfil é obrigatório sem mudar `cardapio_publico`.
create or replace function public.perfil_cliente_config(p_slug text)
returns table (obrigatorio boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.perfil_cliente_obrigatorio from public.barracas b where b.slug = p_slug limit 1;
$$;

revoke all on function public.cliente_registrar_verificado(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cliente_registrar_verificado(uuid, text, text, boolean) to service_role;
revoke all on function public.cliente_apagar_dados(uuid) from public, anon, authenticated;
grant execute on function public.cliente_apagar_dados(uuid) to service_role;
revoke all on function public.perfil_cliente_config(text) from public;
grant execute on function public.perfil_cliente_config(text) to anon, authenticated;
```

- [ ] **Step 4: Rodar o teste de texto**

Run: `node --test tests/perfilClienteMigration.test.ts`
Expected: PASS.

- [ ] **Step 5: Aplicar no STAGING e conferir comportamento**

Run: `node scripts/staging.mjs push` (precisa do link da CLI = staging; ver `docs/staging.md`).
Expected: "Applying migration 20261017100000_perfil_cliente_final.sql" sem erro.
Depois, no staging, com `node scripts/staging.mjs` (ou `supabase db query --linked --project-ref qzcqwovbbylqxljcrqhk -f arquivo.sql`):
1. `select count(*) from cliente_enderecos;` igual ao número de clientes com endereço.
2. `select cliente_registrar_verificado(<barraca_teste_id>, '61999990001', 'Teste', true);` duas vezes: o mesmo id; só uma linha em `clientes_finais`.
3. Criar um pedido de entrega de teste com `cliente_id` desse perfil, rodar `select cliente_apagar_dados('<id>');` e confirmar que o pedido ficou com `cliente_id` nulo e `entrega_*` nulos **sem erro de constraint**. Se uma constraint reclamar de `entrega_*` nulo em pedido de entrega, ajustar a função para trocar por texto neutro (`'Cliente removido'`) e repetir.
4. Chamar `cliente_apagar_dados` como `anon` via REST deve falhar (permissão negada).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261017100000_perfil_cliente_final.sql tests/perfilClienteMigration.test.ts
git commit -m "feat(cliente): schema do perfil por loja (endereços, códigos, sessões, vínculo do pedido)"
```

---

### Task 3: Envio do código ao CRM (módulo e teste)

**Files:**
- Create: `supabase/functions/_shared/codigoCrm.ts`
- Test: `tests/codigoCrm.test.ts`

**Interfaces:**
- Consumes: `cabecalhosDoEvento(segredo, eventoId, timestamp, corpo)` e `urlPermitida(url)` de `supabase/functions/_shared/eventosSaida.ts`.
- Produces: `enviarCodigoAoCrm(args, fetchFn?): Promise<{ ok: true } | { ok: false; motivo: string }>`.

- [ ] **Step 1: Teste (falha)**

`tests/codigoCrm.test.ts`:
```ts
// Envio do código de verificação ao CRM: assinatura, corpo e tratamento de falhas. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import { enviarCodigoAoCrm } from '../supabase/functions/_shared/codigoCrm.ts'

const args = {
  url: 'https://crm.exemplo.com/api/integracao/comanda/v1/codigo-verificacao',
  segredo: 'segredo-de-teste-com-16+',
  barracaId: '11111111-1111-4111-8111-111111111111',
  telefone: '61999531848',
  codigo: '123456',
  requestId: '22222222-2222-4222-8222-222222222222',
}

describe('enviarCodigoAoCrm', () => {
  test('envia corpo assinado no padrão do contrato', async () => {
    let capturado: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      capturado = { url, init }
      return new Response('{"enviado":true}', { status: 200 })
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.deepEqual(r, { ok: true })
    const h = capturado!.init.headers as Record<string, string>
    const corpo = capturado!.init.body as string
    assert.deepEqual(JSON.parse(corpo), {
      barraca_id: args.barracaId, telefone: args.telefone, codigo: args.codigo, request_id: args.requestId,
    })
    assert.equal(h['X-Saiae-Event-Id'], args.requestId)
    const esperado = 'sha256=' + createHmac('sha256', args.segredo).update(`${h['X-Saiae-Timestamp']}.${corpo}`).digest('hex')
    assert.equal(h['X-Saiae-Signature'], esperado)
  })

  test('resposta não-2xx vira falha sem vazar o corpo', async () => {
    const fake = (async () => new Response('{"error":"telefone 6199..."}', { status: 422 })) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.motivo, 'CRM respondeu 422')
  })

  test('erro de rede vira falha', async () => {
    const fake = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.equal(r.ok, false)
  })

  test('URL que não é https público é recusada antes de enviar', async () => {
    let chamou = false
    const fake = (async () => {
      chamou = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm({ ...args, url: 'http://localhost:3000/x' }, fake)
    assert.equal(r.ok, false)
    assert.equal(chamou, false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/codigoCrm.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implementar**

`supabase/functions/_shared/codigoCrm.ts`:
```ts
// Pede ao CRM que envie o código de verificação pelo modelo de autenticação da Meta.
// Mesmo esquema de assinatura dos eventos (INTEGRACAO.md §2): X-Saiae-Event-Id/Timestamp/Signature.
import { cabecalhosDoEvento, urlPermitida } from './eventosSaida.ts'

export type EnvioCodigo = {
  url: string
  segredo: string
  barracaId: string
  telefone: string
  codigo: string
  requestId: string
}
export type ResultadoEnvio = { ok: true } | { ok: false; motivo: string }

const TIMEOUT_MS = 10_000

export async function enviarCodigoAoCrm(a: EnvioCodigo, fetchFn: typeof fetch = fetch): Promise<ResultadoEnvio> {
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const corpo = JSON.stringify({
    barraca_id: a.barracaId,
    telefone: a.telefone,
    codigo: a.codigo,
    request_id: a.requestId,
  })
  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const resposta = await fetchFn(a.url, {
      method: 'POST',
      headers: await cabecalhosDoEvento(a.segredo, a.requestId, timestamp, corpo),
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await resposta.body?.cancel()
    return resposta.status >= 200 && resposta.status < 300
      ? { ok: true }
      : { ok: false, motivo: `CRM respondeu ${resposta.status}` }
  } catch (e) {
    return { ok: false, motivo: `erro de rede: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/codigoCrm.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/codigoCrm.ts tests/codigoCrm.test.ts
git commit -m "feat(cliente): envio assinado do código de verificação ao CRM"
```

---

### Task 4: Edge functions `cliente-pedir-codigo` e `cliente-verificar-codigo`

**Files:**
- Create: `supabase/functions/cliente-pedir-codigo/index.ts`
- Create: `supabase/functions/cliente-verificar-codigo/index.ts`
- Create: `supabase/functions/_shared/clienteSessao.ts`

**Interfaces:**
- Consumes: Tasks 1 e 3, `pareceBot`/`ipDoCliente`/`hashIp` de `antiabuso.ts`.
- Produces: `POST cliente-pedir-codigo` `{ barraca_slug, nome, telefone, website?, ms_no_checkout? }` → `200 { ok: true, reenvio_em_s: 60 }` (e `codigo_simulado` só em staging com `CODIGO_SIMULADO=1`); `POST cliente-verificar-codigo` `{ barraca_slug, telefone, codigo, nome, aceita_promocoes?, aparelho? }` → `200 { token, expira_em, cliente: { id, nome, telefone } }` ou `400 { erro, tentativas_restantes? }`; `autenticarSessao(supabase, pimenta, barracaId, token): Promise<{ cliente_id: string; sessao_id: string } | null>`.
- Secrets das functions: `CLIENTE_HASH_PEPPER`, `CRM_CODIGO_URL`, `CRM_CODIGO_SEGREDO`, e (só staging) `CODIGO_SIMULADO=1`.

- [ ] **Step 1: Helper de sessão**

`supabase/functions/_shared/clienteSessao.ts`:
```ts
// Autentica o token de sessão do cliente final (nunca guardado em claro).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { hashSegredo, sessaoValida } from './clienteCodigo.ts'

export async function autenticarSessao(
  supabase: SupabaseClient,
  pimenta: string,
  barracaId: string,
  token: unknown,
): Promise<{ cliente_id: string; sessao_id: string } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const hash = await hashSegredo(pimenta, 'sessao', token)
  const { data } = await supabase
    .from('cliente_sessoes')
    .select('id, cliente_id, expira_em, revogada_em')
    .eq('token_hash', hash)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!data || !sessaoValida(data, Date.now())) return null
  await supabase.from('cliente_sessoes').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', data.id)
  return { cliente_id: data.cliente_id, sessao_id: data.id }
}
```

- [ ] **Step 2: `cliente-pedir-codigo`**

`supabase/functions/cliente-pedir-codigo/index.ts`:
```ts
// Pede um código de verificação por WhatsApp (perfil do cliente final). Endpoint PÚBLICO:
// resposta idêntica para telefone novo ou já cadastrado; limites por telefone, IP e loja; honeypot.
// Segredos: CLIENTE_HASH_PEPPER, CRM_CODIGO_URL, CRM_CODIGO_SEGREDO. Deploy sem JWT:
//   supabase functions deploy cliente-pedir-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { hashIp, ipDoCliente, pareceBot } from '../_shared/antiabuso.ts'
import { VALIDADE_CODIGO_MS, decidirLimites, gerarCodigo, hashSegredo } from '../_shared/clienteCodigo.ts'
import { enviarCodigoAoCrm } from '../_shared/codigoCrm.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const PRODUCAO_REF = 'vimjwzumjggrlvlxdejr'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; nome?: string; telefone?: string; website?: string; ms_no_checkout?: number }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  // Robô: mesma resposta de sucesso, sem enviar nada nem dizer o motivo.
  if (pareceBot(body)) return json({ ok: true, reenvio_em_s: 60 })

  const slug = String(body.barraca_slug ?? '').trim().toLowerCase().slice(0, 80)
  const nome = String(body.nome ?? '').trim().slice(0, 80)
  if (!slug) return json({ erro: 'Loja inválida' }, 400)
  if (nome.length < 2) return json({ erro: 'Informe seu nome' }, 422)
  if (!telefoneValido(String(body.telefone ?? ''))) return json({ erro: 'Informe um telefone com DDD' }, 422)
  const telefone = normalizarTelefone(String(body.telefone))

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  if (!pimenta) {
    console.error('cliente-pedir-codigo: CLIENTE_HASH_PEPPER ausente')
    return json({ erro: 'Não conseguimos enviar o código agora. Tente de novo.' }, 503)
  }

  const { data: barraca } = await supabase.from('barracas').select('id, codigos_dia_max').eq('slug', slug).maybeSingle()
  if (!barraca) return json({ erro: 'Loja não encontrada' }, 404)

  const agora = Date.now()
  const umaHora = new Date(agora - 3600_000).toISOString()
  const vinteQuatroH = new Date(agora - 24 * 3600_000).toISOString()
  const ipHash = await hashIp('cliente-codigo', ipDoCliente(req), barraca.id)

  const [{ count: porTelefone }, { count: porIp }, { count: porLoja }, { data: ultimo }] = await Promise.all([
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id).eq('telefone', telefone).gte('criado_em', umaHora),
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('criado_em', umaHora),
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id).gte('criado_em', vinteQuatroH),
    supabase.from('cliente_codigos').select('criado_em').eq('barraca_id', barraca.id).eq('telefone', telefone).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
  ])

  const decisao = decidirLimites({
    pedidosTelefoneHora: porTelefone ?? 0,
    pedidosIpHora: porIp ?? 0,
    enviosLoja24h: porLoja ?? 0,
    tetoLoja: barraca.codigos_dia_max,
    msDesdeUltimoEnvio: ultimo ? agora - Date.parse(ultimo.criado_em) : null,
  })
  if (decisao === 'muito_cedo') return json({ erro: 'Aguarde um minuto para pedir outro código.' }, 429)
  if (decisao !== 'ok') return json({ erro: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429)

  const codigo = gerarCodigo()
  const requestId = crypto.randomUUID()
  const { error: erroInsert } = await supabase.from('cliente_codigos').insert({
    id: requestId,
    barraca_id: barraca.id,
    telefone,
    codigo_hash: await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo),
    expira_em: new Date(agora + VALIDADE_CODIGO_MS).toISOString(),
    ip_hash: ipHash,
  })
  if (erroInsert) {
    console.error('cliente-pedir-codigo: falha ao gravar código')
    return json({ erro: 'Não conseguimos enviar o código agora. Tente de novo.' }, 500)
  }

  // Simulação SÓ no staging (nunca na produção, mesmo que o secret exista por engano).
  const simulado =
    Deno.env.get('CODIGO_SIMULADO') === '1' && !(Deno.env.get('SUPABASE_URL') ?? '').includes(PRODUCAO_REF)
  if (simulado) return json({ ok: true, reenvio_em_s: 60, codigo_simulado: codigo })

  const envio = await enviarCodigoAoCrm({
    url: Deno.env.get('CRM_CODIGO_URL') ?? '',
    segredo: Deno.env.get('CRM_CODIGO_SEGREDO') ?? '',
    barracaId: barraca.id,
    telefone,
    codigo,
    requestId,
  })
  if (!envio.ok) {
    console.error('cliente-pedir-codigo: envio falhou:', envio.motivo)
    await supabase.from('cliente_codigos').delete().eq('id', requestId)
    return json({ erro: 'Não conseguimos enviar o código. Tente de novo.' }, 502)
  }
  return json({ ok: true, reenvio_em_s: 60 })
})
```

- [ ] **Step 3: `cliente-verificar-codigo`**

`supabase/functions/cliente-verificar-codigo/index.ts`:
```ts
// Confere o código, cria/atualiza o perfil e abre a sessão. Endpoint PÚBLICO.
//   supabase functions deploy cliente-verificar-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  MAX_TENTATIVAS,
  VALIDADE_SESSAO_MS,
  avaliarCodigo,
  gerarTokenSessao,
  hashSegredo,
  limparCodigo,
} from '../_shared/clienteCodigo.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const INVALIDO = 'Código inválido ou expirado. Peça um novo.'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; telefone?: string; codigo?: string; nome?: string; aceita_promocoes?: boolean; aparelho?: string }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  const slug = String(body.barraca_slug ?? '').trim().toLowerCase().slice(0, 80)
  const nome = String(body.nome ?? '').trim().slice(0, 80)
  const codigo = limparCodigo(body.codigo)
  if (!slug || nome.length < 2 || !telefoneValido(String(body.telefone ?? ''))) return json({ erro: INVALIDO }, 400)
  if (!codigo) return json({ erro: 'Digite os 6 números do código.' }, 400)
  const telefone = normalizarTelefone(String(body.telefone))

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  if (!pimenta) return json({ erro: 'Tente de novo em instantes.' }, 503)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: barraca } = await supabase.from('barracas').select('id').eq('slug', slug).maybeSingle()
  if (!barraca) return json({ erro: INVALIDO }, 400)

  const { data: reg } = await supabase
    .from('cliente_codigos')
    .select('id, codigo_hash, usado_em, tentativas, expira_em')
    .eq('barraca_id', barraca.id)
    .eq('telefone', telefone)
    .is('usado_em', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!reg) return json({ erro: INVALIDO }, 400)

  const hashInformado = await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo)
  const decisao = avaliarCodigo(reg, hashInformado, Date.now())

  if (decisao === 'incorreto') {
    await supabase.from('cliente_codigos').update({ tentativas: reg.tentativas + 1 }).eq('id', reg.id)
    const restantes = Math.max(0, MAX_TENTATIVAS - (reg.tentativas + 1))
    return json({ erro: restantes > 0 ? 'Código incorreto.' : INVALIDO, tentativas_restantes: restantes }, 400)
  }
  if (decisao !== 'ok') {
    if (decisao === 'excedido') await supabase.from('cliente_codigos').update({ usado_em: new Date().toISOString() }).eq('id', reg.id)
    return json({ erro: INVALIDO }, 400)
  }

  // Uso único mesmo com dois cliques simultâneos: só quem marcar `usado_em` primeiro segue.
  const { data: consumido } = await supabase
    .from('cliente_codigos')
    .update({ usado_em: new Date().toISOString() })
    .eq('id', reg.id)
    .is('usado_em', null)
    .select('id')
    .maybeSingle()
  if (!consumido) return json({ erro: INVALIDO }, 400)

  const { data: clienteId, error: erroPerfil } = await supabase.rpc('cliente_registrar_verificado', {
    p_barraca_id: barraca.id,
    p_telefone: telefone,
    p_nome: nome,
    p_aceita_promocoes: body.aceita_promocoes === true,
  })
  if (erroPerfil || !clienteId) {
    console.error('cliente-verificar-codigo: falha ao registrar perfil', erroPerfil?.message)
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500)
  }

  const token = gerarTokenSessao()
  const expiraEm = new Date(Date.now() + VALIDADE_SESSAO_MS).toISOString()
  const { error: erroSessao } = await supabase.from('cliente_sessoes').insert({
    cliente_id: clienteId,
    barraca_id: barraca.id,
    token_hash: await hashSegredo(pimenta, 'sessao', token),
    aparelho: String(body.aparelho ?? '').slice(0, 80) || null,
    expira_em: expiraEm,
  })
  if (erroSessao) {
    console.error('cliente-verificar-codigo: falha ao criar sessão')
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500)
  }
  return json({ token, expira_em: expiraEm, cliente: { id: clienteId, nome, telefone } })
})
```

- [ ] **Step 4: Verificar tipos e testes**

Run: `npm test && npx tsc -b && npm run lint`
Expected: PASS (as functions Deno não entram no `tsc -b`; o que importa é não quebrar o restante). Conferir à mão que os imports de `_shared` batem com os nomes da Task 1 e 3.

- [ ] **Step 5: Publicar no STAGING e testar com código simulado**

```bash
supabase secrets set CLIENTE_HASH_PEPPER="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" CODIGO_SIMULADO=1 CRM_CODIGO_URL=https://crm.exemplo.invalid/x CRM_CODIGO_SEGREDO=teste-staging-0000000000 --project-ref qzcqwovbbylqxljcrqhk
supabase functions deploy cliente-pedir-codigo --no-verify-jwt --project-ref qzcqwovbbylqxljcrqhk
supabase functions deploy cliente-verificar-codigo --no-verify-jwt --project-ref qzcqwovbbylqxljcrqhk
```
Teste (não imprimir segredos): pedir código com a barraca `barraca-teste` → recebe `codigo_simulado`; verificar com o código → recebe `token`; repetir a verificação com o mesmo código → 400; errar o código 5 vezes → depois do 5º, o certo também falha; pedir 4 códigos seguidos para o mesmo telefone → o 4º dá 429; telefone sem DDD → 422; `website` preenchido → 200 sem código.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/cliente-pedir-codigo supabase/functions/cliente-verificar-codigo supabase/functions/_shared/clienteSessao.ts
git commit -m "feat(cliente): functions para pedir e verificar o código por WhatsApp"
```

---

### Task 5: Edge function `cliente-sessao` (perfil, endereços, histórico, apagar)

**Files:**
- Create: `supabase/functions/cliente-sessao/index.ts`
- Create: `supabase/functions/_shared/pedirDeNovo.ts`
- Test: `tests/clientePerfil.test.ts` (parte `pedirDeNovo`)

**Interfaces:**
- Consumes: `autenticarSessao` (Task 4).
- Produces: `POST cliente-sessao` `{ barraca_slug, token, acao, dados? }`. Ações: `perfil`, `historico`, `pedir_de_novo` (`dados.pedido_id`), `salvar_perfil` (`nome`, `aceita_promocoes`, `aceita_avisos_pedido`), `endereco_salvar` (`id?`, `apelido`, `rua`, `numero`, `bairro`, `referencia?`, `padrao?`), `endereco_excluir` (`id`), `endereco_padrao` (`id`), `sair`, `apagar`. Erros: `401 { erro: 'Sessão expirada', codigo: 'sessao_invalida' }`.
- `classificarItensPedirDeNovo(itensDoPedido, itensAtuais): LinhaPedirDeNovo[]` com `status: 'ok' | 'preco_mudou' | 'esgotado' | 'indisponivel' | 'refazer_opcoes'`.

- [ ] **Step 1: Teste do "pedir de novo" (falha)**

`tests/clientePerfil.test.ts`:
```ts
// "Pedir de novo": nunca monta carrinho errado em silêncio. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classificarItensPedirDeNovo } from '../supabase/functions/_shared/pedirDeNovo.ts'

const antigo = (o: object) => ({ item_id: 'a', nome_item: 'X-Teste', quantidade: 2, preco_centavos_unitario: 1800, opcoes: [], ...o })
const atual = (o: object) => ({ id: 'a', nome: 'X-Teste', ativo: true, esgotado: false, preco_centavos: 1800, ...o })

describe('classificarItensPedirDeNovo', () => {
  test('igual: ok com a quantidade original', () => {
    const [l] = classificarItensPedirDeNovo([antigo({})], [atual({})])
    assert.deepEqual(l, { item_id: 'a', nome: 'X-Teste', quantidade: 2, status: 'ok', preco_atual_centavos: 1800, preco_antigo_centavos: 1800 })
  })
  test('preço mudou', () => {
    const [l] = classificarItensPedirDeNovo([antigo({})], [atual({ preco_centavos: 2000 })])
    assert.equal(l.status, 'preco_mudou')
    assert.equal(l.preco_atual_centavos, 2000)
  })
  test('esgotado, inativo e removido do cardápio', () => {
    assert.equal(classificarItensPedirDeNovo([antigo({})], [atual({ esgotado: true })])[0].status, 'esgotado')
    assert.equal(classificarItensPedirDeNovo([antigo({})], [atual({ ativo: false })])[0].status, 'indisponivel')
    assert.equal(classificarItensPedirDeNovo([antigo({})], [])[0].status, 'indisponivel')
  })
  test('item que tinha adicionais precisa ser escolhido de novo', () => {
    const [l] = classificarItensPedirDeNovo([antigo({ opcoes: [{ nome: 'Bacon' }] })], [atual({})])
    assert.equal(l.status, 'refazer_opcoes')
  })
  test('linha sem item_id (item apagado) é indisponível', () => {
    assert.equal(classificarItensPedirDeNovo([antigo({ item_id: null })], [atual({})])[0].status, 'indisponivel')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/clientePerfil.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implementar `pedirDeNovo.ts`**

`supabase/functions/_shared/pedirDeNovo.ts`:
```ts
// Compara os itens de um pedido antigo com o cardápio de hoje. O front só monta o carrinho com o que
// vier 'ok' ou 'preco_mudou' (esse, depois de mostrar o preço novo).

export type ItemAntigo = {
  item_id: string | null
  nome_item: string
  quantidade: number
  preco_centavos_unitario: number
  opcoes?: unknown[] | null
}
export type ItemAtual = { id: string; nome: string; ativo: boolean; esgotado: boolean; preco_centavos: number }
export type StatusPedirDeNovo = 'ok' | 'preco_mudou' | 'esgotado' | 'indisponivel' | 'refazer_opcoes'
export type LinhaPedirDeNovo = {
  item_id: string | null
  nome: string
  quantidade: number
  status: StatusPedirDeNovo
  preco_atual_centavos: number | null
  preco_antigo_centavos: number
}

export function classificarItensPedirDeNovo(antigos: ItemAntigo[], atuais: ItemAtual[]): LinhaPedirDeNovo[] {
  const porId = new Map(atuais.map((i) => [i.id, i]))
  return antigos.map((a) => {
    const base = { item_id: a.item_id, nome: a.nome_item, quantidade: a.quantidade, preco_antigo_centavos: a.preco_centavos_unitario }
    const atual = a.item_id ? porId.get(a.item_id) : undefined
    if (!atual || !atual.ativo) return { ...base, status: 'indisponivel' as const, preco_atual_centavos: null }
    if (atual.esgotado) return { ...base, status: 'esgotado' as const, preco_atual_centavos: atual.preco_centavos }
    if ((a.opcoes ?? []).length > 0) return { ...base, status: 'refazer_opcoes' as const, preco_atual_centavos: atual.preco_centavos }
    const mudou = atual.preco_centavos !== a.preco_centavos_unitario
    return { ...base, nome: atual.nome, status: mudou ? ('preco_mudou' as const) : ('ok' as const), preco_atual_centavos: atual.preco_centavos }
  })
}
```
Nota: o teste espera `nome: 'X-Teste'` no caso ok; `atual.nome` é igual. Rodar o teste confirma.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/clientePerfil.test.ts` → Expected: PASS.

- [ ] **Step 5: Implementar a function `cliente-sessao`**

`supabase/functions/cliente-sessao/index.ts`:
```ts
// Operações do perfil do cliente final, sempre por token de sessão (nunca por id vindo do cliente).
//   supabase functions deploy cliente-sessao --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { autenticarSessao } from '../_shared/clienteSessao.ts'
import { classificarItensPedirDeNovo } from '../_shared/pedirDeNovo.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const MAX_ENDERECOS = 5

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; token?: string; acao?: string; dados?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const slug = texto(body.barraca_slug, 80).toLowerCase()
  const { data: barraca } = await supabase.from('barracas').select('id').eq('slug', slug).maybeSingle()
  const sessao = barraca && pimenta ? await autenticarSessao(supabase, pimenta, barraca.id, body.token) : null
  if (!barraca || !sessao) return json({ erro: 'Sessão expirada', codigo: 'sessao_invalida' }, 401)

  const clienteId = sessao.cliente_id
  const d = body.dados ?? {}

  switch (body.acao) {
    case 'perfil': {
      const [{ data: cliente }, { data: enderecos }] = await Promise.all([
        supabase.from('clientes_finais').select('id, nome, telefone, consentimento_marketing_em, aceita_avisos_pedido').eq('id', clienteId).single(),
        supabase.from('cliente_enderecos').select('id, apelido, rua, numero, bairro, referencia, padrao').eq('cliente_id', clienteId).order('padrao', { ascending: false }).order('criado_em'),
      ])
      return json({
        cliente: cliente && { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone, aceita_promocoes: Boolean(cliente.consentimento_marketing_em), aceita_avisos_pedido: cliente.aceita_avisos_pedido },
        enderecos: enderecos ?? [],
      })
    }

    case 'historico': {
      const { data } = await supabase
        .from('pedidos')
        .select('id, senha, status, criado_em, tipo_atendimento, taxa_entrega_centavos, itens_do_pedido(nome_item, quantidade, preco_centavos_unitario, removido)')
        .eq('cliente_id', clienteId)
        .eq('barraca_id', barraca.id)
        .order('criado_em', { ascending: false })
        .limit(20)
      return json({ pedidos: data ?? [] })
    }

    case 'pedir_de_novo': {
      const pedidoId = texto(d.pedido_id, 40)
      if (!UUID.test(pedidoId)) return json({ erro: 'Pedido inválido' }, 400)
      const { data: pedido } = await supabase
        .from('pedidos')
        .select('id, itens_do_pedido(item_id, nome_item, quantidade, preco_centavos_unitario, removido, opcoes)')
        .eq('id', pedidoId)
        .eq('cliente_id', clienteId)
        .maybeSingle()
      if (!pedido) return json({ erro: 'Pedido não encontrado' }, 404)
      const antigos = (pedido.itens_do_pedido ?? []).filter((i: { removido: boolean }) => !i.removido)
      const ids = antigos.map((i: { item_id: string | null }) => i.item_id).filter(Boolean) as string[]
      const { data: atuais } = ids.length
        ? await supabase.from('itens').select('id, nome, ativo, esgotado, preco_centavos').eq('barraca_id', barraca.id).in('id', ids)
        : { data: [] }
      return json({ linhas: classificarItensPedirDeNovo(antigos, atuais ?? []) })
    }

    case 'salvar_perfil': {
      const nome = texto(d.nome, 80)
      if (nome.length < 2) return json({ erro: 'Informe seu nome' }, 422)
      const { data: atual } = await supabase.from('clientes_finais').select('consentimento_marketing_em').eq('id', clienteId).single()
      const aceita = d.aceita_promocoes === true
      const { error } = await supabase
        .from('clientes_finais')
        .update({
          nome,
          aceita_avisos_pedido: d.aceita_avisos_pedido !== false,
          consentimento_marketing_em: aceita ? (atual?.consentimento_marketing_em ?? new Date().toISOString()) : null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', clienteId)
      return error ? json({ erro: 'Não foi possível salvar.' }, 500) : json({ ok: true })
    }

    case 'endereco_salvar': {
      const campos = {
        apelido: texto(d.apelido, 30) || 'Casa',
        rua: texto(d.rua, 120),
        numero: texto(d.numero, 20),
        bairro: texto(d.bairro, 80),
        referencia: texto(d.referencia, 120) || null,
      }
      if (!campos.rua || !campos.numero || !campos.bairro) return json({ erro: 'Informe rua, número e bairro.' }, 422)
      const id = texto(d.id, 40)
      if (id) {
        if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
        const { error } = await supabase.from('cliente_enderecos').update(campos).eq('id', id).eq('cliente_id', clienteId)
        if (error) return json({ erro: 'Não foi possível salvar.' }, 500)
        return json({ ok: true, id })
      }
      const { count } = await supabase.from('cliente_enderecos').select('id', { count: 'exact', head: true }).eq('cliente_id', clienteId)
      if ((count ?? 0) >= MAX_ENDERECOS) return json({ erro: `Você pode guardar até ${MAX_ENDERECOS} endereços.` }, 422)
      const { data, error } = await supabase
        .from('cliente_enderecos')
        .insert({ ...campos, cliente_id: clienteId, barraca_id: barraca.id, padrao: (count ?? 0) === 0 })
        .select('id')
        .single()
      return error || !data ? json({ erro: 'Não foi possível salvar.' }, 500) : json({ ok: true, id: data.id })
    }

    case 'endereco_padrao': {
      const id = texto(d.id, 40)
      if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
      const { data: dele } = await supabase.from('cliente_enderecos').select('id').eq('id', id).eq('cliente_id', clienteId).maybeSingle()
      if (!dele) return json({ erro: 'Endereço não encontrado' }, 404)
      await supabase.from('cliente_enderecos').update({ padrao: false }).eq('cliente_id', clienteId)
      await supabase.from('cliente_enderecos').update({ padrao: true }).eq('id', id)
      return json({ ok: true })
    }

    case 'endereco_excluir': {
      const id = texto(d.id, 40)
      if (!UUID.test(id)) return json({ erro: 'Endereço inválido' }, 400)
      await supabase.from('cliente_enderecos').delete().eq('id', id).eq('cliente_id', clienteId)
      return json({ ok: true })
    }

    case 'sair': {
      await supabase.from('cliente_sessoes').update({ revogada_em: new Date().toISOString() }).eq('id', sessao.sessao_id)
      return json({ ok: true })
    }

    case 'apagar': {
      const { error } = await supabase.rpc('cliente_apagar_dados', { p_cliente_id: clienteId })
      return error ? json({ erro: 'Não foi possível apagar agora. Tente de novo.' }, 500) : json({ ok: true })
    }

    default:
      return json({ erro: 'Ação inválida' }, 400)
  }
})
```

- [ ] **Step 6: Publicar no staging e testar**

```bash
supabase functions deploy cliente-sessao --no-verify-jwt --project-ref qzcqwovbbylqxljcrqhk
```
Com o token da Task 4: `perfil` devolve o cliente e `[]`; `endereco_salvar` cria e o 1º vira padrão; 6º endereço → 422; `historico` só lista pedidos com `cliente_id` dele; token de **outra loja** → 401; `apagar` remove tudo e a sessão deixa de valer (401 na chamada seguinte); `pedir_de_novo` com pedido de outro cliente → 404.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/cliente-sessao supabase/functions/_shared/pedirDeNovo.ts tests/clientePerfil.test.ts
git commit -m "feat(cliente): function de sessão (perfil, endereços, histórico, pedir de novo, apagar)"
```

---

### Task 6: Vincular pedido ao perfil e exigir perfil (flag)

**Files:**
- Modify: `supabase/functions/criar-pedido-cardapio/index.ts`
- Modify: `supabase/functions/criar-pagamento-pix/index.ts`
- Modify: `supabase/functions/webhook-mercadopago/index.ts`
- Create: `supabase/functions/_shared/perfilNoPedido.ts`
- Test: `tests/clientePerfil.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `autenticarSessao`.
- Produces: `resolverPerfilDoPedido(supabase, pimenta, barracaId, sessaoToken): Promise<{ clienteId: string | null; bloqueado: boolean }>` — `bloqueado` é `true` quando a barraca exige perfil e a sessão é inválida/ausente. Os corpos de `criar-pedido-cardapio` e `criar-pagamento-pix` aceitam `sessao_token?: string`; resposta `401 { erro, codigo: 'perfil_obrigatorio' }` quando bloqueado.

- [ ] **Step 1: Teste da decisão pura (falha)**

Acrescentar a `tests/clientePerfil.test.ts`:
```ts
import { decidirPerfil } from '../supabase/functions/_shared/perfilNoPedido.ts'

describe('decidirPerfil', () => {
  test('flag desligada: segue com ou sem sessão', () => {
    assert.deepEqual(decidirPerfil(false, null), { clienteId: null, bloqueado: false })
    assert.deepEqual(decidirPerfil(false, 'c1'), { clienteId: 'c1', bloqueado: false })
  })
  test('flag ligada: sem sessão válida bloqueia; com sessão segue', () => {
    assert.deepEqual(decidirPerfil(true, null), { clienteId: null, bloqueado: true })
    assert.deepEqual(decidirPerfil(true, 'c1'), { clienteId: 'c1', bloqueado: false })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/clientePerfil.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`supabase/functions/_shared/perfilNoPedido.ts`:
```ts
// Liga o pedido do cardápio ao perfil do cliente. Flag por barraca: obrigatório só se o dono ligar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { autenticarSessao } from './clienteSessao.ts'

export function decidirPerfil(obrigatorio: boolean, clienteId: string | null): { clienteId: string | null; bloqueado: boolean } {
  return { clienteId, bloqueado: obrigatorio && !clienteId }
}

export async function resolverPerfilDoPedido(
  supabase: SupabaseClient,
  pimenta: string,
  barracaId: string,
  sessaoToken: unknown,
): Promise<{ clienteId: string | null; bloqueado: boolean }> {
  const { data: barraca } = await supabase.from('barracas').select('perfil_cliente_obrigatorio').eq('id', barracaId).maybeSingle()
  const sessao = sessaoToken && pimenta ? await autenticarSessao(supabase, pimenta, barracaId, sessaoToken) : null
  return decidirPerfil(Boolean(barraca?.perfil_cliente_obrigatorio), sessao?.cliente_id ?? null)
}
```
Em banco **sem** a migration, a coluna não existe e a leitura falha: `barraca` vem `null`, `obrigatorio` vira `false` e o pedido segue como sempre (comportamento antigo preservado).

- [ ] **Step 4: Rodar e ver passar** — `node --test tests/clientePerfil.test.ts` → PASS.

- [ ] **Step 5: Ligar em `criar-pedido-cardapio`**

No topo, junto dos imports: `import { resolverPerfilDoPedido } from '../_shared/perfilNoPedido.ts'`.
No tipo de `body` (bloco `let body: {`), acrescentar `sessao_token?: string`.
Imediatamente antes da chamada `supabase.rpc('resolver_carrinho'` (procurar `resolver_carrinho`), inserir:
```ts
  const perfil = await resolverPerfilDoPedido(supabase, Deno.env.get('CLIENTE_HASH_PEPPER') ?? '', barracaId, body.sessao_token)
  if (perfil.bloqueado) {
    return jsonResponse({ erro: 'Confirme seu telefone para finalizar o pedido.', codigo: 'perfil_obrigatorio' }, 401)
  }
```
Logo depois do bloco `if (erroPedido || !criado) { ... }` (procurar `falha em criar_pedido`), inserir (best-effort, nunca derruba o pedido já criado):
```ts
  if (perfil.clienteId) {
    const { error: erroVinculo } = await supabase
      .from('pedidos')
      .update({ cliente_id: perfil.clienteId })
      .eq('id', (criado as { pedido_id: string }).pedido_id)
    if (erroVinculo) console.error('criar-pedido-cardapio: falha ao vincular cliente', erroVinculo.message)
  }
```

- [ ] **Step 6: Ligar em `criar-pagamento-pix` e no webhook**

Em `criar-pagamento-pix/index.ts`: mesmo import; `sessao_token?: string` no tipo do body; depois de validar o `barraca_id` e antes de criar/atualizar a cobrança, `const perfil = await resolverPerfilDoPedido(supabase, Deno.env.get('CLIENTE_HASH_PEPPER') ?? '', barraca_id, body.sessao_token)` e o mesmo retorno 401 quando `bloqueado`. No `.update({ ... })` do pendente reaproveitado (procurar `cliente_nome: clienteNome,`) e no `.insert({ ... })` (procurar `client_uuid,` seguido de `...(ehEntrega`), acrescentar a linha `...(perfil.clienteId ? { cliente_id: perfil.clienteId } : {}),`.

Em `webhook-mercadopago/index.ts`, logo depois de `const pedidoId = desfecho.pedidoId`:
```ts
    if (pendente.cliente_id) {
      const { error: erroVinculo } = await supabase.from('pedidos').update({ cliente_id: pendente.cliente_id }).eq('id', pedidoId)
      if (erroVinculo) console.error('webhook-mercadopago: falha ao vincular cliente ao pedido', erroVinculo.message)
    }
```
(O `select` do pendente no webhook usa `'*'`? Confirmar com `grep -n "from('pagamentos_pendentes')" supabase/functions/webhook-mercadopago/index.ts`; se listar colunas, incluir `cliente_id`.)

- [ ] **Step 7: Publicar no staging e testar**

Publicar as três functions no staging (`criar-pedido-cardapio` e `criar-pagamento-pix` **com** JWT, como na produção; `webhook-mercadopago` com `--no-verify-jwt`). Teste: com a flag desligada, pedido sem token continua funcionando exatamente como antes; ligar `update barracas set perfil_cliente_obrigatorio = true where slug = 'barraca-teste'`, pedido sem token → 401 `perfil_obrigatorio`; com token válido → pedido criado com `cliente_id` preenchido; desligar a flag de novo ao final.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions tests/clientePerfil.test.ts
git commit -m "feat(cliente): vincula o pedido do cardápio ao perfil e exige perfil quando a flag estiver ligada"
```

---

### Task 7: Cliente da API no app (token no aparelho)

**Files:**
- Create: `src/lib/clienteSessaoLocal.ts`
- Create: `src/lib/clienteApi.ts`
- Create: `src/hooks/useClienteSessao.ts`
- Test: `tests/clienteSessaoLocal.test.ts`

**Convenção do repositório:** os testes só importam arquivos de `src/lib` **sem imports de outros arquivos do app** (o Node não resolve `./supabase` sem extensão nem `import.meta.env`). Por isso o armazenamento do token fica num arquivo puro.

**Interfaces:**
- Produces: em `clienteSessaoLocal.ts`: `lerSessao(slug): SessaoCliente | null`, `guardarSessao(slug, s)`, `limparSessao(slug)`, `pedirCodigo(args)`, `verificarCodigo(args)`, `chamarSessao(slug, acao, dados?)` (limpa a sessão e devolve `{ sessaoInvalida: true }` em 401), `type SessaoCliente = { token: string; expira_em: string; nome: string; telefone: string }`; hook `useClienteSessao(slug)` → `{ sessao, entrar(s), sair() }`.

- [ ] **Step 1: Teste do armazenamento (falha)**

`tests/clienteSessaoLocal.test.ts`:
```ts
// Token do cliente no aparelho: nunca quebra sem localStorage e descarta sessão vencida. Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { guardarSessao, lerSessao, limparSessao } from '../src/lib/clienteSessaoLocal.ts'

class Memoria {
  d = new Map<string, string>()
  getItem(k: string) { return this.d.get(k) ?? null }
  setItem(k: string, v: string) { this.d.set(k, v) }
  removeItem(k: string) { this.d.delete(k) }
}

describe('sessão do cliente no aparelho', () => {
  beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new Memoria() })

  test('guarda, lê e limpa por loja', () => {
    const s = { token: 't'.repeat(43), expira_em: new Date(Date.now() + 1e6).toISOString(), nome: 'Ana', telefone: '61999531848' }
    guardarSessao('loja-a', s)
    assert.deepEqual(lerSessao('loja-a'), s)
    assert.equal(lerSessao('loja-b'), null)
    limparSessao('loja-a')
    assert.equal(lerSessao('loja-a'), null)
  })

  test('sessão vencida some sozinha', () => {
    guardarSessao('l', { token: 'x'.repeat(43), expira_em: new Date(Date.now() - 1).toISOString(), nome: 'A', telefone: '61999531848' })
    assert.equal(lerSessao('l'), null)
  })

  test('sem localStorage ou JSON quebrado não lança', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    assert.equal(lerSessao('l'), null)
    guardarSessao('l', { token: 'x', expira_em: '', nome: '', telefone: '' })
    ;(globalThis as { localStorage?: unknown }).localStorage = Object.assign(new Memoria(), { getItem: () => '{quebrado' })
    assert.equal(lerSessao('l'), null)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/clienteSessaoLocal.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`src/lib/clienteSessaoLocal.ts`:
```ts
// Token do cliente final no aparelho. PURO (sem imports): testável no Node. O token só existe aqui
// (no banco fica o hash); vale 30 dias e some ao sair, ao vencer ou quando o servidor recusar.
export type SessaoCliente = { token: string; expira_em: string; nome: string; telefone: string }

const chave = (slug: string) => `saiae:cliente:${slug}`

export function lerSessao(slug: string): SessaoCliente | null {
  try {
    const bruto = localStorage.getItem(chave(slug))
    if (!bruto) return null
    const s = JSON.parse(bruto) as SessaoCliente
    if (!s?.token || !s.expira_em || Date.parse(s.expira_em) <= Date.now()) {
      localStorage.removeItem(chave(slug))
      return null
    }
    return s
  } catch {
    return null
  }
}

export function guardarSessao(slug: string, s: SessaoCliente): void {
  try {
    localStorage.setItem(chave(slug), JSON.stringify(s))
  } catch {
    /* sem armazenamento: o cliente só terá que confirmar de novo */
  }
}

export function limparSessao(slug: string): void {
  try {
    localStorage.removeItem(chave(slug))
  } catch {
    /* idem */
  }
}
```

`src/lib/clienteApi.ts`:
```ts
// Perfil do cliente final: token no aparelho + chamadas às edge functions. O token só existe aqui
// (no banco fica o hash); valer 30 dias e some ao sair, ao vencer ou quando o servidor recusar.
import { supabase } from './supabase'

import { guardarSessao, lerSessao, limparSessao, type SessaoCliente } from './clienteSessaoLocal'

export type { SessaoCliente }

async function corpoDoErro(error: unknown): Promise<{ erro?: string; tentativas_restantes?: number; codigo?: string; status?: number } | null> {
  const contexto = (error as { context?: unknown } | null)?.context
  if (contexto instanceof Response) {
    const corpo = await contexto.json().catch(() => null)
    return { ...(corpo ?? {}), status: contexto.status }
  }
  return null
}

export type RespostaPedirCodigo = { ok: true; reenvio_em_s: number; codigo_simulado?: string } | { ok: false; erro: string }

export async function pedirCodigo(args: { slug: string; nome: string; telefone: string; honeypot: string; msNoCheckout: number }): Promise<RespostaPedirCodigo> {
  const { data, error } = await supabase.functions.invoke('cliente-pedir-codigo', {
    body: { barraca_slug: args.slug, nome: args.nome, telefone: args.telefone, website: args.honeypot, ms_no_checkout: args.msNoCheckout },
  })
  if (error || !data?.ok) {
    const corpo = await corpoDoErro(error)
    return { ok: false, erro: corpo?.erro ?? 'Não conseguimos enviar o código. Tente de novo.' }
  }
  return { ok: true, reenvio_em_s: data.reenvio_em_s ?? 60, codigo_simulado: data.codigo_simulado }
}

export type RespostaVerificar = { ok: true; sessao: SessaoCliente } | { ok: false; erro: string; tentativasRestantes?: number }

export async function verificarCodigo(args: { slug: string; nome: string; telefone: string; codigo: string; aceitaPromocoes: boolean }): Promise<RespostaVerificar> {
  const { data, error } = await supabase.functions.invoke('cliente-verificar-codigo', {
    body: {
      barraca_slug: args.slug, nome: args.nome, telefone: args.telefone, codigo: args.codigo,
      aceita_promocoes: args.aceitaPromocoes, aparelho: navigator.userAgent.slice(0, 80),
    },
  })
  if (error || !data?.token) {
    const corpo = await corpoDoErro(error)
    return { ok: false, erro: corpo?.erro ?? 'Código inválido ou expirado. Peça um novo.', tentativasRestantes: corpo?.tentativas_restantes }
  }
  const sessao: SessaoCliente = { token: data.token, expira_em: data.expira_em, nome: data.cliente.nome, telefone: data.cliente.telefone }
  guardarSessao(args.slug, sessao)
  return { ok: true, sessao }
}

export type RespostaSessao<T> = { ok: true; dados: T } | { ok: false; sessaoInvalida: boolean; erro: string }

/** Chama `cliente-sessao`. Em 401 apaga a sessão do aparelho e avisa para voltar à etapa do código. */
export async function chamarSessao<T = Record<string, unknown>>(slug: string, acao: string, dados?: Record<string, unknown>): Promise<RespostaSessao<T>> {
  const sessao = lerSessao(slug)
  if (!sessao) return { ok: false, sessaoInvalida: true, erro: 'Sessão expirada' }
  const { data, error } = await supabase.functions.invoke('cliente-sessao', {
    body: { barraca_slug: slug, token: sessao.token, acao, dados },
  })
  if (error || !data || data.erro) {
    const corpo = await corpoDoErro(error)
    if (corpo?.status === 401) {
      limparSessao(slug)
      return { ok: false, sessaoInvalida: true, erro: 'Sua sessão expirou. Confirme seu telefone de novo.' }
    }
    return { ok: false, sessaoInvalida: false, erro: corpo?.erro ?? 'Não foi possível concluir. Tente de novo.' }
  }
  if (acao === 'sair' || acao === 'apagar') limparSessao(slug)
  return { ok: true, dados: data as T }
}
```

`src/hooks/useClienteSessao.ts`:
```ts
import { useCallback, useState } from 'react'
import { lerSessao, limparSessao, type SessaoCliente } from '../lib/clienteApi'

/** Sessão do cliente final nesta loja (só no aparelho). `entrar` guarda; `sair` limpa localmente. */
export function useClienteSessao(slug: string | undefined) {
  const [sessao, setSessao] = useState<SessaoCliente | null>(() => (slug ? lerSessao(slug) : null))
  const entrar = useCallback((s: SessaoCliente) => setSessao(s), [])
  const sair = useCallback(() => {
    if (slug) limparSessao(slug)
    setSessao(null)
  }, [slug])
  return { sessao, entrar, sair }
}
```

- [ ] **Step 4: Rodar e ver passar** — `node --test tests/clienteSessaoLocal.test.ts && npx tsc -b` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clienteSessaoLocal.ts src/lib/clienteApi.ts src/hooks/useClienteSessao.ts tests/clienteSessaoLocal.test.ts
git commit -m "feat(cliente): token no aparelho e cliente das functions do perfil"
```

---

### Task 8: Identificação no fechamento do pedido (modal) e gate no cardápio

**Files:**
- Create: `src/components/cliente/ModalIdentificacao.tsx`
- Modify: `src/pages/CardapioPublico.tsx`
- Test: `tests/clientePerfil.test.ts` (validações de formulário puras, acrescentar) com `src/lib/clientePerfil.ts`

**Interfaces:**
- Consumes: `pedirCodigo`, `verificarCodigo`, `useClienteSessao`, `telefoneValido` (cópia do front em `src/lib/entrega.ts`: `normalizarTelefone`).
- Produces: `validarDadosIdentificacao({ nome, telefone, aceitouPrivacidade }): { nome?: string; telefone?: string; privacidade?: string }`; componente `<ModalIdentificacao slug nomeInicial telefoneInicial onConcluir(sessao) onCancelar />`; em `CardapioPublico`: `garantirPerfil(): Promise<boolean>`.

- [ ] **Step 1: Teste da validação (falha)**

Acrescentar a `tests/clientePerfil.test.ts`:
```ts
import { validarDadosIdentificacao } from '../src/lib/clientePerfil.ts'

describe('validarDadosIdentificacao', () => {
  test('tudo certo: sem erros', () => {
    assert.deepEqual(validarDadosIdentificacao({ nome: 'Ana Souza', telefone: '(61) 99953-1848', aceitouPrivacidade: true }), {})
  })
  test('nome curto, telefone sem DDD e privacidade não aceita', () => {
    const e = validarDadosIdentificacao({ nome: 'A', telefone: '99953-1848', aceitouPrivacidade: false })
    assert.ok(e.nome && e.telefone && e.privacidade)
  })
  test('aceita telefone com +55', () => {
    assert.deepEqual(validarDadosIdentificacao({ nome: 'Ana', telefone: '+55 61 99953-1848', aceitouPrivacidade: true }), {})
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL (módulo não existe).

- [ ] **Step 3: Implementar a validação**

`src/lib/clientePerfil.ts`:
```ts
// PURO (sem imports de outros arquivos do app): testável no Node.
function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '')
}

/** Mesma regra de src/lib/entrega.ts: o 55 só sai com 12 ou 13 dígitos. */
function normalizarTelefone(texto: string): string {
  const d = somenteDigitos(texto)
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
}

export type ErrosIdentificacao = Partial<Record<'nome' | 'telefone' | 'privacidade', string>>

/** Etapa "seus dados" do fechamento: nome, telefone brasileiro com DDD e aceite da privacidade. */
export function validarDadosIdentificacao(d: { nome: string; telefone: string; aceitouPrivacidade: boolean }): ErrosIdentificacao {
  const erros: ErrosIdentificacao = {}
  if (d.nome.trim().length < 2) erros.nome = 'Informe seu nome'
  const tel = normalizarTelefone(d.telefone)
  if (tel.length !== 10 && tel.length !== 11) erros.telefone = 'Informe um telefone com DDD'
  if (!d.aceitouPrivacidade) erros.privacidade = 'Aceite a política de privacidade para continuar'
  return erros
}
```

- [ ] **Step 4: Rodar e ver passar** — `node --test tests/clientePerfil.test.ts` → PASS.

- [ ] **Step 5: Componente do modal**

`src/components/cliente/ModalIdentificacao.tsx`: usa `BottomSheet`, `Button`, `Input`, `Icone` já existentes (`src/components/ui/*`). Duas etapas (`dados` e `codigo`):
```tsx
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { pedirCodigo, verificarCodigo, type SessaoCliente } from '../../lib/clienteApi'
import { validarDadosIdentificacao, type ErrosIdentificacao } from '../../lib/clientePerfil'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

type Props = {
  slug: string
  nomeInicial?: string
  telefoneInicial?: string
  onConcluir: (s: SessaoCliente) => void
  onCancelar: () => void
}

/** Fechamento do pedido: nome + telefone, depois o código de 6 dígitos recebido no WhatsApp. */
export function ModalIdentificacao({ slug, nomeInicial = '', telefoneInicial = '', onConcluir, onCancelar }: Props) {
  const [etapa, setEtapa] = useState<'dados' | 'codigo'>('dados')
  const [nome, setNome] = useState(nomeInicial)
  const [telefone, setTelefone] = useState(telefoneInicial)
  const [privacidade, setPrivacidade] = useState(false)
  const [promocoes, setPromocoes] = useState(false)
  const [erros, setErros] = useState<ErrosIdentificacao>({})
  const [codigo, setCodigo] = useState('')
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [segundosReenvio, setSegundosReenvio] = useState(0)
  const [honeypot, setHoneypot] = useState('')
  const abertoEm = useRef(Date.now())

  useEffect(() => {
    if (segundosReenvio <= 0) return
    const t = setTimeout(() => setSegundosReenvio((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [segundosReenvio])

  async function receberCodigo() {
    const e = validarDadosIdentificacao({ nome, telefone, aceitouPrivacidade: privacidade })
    setErros(e)
    if (Object.keys(e).length > 0) return
    setCarregando(true)
    setMensagem(null)
    const r = await pedirCodigo({ slug, nome, telefone, honeypot, msNoCheckout: Date.now() - abertoEm.current })
    setCarregando(false)
    if (!r.ok) return setMensagem(r.erro)
    setSegundosReenvio(r.reenvio_em_s)
    setEtapa('codigo')
    // Staging com código simulado: preenche sozinho para o teste (nunca existe em produção).
    if (r.codigo_simulado) setCodigo(r.codigo_simulado)
  }

  async function confirmar() {
    setCarregando(true)
    setMensagem(null)
    const r = await verificarCodigo({ slug, nome, telefone, codigo, aceitaPromocoes: promocoes })
    setCarregando(false)
    if (!r.ok) {
      return setMensagem(r.tentativasRestantes !== undefined ? `${r.erro} Restam ${r.tentativasRestantes} tentativas.` : r.erro)
    }
    onConcluir(r.sessao)
  }

  return (
    <BottomSheet aberto onFechar={onCancelar} titulo={etapa === 'dados' ? 'Seus dados' : 'Digite o código'}>
      {etapa === 'dados' ? (
        <div className="flex flex-col gap-3">
          <Input rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} autoComplete="name" />
          <Input rotulo="WhatsApp com DDD" value={telefone} onChange={(e) => setTelefone(e.target.value)} erro={erros.telefone} inputMode="tel" autoComplete="tel" />
          {/* honeypot: fora da tela, robô preenche */}
          <input tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px]" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" checked={privacidade} onChange={(e) => setPrivacidade(e.target.checked)} className="mt-1" />
            <span>Li e aceito a <Link to="/privacidade" target="_blank" className="underline">política de privacidade</Link>. Vamos usar seu telefone para avisar sobre o pedido.</span>
          </label>
          {erros.privacidade && <p className="text-sm text-mesa-danger">{erros.privacidade}</p>}
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" checked={promocoes} onChange={(e) => setPromocoes(e.target.checked)} className="mt-1" />
            <span>Quero receber promoções da loja (opcional).</span>
          </label>
          {mensagem && <p role="alert" className="text-sm text-mesa-danger">{mensagem}</p>}
          <Button onClick={receberCodigo} disabled={carregando}>{carregando ? 'Enviando…' : 'Receber código'}</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-mesa-text-secondary">Enviamos um código de 6 números para o seu WhatsApp.</p>
          <Input rotulo="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={9} />
          {mensagem && <p role="alert" className="text-sm text-mesa-danger">{mensagem}</p>}
          <Button onClick={confirmar} disabled={carregando || codigo.replace(/\D/g, '').length !== 6}>{carregando ? 'Confirmando…' : 'Confirmar'}</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="min-h-11 underline" onClick={() => { setEtapa('dados'); setCodigo(''); setMensagem(null) }}>Trocar número</button>
            <button type="button" className="min-h-11 underline disabled:opacity-50" disabled={segundosReenvio > 0 || carregando} onClick={receberCodigo}>
              {segundosReenvio > 0 ? `Reenviar em ${segundosReenvio}s` : 'Reenviar código'}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
```
Antes de colar, abrir `src/components/ui/BottomSheet.tsx` e `src/components/ui/Input.tsx` e ajustar os **nomes das props** (`aberto/onFechar/titulo`, `rotulo/erro`) para os reais; se o `Input` não tiver `erro`, renderizar a mensagem logo abaixo, como `FormularioEntrega.tsx` faz. Conferir também o token de cor de erro usado nesse arquivo (`text-mesa-danger` é um palpite: copiar a classe real).

- [ ] **Step 6: Gate no `CardapioPublico.tsx`**

1. Imports: `useClienteSessao`, `ModalIdentificacao`, `lerSessao`, e `supabase` (já importado).
2. Estado, junto dos outros `useState` do componente (perto de `const [mostrarCheckout...`):
```tsx
  const { sessao: sessaoCliente, entrar: entrarCliente } = useClienteSessao(slug)
  const [perfilObrigatorio, setPerfilObrigatorio] = useState(false)
  const [pedindoIdentificacao, setPedindoIdentificacao] = useState(false)
  const resolverIdentificacao = useRef<((ok: boolean) => void) | null>(null)
```
3. Descobrir a flag ao carregar a loja (um `useEffect` novo):
```tsx
  useEffect(() => {
    if (!slug) return
    void supabase.rpc('perfil_cliente_config', { p_slug: slug }).then(({ data, error }) => {
      // Banco sem a migration (PGRST202) = perfil opcional, como sempre.
      if (!error && Array.isArray(data) && data[0]?.obrigatorio) setPerfilObrigatorio(true)
    })
  }, [slug])
```
4. Função que o fechamento chama:
```tsx
  function garantirPerfil(): Promise<boolean> {
    if (!perfilObrigatorio || (slug && lerSessao(slug))) return Promise.resolve(true)
    return new Promise((resolve) => {
      resolverIdentificacao.current = resolve
      setPedindoIdentificacao(true)
    })
  }
```
5. Em `async function pagar()` e `async function enviarPedidoNaEntrega()`, **primeira linha**: `if (!(await garantirPerfil())) return`. No `body` de **cada** `supabase.functions.invoke('criar-pagamento-pix', ...)` e `invoke('criar-pedido-cardapio', ...)`, acrescentar `...(slug && lerSessao(slug) ? { sessao_token: lerSessao(slug)!.token } : {}),`. Tratar a resposta `codigo === 'perfil_obrigatorio'` (sessão vencida no meio): chamar `limparSessao(slug)` e reabrir `garantirPerfil()` em vez de mostrar erro cru.
6. Renderizar o modal perto do fim do JSX da página:
```tsx
      {pedindoIdentificacao && slug && (
        <ModalIdentificacao
          slug={slug}
          nomeInicial={nomeCliente}
          telefoneInicial={telefoneCliente}
          onCancelar={() => { setPedindoIdentificacao(false); resolverIdentificacao.current?.(false) }}
          onConcluir={(s) => {
            entrarCliente(s)
            setNomeCliente(s.nome)
            setTelefoneCliente(s.telefone)
            setPedindoIdentificacao(false)
            resolverIdentificacao.current?.(true)
          }}
        />
      )}
```
7. Link de topo "Entrar / Meu perfil": junto de onde o nome da loja é renderizado no cabeçalho (`grep -n "barraca_nome" src/pages/CardapioPublico.tsx`), um `<Link to={`/${slug}/perfil`}>` com texto `sessaoCliente ? sessaoCliente.nome.split(' ')[0] : 'Entrar'`, botão ghost de pelo menos 44 px (nunca mostarda).

- [ ] **Step 7: Verificar**

Run: `npm test && npx tsc -b && npm run lint`
Expected: PASS, lint ≤ 13 warnings. Depois, com o dev server do staging (`npx vite --mode staging --port 5199`): flag desligada → fechamento igual ao de antes; flag ligada → modal, código simulado preenche, pedido segue e fica com `cliente_id`; cancelar o modal volta ao carrinho sem perder nada; viewport mobile 375 px sem rolagem horizontal.

- [ ] **Step 8: Commit**

```bash
git add src/components/cliente src/lib/clientePerfil.ts src/pages/CardapioPublico.tsx tests/clientePerfil.test.ts
git commit -m "feat(cliente): identificação com código no fechamento do cardápio (atrás de flag)"
```

---

### Task 9: Página "Meu perfil" (endereços, histórico, pedir de novo, apagar)

**Files:**
- Create: `src/pages/PerfilCliente.tsx`
- Modify: `src/App.tsx` (rota)
- Test: `tests/clientePerfil.test.ts` (acrescentar `rotuloStatusPedido`/`resumoPedirDeNovo`) com `src/lib/clientePerfil.ts`

**Interfaces:**
- Consumes: `chamarSessao`, `lerSessao`, `useClienteSessao`, `ModalIdentificacao` (quando a sessão vencer).
- Produces: rota `/:slug/perfil`; `resumoPedirDeNovo(linhas): { montar: LinhaPedirDeNovo[]; avisos: string[]; bloqueados: LinhaPedirDeNovo[] }`; ao confirmar "Pedir de novo", grava os itens em `sessionStorage` na chave `saiae:pedir-de-novo:<slug>` (`[{ item_id, quantidade }]`) e navega a `/:slug/cardapio`, onde o carrinho os consome uma única vez.

- [ ] **Step 1: Teste do resumo (falha)**

```ts
import { resumoPedirDeNovo } from '../src/lib/clientePerfil.ts'

describe('resumoPedirDeNovo', () => {
  const l = (o: object) => ({ item_id: 'a', nome: 'X', quantidade: 1, status: 'ok', preco_atual_centavos: 1000, preco_antigo_centavos: 1000, ...o })
  test('ok e preço novo entram; o resto fica de fora com aviso', () => {
    const r = resumoPedirDeNovo([
      l({ item_id: '1' }),
      l({ item_id: '2', status: 'preco_mudou', preco_atual_centavos: 1200 }),
      l({ item_id: '3', status: 'esgotado' }),
      l({ item_id: '4', status: 'indisponivel' }),
      l({ item_id: '5', status: 'refazer_opcoes' }),
    ] as never)
    assert.deepEqual(r.montar.map((x) => x.item_id), ['1', '2'])
    assert.equal(r.bloqueados.length, 3)
    assert.equal(r.avisos.length, 4)
    assert.match(r.avisos.join(' '), /R\$ 12,00/)
  })
  test('nada utilizável: monta vazio', () => {
    const r = resumoPedirDeNovo([l({ status: 'indisponivel' })] as never)
    assert.equal(r.montar.length, 0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**; **Step 3: implementar** em `src/lib/clientePerfil.ts`:
```ts
import type { LinhaPedirDeNovo } from '../../supabase/functions/_shared/pedirDeNovo'

/** R$ 12,00 (mesmo formato de src/lib/preco.ts, copiado para manter este arquivo puro). */
function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`
}

export function resumoPedirDeNovo(linhas: LinhaPedirDeNovo[]) {
  const montar = linhas.filter((l) => l.status === 'ok' || l.status === 'preco_mudou')
  const bloqueados = linhas.filter((l) => !montar.includes(l))
  const avisos = linhas.flatMap((l) => {
    if (l.status === 'preco_mudou') return [`${l.nome}: o preço agora é ${reais(l.preco_atual_centavos ?? 0)}.`]
    if (l.status === 'esgotado') return [`${l.nome} está esgotado hoje.`]
    if (l.status === 'indisponivel') return [`${l.nome} não está mais no cardápio.`]
    if (l.status === 'refazer_opcoes') return [`${l.nome} tinha adicionais: escolha de novo no cardápio.`]
    return []
  })
  return { montar, avisos, bloqueados }
}
```
O `import type` é apagado na execução, então o Node roda o arquivo sem resolver o caminho; se o `tsc` reclamar dele, copiar só o `type` para este arquivo. Rodar `node --test tests/clientePerfil.test.ts` → PASS.

- [ ] **Step 4: A página `PerfilCliente.tsx`** com seções **Meus dados** (nome, promoções, avisos do pedido; botão Salvar), **Endereços** (lista, padrão, adicionar/editar/excluir, máximo 5), **Meus pedidos** (lista de `historico` com status e total, botão "Pedir de novo" que chama `pedir_de_novo`, mostra `avisos` num `BottomSheet` e, ao confirmar, grava `sessionStorage` e navega ao cardápio), **Sair** e **Apagar meus dados** (confirmação em `BottomSheet`, texto: "Vamos apagar seu perfil, endereços e histórico de dados pessoais. Os pedidos ficam registrados sem o seu nome."). Se `chamarSessao` devolver `sessaoInvalida`, abrir `ModalIdentificacao` e recarregar. Sem sessão ao abrir a página, mostrar "Entrar" que abre o mesmo modal. Seguir o padrão visual de `src/pages/Assinatura.tsx` (título `font-mesa-display`, `Card`, `Button` com um único primário mostarda por tela).

- [ ] **Step 5: Rota e consumo no carrinho**

Em `src/App.tsx`, ao lado de `/:slug/cardapio` (linha ~88): `<Route path="/:slug/perfil" element={<PerfilCliente />} />` + import. No `CardapioPublico.tsx`, um `useEffect` de montagem que lê `sessionStorage['saiae:pedir-de-novo:'+slug]`, remove a chave (uma vez só), e para cada `{item_id, quantidade}` cujo item exista em `estado.linhas` e não esteja esgotado, soma ao `carrinho` (mesma função que o botão "adicionar" usa; ver `setCarrinho`), tolerando JSON inválido.

- [ ] **Step 6: Verificar**

`npm test && npx tsc -b && npm run lint`. No staging: perfil completo, "pedir de novo" com um item esgotado de propósito mostra o aviso e não o inclui; "Apagar meus dados" apaga e volta ao cardápio sem sessão; mobile 375 px.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PerfilCliente.tsx src/App.tsx src/lib/clientePerfil.ts src/pages/CardapioPublico.tsx tests/clientePerfil.test.ts
git commit -m "feat(cliente): página Meu perfil com endereços, histórico, pedir de novo e apagar dados"
```

---

### Task 10: Tela "Clientes" do dono (Ajustes)

**Files:**
- Modify: `src/types/database.ts` (tipo `ClienteFinal`)
- Modify: `src/lib/clientesFinais.ts` (`COLUNAS`)
- Modify: `src/components/SecaoClientesEntrega.tsx`

**Interfaces:**
- Produces: `ClienteFinal` ganha `telefone_confirmado_em: string | null`, `consentimento_marketing_em: string | null`, e `rua/numero/bairro: string | null`.

- [ ] **Step 1:** Em `src/types/database.ts`, no tipo `ClienteFinal`: trocar `rua/numero/bairro` para `string | null` e acrescentar os dois campos acima como opcionais (`?`) para não quebrar cache antigo. Em `src/lib/clientesFinais.ts`, acrescentar `telefone_confirmado_em, consentimento_marketing_em` a `COLUNAS`, **com fallback**: se a leitura falhar com `bancoSemRecurso(error)` (importar de `./semMigration`), repetir com a lista antiga (banco sem a migration).
- [ ] **Step 2:** Rodar `npx tsc -b`: corrigir cada uso de `rua/numero/bairro` que agora pode ser `null` (inclusive `enderecoDoCliente` em `SecaoClientesEntrega.tsx`, que passa a devolver "Sem endereço" quando faltar).
- [ ] **Step 3:** Em `SecaoClientesEntrega.tsx`: trocar o rótulo `Clientes de entrega` por `Clientes`; em cada linha, um `Badge` (canto balão) "Telefone confirmado" quando `telefone_confirmado_em` existir, e "Aceita promoções" quando `consentimento_marketing_em` existir; a seção aparece sempre que houver cliente (não só com Entrega ligada); excluir continua como hoje (`excluirClienteFinal`) e agora também apaga sessões (cascata do banco).
- [ ] **Step 4:** `npm test && npx tsc -b && npm run lint` → PASS. Conferir no staging: lista mostra os selos; excluir um cliente com sessão invalida o token dele (401 em `cliente-sessao`).
- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts src/lib/clientesFinais.ts src/components/SecaoClientesEntrega.tsx
git commit -m "feat(cliente): tela Clientes do dono mostra telefone confirmado e consentimento"
```

---

### Task 11: Contrato, documentação e correção da spec

**Files:**
- Modify: `INTEGRACAO.md`
- Create: `docs/perfil-cliente.md`
- Modify: `docs/superpowers/specs/2026-10-08-perfil-cliente-final-design.md`

- [ ] **Step 1:** `INTEGRACAO.md`: nova seção "Código de verificação (Comanda → CRM)" com o endpoint `POST /api/integracao/comanda/v1/codigo-verificacao`, corpo `{ barraca_id, telefone, codigo, request_id }`, cabeçalhos e assinatura idênticos aos eventos, respostas (`200 { enviado: true }`, `401`, `422`, `429`, `502`), regra de que o CRM não guarda o código, e o segredo de plataforma `CRM_CODIGO_SEGREDO` (Comanda) = `COMANDA_CODIGO_SECRET` (CRM). Mudança aditiva da v1; PR precisa de aprovação da aorus-03.
- [ ] **Step 2:** `docs/perfil-cliente.md`: secrets (`CLIENTE_HASH_PEPPER`, `CRM_CODIGO_URL`, `CRM_CODIGO_SEGREDO`, `CODIGO_SIMULADO` só staging), como ligar `perfil_cliente_obrigatorio` por barraca, limites e `codigos_dia_max`, ordem de rollout (migration → functions → app → flag), como simular código no staging, e a lista dos riscos assumidos da spec.
- [ ] **Step 3:** Na spec: remover `apagado_em` da Parte 1 e da Parte 3 (exclusão física), acrescentar as flags `perfil_cliente_obrigatorio`/`codigos_dia_max`, `pagamentos_pendentes.cliente_id` e a RPC `perfil_cliente_config`.
- [ ] **Step 4: Commit**

```bash
git add INTEGRACAO.md docs/perfil-cliente.md docs/superpowers/specs/2026-10-08-perfil-cliente-final-design.md
git commit -m "docs(cliente): contrato do código, operação do perfil e correções da spec"
```

---

### Task 12: Teste ponta a ponta no staging e rollout

**Files:** nenhum arquivo novo (checklist registrado em `docs/perfil-cliente.md`).

- [ ] **Step 1: Suíte completa:** `npm test && npx tsc -b && npm run lint` → tudo verde, lint ≤ 13 warnings.
- [ ] **Step 2: Fluxo no staging (código simulado):** loja com a flag **ligada**: montar carrinho → finalizar → modal → código → pedido **na entrega** → conferir `pedidos.cliente_id`; repetir com **Pix** (a cobrança fica pendente no staging; conferir `pagamentos_pendentes.cliente_id`); abrir `/:slug/perfil`: dados, endereço salvo, histórico, "pedir de novo"; sair; entrar de novo com o mesmo telefone (assume o mesmo perfil, sem duplicar); apagar dados e conferir o pedido anonimizado.
- [ ] **Step 3: Abuso:** 4 pedidos de código seguidos (429 no 4º), 5 códigos errados (invalida), `website` preenchido (200 sem enviar), token de outra loja (401), código reutilizado (400), sessão revogada pelo dono (401).
- [ ] **Step 4: Rollout (cada passo só com a autorização do dono):** (1) aplicar a migration na produção; (2) publicar as 3 functions novas e as 3 alteradas; (3) definir os secrets de produção (`CLIENTE_HASH_PEPPER`, `CRM_CODIGO_URL`, `CRM_CODIGO_SEGREDO`; **nunca** `CODIGO_SIMULADO`); (4) publicar o app; (5) só quando o CRM (plano irmão) estiver no ar e o modelo da Meta aprovado, testar com 1 pedido real na `qa-teste-varredura` ligando a flag **só nela**; (6) as demais lojas ligam depois.
- [ ] **Step 5:** Registrar o resultado no `HANDOFF-ORQUESTRADOR.md` e abrir o PR final.

---

## Self-review (spec x plano)
- **Parte 1 (dados):** colunas, `cliente_enderecos`, `cliente_codigos`, `cliente_sessoes`, `pedidos.cliente_id`, RLS e backfill → Task 2. `apagado_em` removido (desvio 1, corrigido na Task 11).
- **Parte 2 (fluxo):** pedir/verificar código, limites, falhas, CRM → Tasks 1, 3, 4; contrato → Task 11 e plano do CRM.
- **Parte 3 (segurança/LGPD):** acesso por token (Task 5), hashes (Tasks 1, 4), consentimento e promoções (Tasks 2, 8), exclusão e anonimização (Tasks 2, 5, 9), telefone oculto: pedido segue sem perfil porque o front só exige perfil quando a flag está ligada e o cliente informa o telefone (o BSUID continua fora do escopo).
- **Parte 4 (telas):** modal (Task 8), perfil/histórico/pedir de novo/apagar (Task 9), Clientes do dono (Task 10), link "Entrar" (Task 8 item 7).
- **Obrigatório só no fechamento:** Task 6 (servidor, atrás de flag) e Task 8 (front).
- **Lacunas conhecidas e aceitas:** nenhuma tela de login fora do fechamento além de "Entrar" no topo; o `Input`/`BottomSheet` têm nomes de props que o executor confere nos arquivos reais (Task 8, passo 5) — está dito explicitamente porque não foram lidos.
- **Consistência de tipos:** `SessaoCliente`, `LinhaPedirDeNovo`, `decidirPerfil`, `autenticarSessao` e `hashSegredo` têm a mesma assinatura em todas as tasks.
