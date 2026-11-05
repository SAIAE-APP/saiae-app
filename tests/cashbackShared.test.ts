// Cashback: interpretação da resposta do banco, textos ao cliente e a regra "um benefício por pedido". Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { descontoDoBeneficio, interpretarResgate, mensagemDoErroCashback } from '../supabase/functions/_shared/cashback.ts'

describe('interpretarResgate', () => {
  test('ok com resgate inteiro e campos opcionais', () => {
    assert.deepEqual(interpretarResgate({ ok: true, resgate_centavos: 200 }), { ok: true, resgate_centavos: 200 })
    assert.deepEqual(
      interpretarResgate({ ok: true, resgate_centavos: 200, uso_id: 'u1', saldo_centavos: 500, vence_em: '2026-12-31T00:00:00Z' }),
      { ok: true, resgate_centavos: 200, uso_id: 'u1', saldo_centavos: 500, vence_em: '2026-12-31T00:00:00Z' },
    )
    assert.deepEqual(interpretarResgate({ ok: true, resgate_centavos: 0, vence_em: null }), { ok: true, resgate_centavos: 0, vence_em: null })
  })
  test('erro conhecido repassa o código; sem código vira invalido', () => {
    assert.deepEqual(interpretarResgate({ ok: false, erro: 'sem_saldo' }), { ok: false, erro: 'sem_saldo' })
    assert.deepEqual(interpretarResgate({ ok: false }), { ok: false, erro: 'invalido' })
  })
  test('resposta fora de forma nunca vira desconto', () => {
    const lixo: unknown[] = [
      { ok: true, resgate_centavos: -1 },
      { ok: true, resgate_centavos: 1.5 },
      { ok: true, resgate_centavos: '200' },
      { ok: true },
      { ok: true, resgate_centavos: 100, saldo_centavos: -5 },
      { resgate_centavos: 100 },
      null,
      undefined,
      'ok',
    ]
    for (const d of lixo) assert.deepEqual(interpretarResgate(d), { ok: false, erro: 'invalido' }, JSON.stringify(d))
  })
})

describe('mensagemDoErroCashback', () => {
  test('um texto para cada erro da spec', () => {
    assert.equal(mensagemDoErroCashback('sem_cliente'), 'Confirme seu telefone para usar seu saldo.')
    assert.equal(mensagemDoErroCashback('sem_saldo'), 'Você não tem saldo disponível.')
    assert.equal(mensagemDoErroCashback('itens_baixos'), 'O saldo não pode pagar todo o pedido.')
    assert.equal(mensagemDoErroCashback('cupom_e_saldo'), 'Cupom e saldo não somam. Use um por pedido.')
  })
  test('erro desconhecido nunca vaza detalhe', () => {
    assert.equal(mensagemDoErroCashback('alguma_coisa_interna'), 'Não foi possível usar o saldo agora. Tente de novo.')
  })
})

describe('descontoDoBeneficio', () => {
  test('SUPOSIÇÃO-CASHBACK-4: um benefício por pedido, cupom e saldo juntos lançam RangeError', () => {
    assert.throws(() => descontoDoBeneficio(500, 200), RangeError)
  })
  test('só um dos dois soma normalmente', () => {
    assert.equal(descontoDoBeneficio(0, 200), 200)
    assert.equal(descontoDoBeneficio(500, 0), 500)
    assert.equal(descontoDoBeneficio(0, 0), 0)
  })
})
