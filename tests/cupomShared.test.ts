// Cupons: normalização do código, mensagens ao cliente e leitura da resposta do banco. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { interpretarAvaliacao, mensagemDoErro, normalizarCodigo } from '../supabase/functions/_shared/cupom.ts'

describe('normalizarCodigo', () => {
  test('minúsculas viram maiúsculas e espaços das pontas saem', () => {
    assert.equal(normalizarCodigo('feira10'), 'FEIRA10')
    assert.equal(normalizarCodigo('  Feira-10 '), 'FEIRA-10')
    assert.equal(normalizarCodigo('a_b'), 'A_B')
  })
  test('curto, longo, com espaço no meio ou símbolo => null', () => {
    for (const t of ['ab', 'A'.repeat(21), 'FE IRA', 'FEIRA!', '', '   ', null, undefined]) {
      assert.equal(normalizarCodigo(t), null, String(t))
    }
    assert.equal(normalizarCodigo('A'.repeat(20)), 'A'.repeat(20))
    assert.equal(normalizarCodigo('ABC'), 'ABC')
  })
})

describe('mensagemDoErro', () => {
  test('um texto para cada erro da spec', () => {
    assert.equal(mensagemDoErro('invalido'), 'Cupom inválido')
    assert.equal(mensagemDoErro('venceu'), 'Este cupom venceu')
    assert.equal(mensagemDoErro('nao_comecou'), 'Este cupom ainda não começou')
    assert.equal(mensagemDoErro('esgotou'), 'Este cupom esgotou')
    assert.equal(mensagemDoErro('ja_usou'), 'Você já usou este cupom')
    assert.equal(mensagemDoErro('precisa_login'), 'Entre com seu telefone para usar este cupom')
  })
  test('mínimo formata em reais', () => {
    assert.equal(mensagemDoErro('minimo', 3000), 'Vale a partir de R$ 30,00 em itens')
    assert.equal(mensagemDoErro('minimo', 1550), 'Vale a partir de R$ 15,50 em itens')
  })
  test('erro desconhecido nunca vaza detalhe', () => {
    assert.equal(mensagemDoErro('alguma_coisa_interna'), 'Cupom inválido')
  })
})

describe('interpretarAvaliacao', () => {
  test('ok com desconto inteiro', () => {
    assert.deepEqual(interpretarAvaliacao({ ok: true, cupom_id: 'c1', codigo: 'FEIRA10', desconto_centavos: 500 }), {
      ok: true, cupom_id: 'c1', codigo: 'FEIRA10', desconto_centavos: 500,
    })
  })
  test('erro carrega o mínimo', () => {
    assert.deepEqual(interpretarAvaliacao({ ok: false, erro: 'minimo', minimo_centavos: 3000 }), { ok: false, erro: 'minimo', minimo_centavos: 3000 })
  })
  test('resposta estranha ou desconto inválido = inválido', () => {
    for (const d of [null, undefined, {}, { ok: true }, { ok: true, cupom_id: 'c', desconto_centavos: -1 }, { ok: true, cupom_id: 'c', desconto_centavos: 1.5 }]) {
      assert.equal(interpretarAvaliacao(d).ok, false)
    }
  })
})
