// normalizarCnpj (supabase/functions/_shared/cnpj.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizarCnpj } from '../supabase/functions/_shared/cnpj.ts'

test('normaliza máscara e valida o dígito verificador', () => {
  assert.equal(normalizarCnpj('11.222.333/0001-81'), '11222333000181')
  assert.equal(normalizarCnpj('11222333000181'), '11222333000181')
})

test('recusa dígito errado, tamanho errado, dígitos repetidos e valores não textuais', () => {
  assert.equal(normalizarCnpj('11222333000182'), null)
  assert.equal(normalizarCnpj('1122233300018'), null)
  assert.equal(normalizarCnpj('00000000000000'), null)
  assert.equal(normalizarCnpj(null), null)
  assert.equal(normalizarCnpj(undefined), null)
  assert.equal(normalizarCnpj(''), null)
})
