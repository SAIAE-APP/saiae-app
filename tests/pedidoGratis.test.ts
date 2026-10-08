// Pedido grátis (cupom cobre tudo): decisão, telefone obrigatório e argumentos da RPC. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { argsPedidoGratis, ehPedidoGratis, METODO_GRATIS, telefoneDoPedidoGratis } from '../supabase/functions/_shared/pedidoGratis.ts'

const base = {
  usoId: 'u1', barracaId: 'b1', mesa: null, viagem: true, observacao: null, clientUuid: 'c1',
  itens: [{ item_id: 'i' }], entrega: null, taxaEntregaCentavos: 0, clienteNome: null, clienteTelefone: null,
}

describe('ehPedidoGratis', () => {
  test('só total cobrado zero; com taxa a pagar segue o Pix', () => {
    assert.equal(ehPedidoGratis(0), true)
    assert.equal(ehPedidoGratis(1), false)
    assert.equal(ehPedidoGratis(500), false)
  })
})

describe('telefoneDoPedidoGratis', () => {
  test('exige telefone válido; o da entrega vence o do aviso; só dígitos', () => {
    assert.equal(telefoneDoPedidoGratis({ telefoneEntrega: null, telefoneAviso: null }), null)
    assert.equal(telefoneDoPedidoGratis({ telefoneEntrega: '', telefoneAviso: '123' }), null)
    assert.equal(telefoneDoPedidoGratis({ telefoneEntrega: undefined, telefoneAviso: '(11) 99999-0000' }), '11999990000')
    assert.equal(telefoneDoPedidoGratis({ telefoneEntrega: '11988887777', telefoneAviso: '11999990000' }), '11988887777')
  })
})

describe('argsPedidoGratis', () => {
  test('pedido comum: método gratis e uso do cupom; sem args de entrega', () => {
    const a = argsPedidoGratis(base)
    assert.equal(a.p_metodo_pagamento, METODO_GRATIS)
    assert.equal(a.p_uso_id, 'u1')
    assert.ok(!('p_tipo_atendimento' in a) && !('p_entrega' in a) && !('p_cliente_telefone' in a))
  })
  test('entrega e telefone entram só quando existem', () => {
    const a = argsPedidoGratis({
      ...base, clienteTelefone: '11999990000', clienteNome: 'Ana', taxaEntregaCentavos: 0,
      entrega: { nome: 'Ana', telefone: '11999990000', rua: 'R', numero: '1', bairro: 'B', referencia: null, consentimento_lgpd_em: 'x' },
    })
    assert.equal(a.p_tipo_atendimento, 'entrega')
    assert.equal(a.p_cliente_telefone, '11999990000')
    assert.equal(a.p_cliente_nome, 'Ana')
    assert.ok(!JSON.stringify(a.p_entrega).includes('consentimento'))
  })
})

describe('criar-pagamento-pix (guardas estáticas)', () => {
  const f = readFileSync(new URL('../supabase/functions/criar-pagamento-pix/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  test('o pedido grátis nasce antes de qualquer chamada ao provedor Pix', () => {
    assert.ok(f.indexOf("'criar_pedido_com_cupom'") > 0)
    assert.ok(f.indexOf("'criar_pedido_com_cupom'") < f.indexOf('provedor.criarCobranca('))
    assert.match(f, /codigo: 'telefone_obrigatorio'/)
    assert.match(f, /pedido_gratis: true, senha: jaCriado\.senha/)
  })
  test('migration aceita o método gratis e mantém os anteriores', () => {
    const m = readFileSync(new URL('../supabase/migrations/20261019140000_metodo_pagamento_gratis.sql', import.meta.url), 'utf8')
    assert.match(m, /'dinheiro', 'debito', 'credito', 'pix', 'na_entrega', 'gratis'/)
  })
})
