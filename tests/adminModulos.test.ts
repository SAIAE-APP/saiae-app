import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  PRECO_MODULO_CENTAVOS,
  PRECO_PACOTE_WHATSAPP_CENTAVOS,
  TAXA_ATIVACAO_FISCAL_CENTAVOS,
  mensagemDoEstado,
  termoParaEnviar,
  teste30Dias,
} from '../src/lib/adminModulos.ts'

describe('adminModulos', () => {
  test('mensagemDoEstado traduz os quatro estados', () => {
    for (const e of ['termo_obrigatorio', 'dependencia', 'invalido', 'nao_autorizado']) {
      const m = mensagemDoEstado(e)
      assert.notEqual(m, e)
      assert.match(m, /[a-zà-ú]/i)
    }
    assert.match(mensagemDoEstado('termo_obrigatorio'), /termo/i)
    assert.match(mensagemDoEstado('dependencia'), /avisos/i)
    assert.match(mensagemDoEstado('ok'), /salv|ok|feito/i)
  })
  test('precos conferem com o design (39,90 / 39,90 / 69,90 / 69,90, pacote 139,90, ativação 99)', () => {
    assert.deepEqual(PRECO_MODULO_CENTAVOS, { whatsapp_avisos: 3990, whatsapp_disparos: 3990, whatsapp_bot: 6990, fiscal: 6990 })
    assert.equal(PRECO_PACOTE_WHATSAPP_CENTAVOS, 13990)
    assert.equal(TAXA_ATIVACAO_FISCAL_CENTAVOS, 9900)
  })
  test('teste30Dias soma 30 dias exatos', () => {
    const base = new Date('2026-11-03T12:00:00.000Z')
    assert.equal(teste30Dias(base), '2026-12-03T12:00:00.000Z')
    assert.equal(base.toISOString(), '2026-11-03T12:00:00.000Z')
  })
  test('termoParaEnviar só manda o termo ao ativar ou testar', () => {
    assert.equal(termoParaEnviar('ativo', 'v2'), 'v2')
    assert.equal(termoParaEnviar('teste', 'v2'), 'v2')
    assert.equal(termoParaEnviar('suspenso', 'v2'), undefined)
    assert.equal(termoParaEnviar('cancelado', 'v2'), undefined)
    assert.equal(termoParaEnviar('ativo', undefined), undefined)
  })
})
