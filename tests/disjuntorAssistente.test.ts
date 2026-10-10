import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { assistenteSuspenso, registrarSalto, JANELA_MS, LIMITE_SALTOS } from '../src/lib/disjuntorAssistente.ts'

function memoria() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('disjuntor do assistente', () => {
  test('poucos redirecionamentos não suspendem', () => {
    const a = memoria()
    for (let i = 0; i < LIMITE_SALTOS - 1; i++) registrarSalto(1000 + i, a)
    assert.equal(assistenteSuspenso(a), false)
  })
  test('vai e vem acima do limite na janela suspende o assistente', () => {
    const a = memoria()
    for (let i = 0; i < LIMITE_SALTOS; i++) registrarSalto(1000 + i * 100, a)
    assert.equal(assistenteSuspenso(a), true)
  })
  test('saltos espaçados (fora da janela) não suspendem', () => {
    const a = memoria()
    for (let i = 0; i < LIMITE_SALTOS * 2; i++) registrarSalto(i * (JANELA_MS + 1), a)
    assert.equal(assistenteSuspenso(a), false)
  })
  test('sem armazenamento não quebra e não suspende', () => {
    registrarSalto(1, null)
    assert.equal(assistenteSuspenso(null), false)
  })
})
