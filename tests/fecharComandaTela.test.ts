// Parte pura da tela de fechamento da comanda aberta. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bpsDePercentual, percentualDeBps } from '../src/lib/comandaAberta.ts'

describe('percentualDeBps', () => {
  test('mostra o percentual com vírgula e sem zeros sobrando', () => {
    assert.equal(percentualDeBps(1000), '10')
    assert.equal(percentualDeBps(750), '7,5')
    assert.equal(percentualDeBps(755), '7,55')
    assert.equal(percentualDeBps(0), '0')
    assert.equal(percentualDeBps(3000), '30')
  })
})

describe('bpsDePercentual', () => {
  test('converte percentual de 0 a 30 em bps', () => {
    assert.equal(bpsDePercentual('10'), 1000)
    assert.equal(bpsDePercentual('7,5'), 750)
    assert.equal(bpsDePercentual('7.5'), 750)
    assert.equal(bpsDePercentual(' 10 '), 1000)
    assert.equal(bpsDePercentual('0'), 0)
    assert.equal(bpsDePercentual('30'), 3000)
  })
  test('recusa fora de 0 a 30 e texto inválido', () => {
    for (const t of ['31', '30,1', 'abc', '', '  ', '-5', '7,555', '1,2,3', '1e1']) {
      assert.equal(bpsDePercentual(t), null, t)
    }
  })
})
