// Lançar na Mesa com comanda aberta (Task 4). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { podeEnviarAReceber } from '../src/lib/pagarDepois.ts'
import { textoBotaoEnviar } from '../src/lib/comandaAberta.ts'

describe('podeEnviarAReceber com comanda aberta', () => {
  test('Mesa passa só com o interruptor da comanda ligado', () => {
    assert.equal(podeEnviarAReceber({ comanda_aberta_habilitada: true }, 'mesa'), true)
    assert.equal(podeEnviarAReceber({}, 'mesa'), false)
    assert.equal(podeEnviarAReceber({ comanda_aberta_habilitada: false }, 'mesa'), false)
  })
  test('Balcão nunca; Entrega e Retirada seguem como antes', () => {
    assert.equal(podeEnviarAReceber({ comanda_aberta_habilitada: true }, 'balcao'), false)
    assert.equal(podeEnviarAReceber({}, 'entrega'), true)
    assert.equal(podeEnviarAReceber({}, 'retirada'), false)
    assert.equal(podeEnviarAReceber({ pagamento_depois_habilitado: true }, 'retirada'), true)
  })
})

describe('textoBotaoEnviar', () => {
  test('modo comanda', () => {
    assert.equal(textoBotaoEnviar(true, '5', true), 'Adicionar à comanda da Mesa 5')
    assert.equal(textoBotaoEnviar(true, '5', false), 'Abrir comanda da Mesa 5')
    assert.equal(textoBotaoEnviar(true, ' 5 ', undefined), 'Enviar para a cozinha')
  })
  test('fora do modo comanda devolve o texto de sempre', () => {
    assert.equal(textoBotaoEnviar(false, '5', true), 'Confirmar e enviar')
  })
})
