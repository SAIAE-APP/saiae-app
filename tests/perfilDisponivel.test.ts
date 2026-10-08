// Feature detection do perfil do cliente: sem a RPC no banco, o app fica como sempre foi. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decidirPerfil, PERFIL_INDISPONIVEL } from '../src/lib/perfilDisponivel.ts'

describe('decidirPerfil', () => {
  test('RPC existe: disponível, com a flag da loja', () => {
    assert.deepEqual(decidirPerfil({ data: [{ obrigatorio: false }], error: null }), { disponivel: true, obrigatorio: false })
    assert.deepEqual(decidirPerfil({ data: [{ obrigatorio: true }], error: null }), { disponivel: true, obrigatorio: true })
  })
  test('função inexistente (PGRST202 / 42883) ou qualquer erro: indisponível', () => {
    for (const error of [{ code: 'PGRST202', message: 'Could not find the function' }, { code: '42883' }, { message: 'Failed to fetch' }, 'x']) {
      assert.deepEqual(decidirPerfil({ data: null, error }), PERFIL_INDISPONIVEL)
    }
  })
  test('resposta vazia ou fora de forma: indisponível (loja inexistente também)', () => {
    for (const data of [[], null, undefined, {}, 'x', [null], [{}], [{ obrigatorio: 'true' }], [{ obrigatorio: 1 }]]) {
      assert.deepEqual(decidirPerfil({ data, error: null }), PERFIL_INDISPONIVEL, JSON.stringify(data))
    }
  })
  test('erro vence os dados', () => {
    assert.deepEqual(decidirPerfil({ data: [{ obrigatorio: true }], error: { code: 'x' } }), PERFIL_INDISPONIVEL)
  })
})
