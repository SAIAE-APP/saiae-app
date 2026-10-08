// Telefone do cliente final (servidor e app usam a mesma regra). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizarTelefone, telefoneValido } from '../supabase/functions/_shared/telefone.ts'

describe('normalizarTelefone', () => {
  test('tira máscara e o 55 quando sobram 12 ou 13 dígitos', () => {
    assert.equal(normalizarTelefone('+55 (61) 99953-1848'), '61999531848')
    assert.equal(normalizarTelefone('556133334444'), '6133334444')
  })
  test('com 10 ou 11 dígitos o 55 é o DDD de Santa Maria e fica', () => {
    assert.equal(normalizarTelefone('55 99999-1234'), '55999991234')
  })
})

describe('telefoneValido', () => {
  test('aceita fixo (10) e celular (11) com DDD', () => {
    assert.equal(telefoneValido('(61) 99953-1848'), true)
    assert.equal(telefoneValido('6133334444'), true)
  })
  test('recusa sem DDD, curto, longo e texto', () => {
    for (const t of ['99953-1848', '', 'abc', '123456789012345', '5561']) assert.equal(telefoneValido(t), false, t)
  })
})
