// Tempo de preparo nunca negativo (card do Histórico "-1 min de preparo"): criado_em vem do servidor e
// pronto_em/entregue_em do relógio do aparelho. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { minutosEntre } from '../src/lib/tempoPedido.ts'

describe('minutosEntre', () => {
  test('conta normal arredonda para o minuto mais próximo', () => {
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:58:00Z'), 10)
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:48:40Z'), 1)
  })
  test('fim ANTES do início (relógio do aparelho atrasado) vira 0, nunca negativo', () => {
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:47:00Z'), 0)
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:46:30Z'), 0)
    assert.ok(!Object.is(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:47:50Z'), -0), 'sem -0')
  })
  test('mesmo instante e data inválida dão 0', () => {
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', '2026-10-12T17:48:00Z'), 0)
    assert.equal(minutosEntre('lixo', '2026-10-12T17:48:00Z'), 0)
    assert.equal(minutosEntre('2026-10-12T17:48:00Z', ''), 0)
  })
})
