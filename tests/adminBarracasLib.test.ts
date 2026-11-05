// Constantes e funções puras do painel de barracas do superadmin.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FILTROS_ADMIN } from '../src/lib/adminBarracas.ts'

describe('FILTROS_ADMIN', () => {
  test('inclui os filtros novos', () => {
    const valores = FILTROS_ADMIN.map((f) => f.valor)
    assert.deepEqual(valores, [null, 'vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado', 'arquivada'])
  })
})
