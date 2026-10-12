/* eslint-disable @typescript-eslint/no-explicit-any -- banco simulado dos testes */
// Backfill dos tokens cifrados: EXECUTA o núcleo com banco simulado. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { backfillCompleto, executarBackfill } from '../scripts/backfillTokensCifrados.ts'
import { configDoEnv, decifrar } from '../supabase/functions/_shared/segredoCifrado.ts'

const CHAVE = Buffer.alloc(32, 3).toString('base64')
const env = { get: (n: string) => ({ TOKENS_CHAVE_V1: CHAVE })[n] }
const cfg = configDoEnv(env)
type Linha = Record<string, any>

function criarDb() {
  const tabelas: Record<string, Linha[]> = { barracas_fiscal_token: [], barracas_pagamento_token: [] }
  const estado = { quebrarUpdateDe: null as string | null, chamadasUpdate: 0 }
  const from = (tabela: string) => {
    const filtros: Array<(r: Linha) => boolean> = []
    let op: 'select' | 'update' = 'select'
    let valores: Linha = {}
    let contagem = false
    let limite = Infinity
    const q: any = {
      select: (_c: string, o?: { head?: boolean }) => ((contagem = !!o?.head), q),
      not: (c: string) => (filtros.push((r) => r[c] !== null && r[c] !== undefined), q),
      neq: (c: string, v: unknown) => (filtros.push((r) => r[c] !== v), q),
      is: (c: string) => (filtros.push((r) => r[c] === null || r[c] === undefined), q),
      eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
      order: () => q,
      limit: (n: number) => ((limite = n), q),
      update: (v: Linha) => ((op = 'update'), (valores = v), q),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const alvo = tabelas[tabela].filter((r) => filtros.every((f) => f(r)))
        if (op === 'update') {
          estado.chamadasUpdate++
          if (estado.quebrarUpdateDe && alvo.some((r) => r.barraca_id === estado.quebrarUpdateDe)) {
            return Promise.resolve({ data: null, error: { message: 'x' } }).then(ok, ko)
          }
          alvo.forEach((r) => Object.assign(r, valores))
          return Promise.resolve({ data: alvo.map((r) => ({ barraca_id: r.barraca_id })), error: null }).then(ok, ko)
        }
        if (contagem) return Promise.resolve({ count: alvo.length, error: null }).then(ok, ko)
        return Promise.resolve({ data: alvo.slice(0, limite).map((r) => ({ ...r })), error: null }).then(ok, ko)
      },
    }
    return q
  }
  return { tabelas, estado, db: { from } }
}

const semear = (d: ReturnType<typeof criarDb>) => {
  d.tabelas.barracas_fiscal_token.push(
    { barraca_id: 'b1', token_homologacao: 'h1', token_producao: 'p1', token_homologacao_cifrado: null, token_producao_cifrado: null },
    { barraca_id: 'b2', token_homologacao: 'h2', token_producao: null, token_homologacao_cifrado: null, token_producao_cifrado: null },
  )
  d.tabelas.barracas_pagamento_token.push(
    { barraca_id: 'b1', provedor: 'mercadopago', access_token: 'a1', segredo_webhook: 's1', access_token_cifrado: null, segredo_webhook_cifrado: null },
    { barraca_id: 'b2', provedor: 'mercadopago', access_token: 'a2', segredo_webhook: null, access_token_cifrado: null, segredo_webhook_cifrado: null },
  )
}

