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
