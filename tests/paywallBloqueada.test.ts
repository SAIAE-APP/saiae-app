// Mensagem do paywall para conta bloqueada pelo admin. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { textoContaBloqueada } from '../src/lib/planos.ts'
import type { AssinaturaBarraca } from '../src/types/database.ts'

const base: AssinaturaBarraca = {
  status: 'canceled',
  plano: null,
  ciclo: null,
  tem_acesso: false,
  dias_restantes_trial: null,
  trial_ends_at: null,
  current_period_end: null,
  eh_dono: true,
}

describe('textoContaBloqueada', () => {
  test('devolve null quando não bloqueada', () => {
    assert.equal(textoContaBloqueada({ ...base, bloqueada: false }), null)
  })
  test('devolve null com cache antigo sem o campo', () => {
    assert.equal(textoContaBloqueada(base), null)
  })
  test('devolve a mensagem quando bloqueada', () => {
    assert.equal(
      textoContaBloqueada({ ...base, bloqueada: true }),
      'Sua conta está bloqueada. Fale com o suporte do Sai aê.',
    )
  })
})