describe('backfill dos tokens cifrados', () => {
  test('simulação: só conta, não altera nada', async () => {
    const d = criarDb()
    semear(d)
    const rel = await executarBackfill(d.db, env, { aplicar: false })
    assert.equal(d.estado.chamadasUpdate, 0)
    const porCampo = Object.fromEntries(rel.map((r) => [r.campo, r.pendentes_antes]))
    assert.deepEqual(porCampo, { token_homologacao: 2, token_producao: 1, access_token: 2, segredo_webhook: 1 })
    assert.ok(rel.every((r) => r.cifrados_agora === 0))
    assert.equal(backfillCompleto(rel), false)
  })

  test('aplicar: cifra tudo, confere decifrando, mantém o texto e fecha com pendentes_depois = 0', async () => {
    const d = criarDb()
    semear(d)
    const rel = await executarBackfill(d.db, env, { aplicar: true, lote: 1, agora: () => Date.parse('2026-10-27T12:00:00Z') })
    assert.equal(backfillCompleto(rel), true)
    assert.deepEqual(rel.map((r) => [r.campo, r.cifrados_agora, r.falhas, r.pendentes_depois]), [
      ['token_homologacao', 2, 0, 0],
      ['token_producao', 1, 0, 0],
      ['access_token', 2, 0, 0],
      ['segredo_webhook', 1, 0, 0],
    ])
    const b1 = d.tabelas.barracas_fiscal_token[0]
    assert.equal(await decifrar(b1.token_homologacao_cifrado, { barracaId: 'b1', campo: 'token_homologacao' }, cfg), 'h1')
    assert.equal(b1.token_homologacao, 'h1', 'o texto NÃO é apagado (fase 3)')
    assert.equal(b1.cifrado_chave, '1')
    assert.equal(rel.find((r) => r.campo === 'token_homologacao')?.com_texto, 2)
    assert.equal(rel.find((r) => r.campo === 'token_homologacao')?.com_cifrado, 2)
    assert.equal(d.tabelas.barracas_fiscal_token[1].token_producao_cifrado, null, 'campo vazio fica vazio')
  })

  test('idempotente: a 2ª execução não grava nem recifra nada', async () => {
    const d = criarDb()
    semear(d)
    await executarBackfill(d.db, env, { aplicar: true })
    const antes = JSON.stringify(d.tabelas)
    const gravacoes = d.estado.chamadasUpdate
    const rel = await executarBackfill(d.db, env, { aplicar: true })
    assert.equal(JSON.stringify(d.tabelas), antes)
    assert.equal(d.estado.chamadasUpdate, gravacoes)
    assert.ok(rel.every((r) => r.pendentes_antes === 0 && r.cifrados_agora === 0))
  })

  test('não sobrescreve um cifrado gravado no meio (corrida com salvar-credencial)', async () => {
    const d = criarDb()
    d.tabelas.barracas_fiscal_token.push({ barraca_id: 'b1', token_homologacao: 'h1', token_producao: null, token_homologacao_cifrado: 'v1.novo.novo', token_producao_cifrado: null })
    const rel = await executarBackfill(d.db, env, { aplicar: true })
    assert.equal(d.tabelas.barracas_fiscal_token[0].token_homologacao_cifrado, 'v1.novo.novo')
    assert.equal(rel[0].cifrados_agora, 0)
  })

  test('falha numa linha: conta a falha, segue com as outras, não entra em laço e o relatório não fecha', async () => {
    const d = criarDb()
    semear(d)
    d.estado.quebrarUpdateDe = 'b1'
    const rel = await executarBackfill(d.db, env, { aplicar: true, lote: 1 })
    assert.equal(backfillCompleto(rel), false)
    const h = rel.find((r) => r.campo === 'token_homologacao')!
    assert.equal(h.falhas, 1)
    assert.equal(h.cifrados_agora, 1)
    assert.equal(h.pendentes_depois, 1)
    assert.ok(!JSON.stringify(rel).includes('h1'), 'o relatório não carrega valores')
  })

  test('aplicar sem chave: recusa antes de tocar em qualquer coisa', async () => {
    const d = criarDb()
    semear(d)
    await assert.rejects(executarBackfill(d.db, { get: () => undefined }, { aplicar: true }), /não configurada/)
    assert.equal(d.estado.chamadasUpdate, 0)
  })

  test('texto vazio não conta como pendente', async () => {
    const d = criarDb()
    d.tabelas.barracas_fiscal_token.push({ barraca_id: 'b1', token_homologacao: '', token_producao: null, token_homologacao_cifrado: null, token_producao_cifrado: null })
    const rel = await executarBackfill(d.db, env, { aplicar: false })
    assert.equal(rel[0].pendentes_antes, 0)
  })
})
