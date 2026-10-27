// Cashback: regras puras de crédito, resgate e validade. Os vetores vêm de tests/fixtures/cashback-vetores.json,
// o MESMO arquivo que o teste de staging usa contra as funções SQL. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  CASHBACK_CREDITO_MAX_CENTAVOS,
  CASHBACK_FAIXAS,
  CASHBACK_PADRAO,
  CASHBACK_PISO_ITENS_CENTAVOS,
  calcularCredito,
  calcularResgate,
  expiraEm,
  itensLiquidosCentavos,
  saldoVigente,
  validarConfigCashback,
} from '../src/lib/cashbackRegras.ts'

const vetores = JSON.parse(readFileSync(new URL('./fixtures/cashback-vetores.json', import.meta.url), 'utf8'))

describe('constantes', () => {
  test('SUPOSIÇÃO-CASHBACK-3: padrão 5% e 60 dias, faixas 1–15% e 30–90 dias', () => {
    assert.deepEqual(CASHBACK_PADRAO, { percentualBp: 500, validadeDias: 60, tetoUsoPct: 50 })
    assert.deepEqual(CASHBACK_FAIXAS.percentualBp, [100, 1500])
    assert.deepEqual(CASHBACK_FAIXAS.validadeDias, [30, 90])
    assert.deepEqual(CASHBACK_FAIXAS.tetoUsoPct, [10, 90])
    assert.equal(CASHBACK_CREDITO_MAX_CENTAVOS, 2000)
    assert.equal(CASHBACK_PISO_ITENS_CENTAVOS, 100)
  })
})

describe('itensLiquidosCentavos', () => {
  for (const v of vetores.liquidos) {
    test(v.nome, () => assert.equal(itensLiquidosCentavos(v.itens, v.beneficio), v.esperado))
  }
})

describe('calcularCredito', () => {
  for (const v of vetores.credito) {
    test(v.nome, () => assert.equal(calcularCredito(v.itensLiquidos, v.percentualBp), v.esperado))
  }
  test('SUPOSIÇÃO-CASHBACK-4: pedido com saldo usado credita sobre a base líquida', () => {
    assert.equal(calcularCredito(itensLiquidosCentavos(4000, 1000), 500), 150)
  })
  test('entrada não inteira ou negativa lança RangeError', () => {
    assert.throws(() => calcularCredito(10.5, 500), RangeError)
    assert.throws(() => calcularCredito(-1, 500), RangeError)
    assert.throws(() => calcularCredito(1000, 5.5), RangeError)
  })
})

describe('calcularResgate', () => {
  for (const v of vetores.resgate) {
    test(v.nome, () => assert.equal(calcularResgate({ saldoDisponivel: v.saldo, itens: v.itens, tetoUsoPct: v.tetoUsoPct }), v.esperado))
  }
  test('o resgate nunca zera os itens', () => {
    for (const itens of [1, 100, 101, 150, 1000, 99999]) {
      const r = calcularResgate({ saldoDisponivel: 10 ** 7, itens, tetoUsoPct: 90 })
      assert.ok(itens - r >= Math.min(itens, CASHBACK_PISO_ITENS_CENTAVOS), `itens ${itens}`)
      assert.ok(r < itens || itens === 0)
    }
  })
  test('negativo ou não inteiro lança RangeError', () => {
    assert.throws(() => calcularResgate({ saldoDisponivel: -1, itens: 1000, tetoUsoPct: 50 }), RangeError)
    assert.throws(() => calcularResgate({ saldoDisponivel: 100, itens: -1, tetoUsoPct: 50 }), RangeError)
    assert.throws(() => calcularResgate({ saldoDisponivel: 100, itens: 1000.5, tetoUsoPct: 50 }), RangeError)
  })
})

describe('expiraEm', () => {
  test('soma dias corridos em UTC', () => {
    assert.equal(expiraEm('2026-11-01T12:00:00.000Z', 60), '2026-12-31T12:00:00.000Z')
    assert.equal(expiraEm('2026-12-15T00:00:00.000Z', 30), '2027-01-14T00:00:00.000Z')
  })
  test('base inválida ou dias não inteiros lançam RangeError', () => {
    assert.throws(() => expiraEm('nao-e-data', 60), RangeError)
    assert.throws(() => expiraEm('2026-11-01T00:00:00.000Z', 1.5), RangeError)
  })
})

describe('saldoVigente', () => {
  for (const v of vetores.validade) {
    test(v.nome, () => assert.deepEqual(saldoVigente({ lancamentos: v.lancamentos, agoraISO: v.agoraISO }), { saldo: v.saldo, venceEm: v.venceEm }))
  }
})

describe('validarConfigCashback', () => {
  for (const v of vetores.config) {
    test(v.nome, () => {
      const r = validarConfigCashback({ percentualBp: v.percentualBp, validadeDias: v.validadeDias, tetoUsoPct: v.tetoUsoPct })
      assert.equal(r.ok, v.ok)
      if (!r.ok) {
        assert.equal(r.campo, v.campo)
        assert.ok(r.mensagem.length > 0)
      }
    })
  }
  test('valor não inteiro é recusado', () => {
    assert.equal(validarConfigCashback({ percentualBp: 500.5, validadeDias: 60, tetoUsoPct: 50 }).ok, false)
  })
})
