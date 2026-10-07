// Modos que o cardápio público oferece ao consumidor. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modosDoCardapioPublico } from '../src/lib/atendimento.ts'

test('nunca oferece Mesa nem Balcão', () => {
  for (const salvos of [['mesa', 'balcao', 'retirada', 'entrega'], ['mesa'], ['balcao'], ['mesa', 'balcao']] as const) {
    for (const entrega of [true, false]) {
      const modos = modosDoCardapioPublico([...salvos], entrega)
      assert.ok(!modos.some((m) => (m as string) === 'mesa' || (m as string) === 'balcao'), String(modos))
    }
  }
})

test('barraca só com Mesa/Balcão cai em Retirada', () => {
  assert.deepEqual(modosDoCardapioPublico(['mesa', 'balcao'], true), ['retirada'])
  assert.deepEqual(modosDoCardapioPublico(['mesa'], false), ['retirada'])
})

test('resposta antiga (sem o campo) ou vazia: Retirada', () => {
  assert.deepEqual(modosDoCardapioPublico(undefined), ['retirada'])
  assert.deepEqual(modosDoCardapioPublico(null, true), ['retirada'])
  assert.deepEqual(modosDoCardapioPublico([], true), ['retirada'])
})

test('Entrega só com a barraca tendo ligado E o cardápio conseguindo finalizar', () => {
  assert.deepEqual(modosDoCardapioPublico(['retirada', 'entrega'], true), ['retirada', 'entrega'])
  assert.deepEqual(modosDoCardapioPublico(['mesa', 'entrega'], true), ['retirada', 'entrega'])
  assert.deepEqual(modosDoCardapioPublico(['retirada', 'entrega'], false), ['retirada'])
  assert.deepEqual(modosDoCardapioPublico(['retirada'], true), ['retirada'])
})
