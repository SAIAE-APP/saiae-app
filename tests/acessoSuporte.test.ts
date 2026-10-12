import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ALFABETO_CODIGO_SUPORTE,
  formatoCodigoSuporteValido,
  normalizarCodigoSuporte,
} from '../src/lib/acessoSuporte.ts'
import { formatarDataCurta } from '../src/lib/datas.ts'

test('alfabeto não tem 0, O, 1, I, L, não repete caracteres — e tem 31, não 32', () => {
  for (const c of '0O1IL') assert.ok(!ALFABETO_CODIGO_SUPORTE.includes(c), c)
  assert.equal(ALFABETO_CODIGO_SUPORTE.length, new Set(ALFABETO_CODIGO_SUPORTE).size)
  // 31 não divide 256: a geração do código (suporte_gerar_codigo, na migration)
  // usa amostragem por rejeição por causa disso, não "% 31" direto — um teste
  // que assumisse 32 aqui teria escondido o viés de módulo achado em revisão.
  assert.equal(ALFABETO_CODIGO_SUPORTE.length, 31)
})

test('normaliza maiúsculas e remove espaços/traços', () => {
  assert.equal(normalizarCodigoSuporte(' ab-cd 2345 '), 'ABCD2345')
})

test('formato válido só com 8 caracteres do alfabeto', () => {
  assert.equal(formatoCodigoSuporteValido('ABCD2345'), true)
  assert.equal(formatoCodigoSuporteValido('ABCD234'), false)
  assert.equal(formatoCodigoSuporteValido('ABCD23456'), false)
  assert.equal(formatoCodigoSuporteValido('ABCD023I'), false)
})

test('data curta DD/MM', () => {
  assert.equal(formatarDataCurta(new Date(2026, 2, 5, 12, 0, 0)), '05/03')
  assert.equal(formatarDataCurta(new Date(2026, 10, 30, 12, 0, 0)), '30/11')
})
