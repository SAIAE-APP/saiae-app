// Cupom no cardápio (lado do cliente): corpo da chamada, resposta e "recurso desligado". Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  decidirCupomConfig,
  interpretarValidacao,
  mensagemDoErroCupom,
  montarCorpoValidacao,
  normalizarCodigoCupom,
  textoDesconto,
  totalComCupom,
} from '../src/lib/cupomApi.ts'

describe('normalizarCodigoCupom', () => {
  test('maiúsculas, sem espaços nas pontas', () => {
    assert.equal(normalizarCodigoCupom('  feira10 '), 'FEIRA10')
    assert.equal(normalizarCodigoCupom('Feira_10-b'), 'FEIRA_10-B')
  })
  test('curto, longo, com espaço no meio ou símbolo: null', () => {
    for (const ruim of ['ab', 'A'.repeat(21), 'FE IRA', 'FEIRA!', '', '   ']) assert.equal(normalizarCodigoCupom(ruim), null, ruim)
    assert.equal(normalizarCodigoCupom(null as unknown as string), null)
  })
})

describe('decidirCupomConfig', () => {
  test('só habilitado === true liga', () => {
    assert.equal(decidirCupomConfig({ data: [{ habilitado: true }], error: null }), true)
    assert.equal(decidirCupomConfig({ data: [{ habilitado: false }], error: null }), false)
  })
  test('função ausente, erro, vazio ou fora de forma: desligado', () => {
    for (const r of [
      { data: null, error: { code: 'PGRST202' } },
      { data: null, error: { code: '42883' } },
      { data: [], error: null }, // a função devolve vazio quando a loja não ligou
      { data: null, error: null },
      { data: [{}], error: null },
      { data: [{ habilitado: 'true' }], error: null },
      { data: [{ habilitado: true }], error: { message: 'x' } },
    ]) {
      assert.equal(decidirCupomConfig(r), false, JSON.stringify(r))
    }
  })
})

describe('montarCorpoValidacao', () => {
  test('manda só código, ids e token: nunca preço, total ou desconto', () => {
    const corpo = montarCorpoValidacao({
      slug: 'loja',
      codigo: 'FEIRA10',
      itens: [
        { item_id: 'a', quantidade: 2, preco_centavos_unitario: 1, desconto_centavos: 999, total_centavos: 1 } as never,
        { item_id: 'b', quantidade: 1, opcao_ids: ['o1'], observacao: 'sem cebola' },
        { item_id: 'c', quantidade: 1, opcao_ids: [], observacao: '' },
      ],
      token: 'tok',
    })
    assert.deepEqual(corpo, {
      barraca_slug: 'loja',
      codigo: 'FEIRA10',
      itens: [
        { item_id: 'a', quantidade: 2 },
        { item_id: 'b', quantidade: 1, opcao_ids: ['o1'], observacao: 'sem cebola' },
        { item_id: 'c', quantidade: 1 },
      ],
      sessao_token: 'tok',
    })
    assert.ok(!/desconto|preco|total/.test(JSON.stringify(corpo)))
  })
  test('sem token, sem o campo', () => {
    assert.ok(!('sessao_token' in montarCorpoValidacao({ slug: 's', codigo: 'ABC', itens: [], token: null })))
  })
})

describe('interpretarValidacao', () => {
  const ok = { ok: true, desconto_centavos: 500, subtotal_centavos: 3000, total_itens_centavos: 2500 }
  test('sucesso devolve os valores do servidor', () => {
    assert.deepEqual(interpretarValidacao('FEIRA10', { status: 200, corpo: ok }), {
      ok: true,
      codigo: 'FEIRA10',
      descontoCentavos: 500,
      subtotalCentavos: 3000,
      totalItensCentavos: 2500,
    })
  })
  test('sucesso malformado nunca vira desconto (negativo, não inteiro, maior que o subtotal, ausente)', () => {
    for (const ruim of [
      { ...ok, desconto_centavos: -1 },
      { ...ok, desconto_centavos: 1.5 },
      { ...ok, desconto_centavos: 3001 },
      { ...ok, subtotal_centavos: undefined },
      { ok: true },
      { ...ok, desconto_centavos: '500' },
    ]) {
      assert.equal(interpretarValidacao('X', { status: 200, corpo: ruim }).ok, false, JSON.stringify(ruim))
    }
  })
  test('erro com mensagem do servidor usa a mensagem; sem ela, a da spec', () => {
    const comMsg = interpretarValidacao('X', { status: 422, corpo: { ok: false, erro: 'venceu', mensagem: 'Este cupom venceu' } })
    assert.ok(!comMsg.ok && comMsg.mensagem === 'Este cupom venceu')
    const semMsg = interpretarValidacao('X', { status: 422, corpo: { ok: false, erro: 'esgotou' } })
    assert.ok(!semMsg.ok && semMsg.mensagem === 'Este cupom esgotou')
  })
  test('precisa_login e limite de tentativas são sinalizados', () => {
    const login = interpretarValidacao('X', { status: 422, corpo: { ok: false, erro: 'precisa_login' } })
    assert.ok(!login.ok && login.precisaLogin && !login.limite)
    const limite = interpretarValidacao('X', { status: 429, corpo: { erro: 'x' } })
    assert.ok(!limite.ok && limite.limite && !limite.precisaLogin)
  })
  test('sem rede, corpo vazio ou 500: mensagem genérica, sem lançar', () => {
    for (const r of [{ status: 0, corpo: null }, { status: 500, corpo: undefined }, { status: 200, corpo: 'x' }]) {
      const res = interpretarValidacao('X', r)
      assert.ok(!res.ok && /Não foi possível/.test(res.mensagem))
    }
  })
})

describe('mensagens e valores', () => {
  test('mínimo formata em reais', () => {
    assert.equal(mensagemDoErroCupom('minimo', 3000), 'Vale a partir de R$ 30,00 em itens')
    assert.equal(mensagemDoErroCupom('invalido'), 'Cupom inválido')
    assert.equal(mensagemDoErroCupom('nao_comecou'), 'Este cupom ainda não começou')
    assert.equal(mensagemDoErroCupom('ja_usou'), 'Você já usou este cupom')
    assert.equal(mensagemDoErroCupom('precisa_login'), 'Entre com seu telefone para usar este cupom')
  })
  test('textoDesconto e total', () => {
    assert.equal(textoDesconto(500), '−R$ 5,00')
    assert.equal(totalComCupom(3000, 500, 400), 2900)
    assert.equal(totalComCupom(3000, 5000, 0), 0) // exibição nunca negativa
    assert.equal(totalComCupom(3000, 0), 3000)
  })
})
