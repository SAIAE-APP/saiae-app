// Contato de balcão com consentimento de promoções: só salva com módulo ligado, não-Entrega, número válido e marca.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { contatoMarketingDoPedido } from '../src/lib/contatoMarketing.ts'

const base = {
  barracaId: 'b1',
  disparosHabilitado: true,
  ehEntrega: false,
  telefone: '(61) 99999-1234',
  nome: ' Ana ',
  aceitaPromocoes: true,
}

describe('contatoMarketingDoPedido', () => {
  test('com tudo certo devolve o contato normalizado', () => {
    assert.deepEqual(contatoMarketingDoPedido(base), { p_barraca_id: 'b1', p_telefone: '61999991234', p_nome: 'Ana' })
  })
  test('sem nome manda null (o banco usa "Cliente 1234")', () => {
    assert.equal(contatoMarketingDoPedido({ ...base, nome: '  ' })?.p_nome, null)
  })
  test('sem a marca do operador nada é guardado', () => {
    assert.equal(contatoMarketingDoPedido({ ...base, aceitaPromocoes: false }), null)
  })
  test('módulo desligado ou indefinido não guarda', () => {
    assert.equal(contatoMarketingDoPedido({ ...base, disparosHabilitado: false }), null)
    assert.equal(contatoMarketingDoPedido({ ...base, disparosHabilitado: undefined }), null)
  })
  test('Entrega não passa por aqui (o formulário de entrega já grava o cliente)', () => {
    assert.equal(contatoMarketingDoPedido({ ...base, ehEntrega: true }), null)
  })
  test('número curto ou longo demais é ignorado', () => {
    assert.equal(contatoMarketingDoPedido({ ...base, telefone: '1234567' }), null)
    assert.equal(contatoMarketingDoPedido({ ...base, telefone: '1234567890123456' }), null)
    assert.equal(contatoMarketingDoPedido({ ...base, telefone: '' }), null)
  })
})
