// Parte pura da tela de fechamento da comanda aberta. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { bpsDePercentual, percentualDeBps, textoBotaoFecharComanda, textoComandaFechada } from '../src/lib/comandaAberta.ts'

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

describe('textoComandaFechada', () => {
  test('usa o total devolvido pelo servidor quando existe', () => {
    assert.equal(textoComandaFechada('5', 4400, 4000, false), 'Mesa 5 fechada: R$ 44,00.')
  })
  test('sem total do servidor, usa o total da tela', () => {
    assert.equal(textoComandaFechada('5', undefined, 4000, false), 'Mesa 5 fechada: R$ 40,00.')
  })
  test('comanda vazia: encerrada sem cobrança', () => {
    assert.equal(textoComandaFechada('7', 0, 0, true), 'Mesa 7 encerrada sem cobrança.')
  })
})

describe('textoBotaoFecharComanda', () => {
  test('vazia encerra; com rodada fecha e cobra', () => {
    assert.equal(textoBotaoFecharComanda(0), 'Encerrar comanda vazia')
    assert.equal(textoBotaoFecharComanda(2), 'Fechar comanda e cobrar')
  })
})
