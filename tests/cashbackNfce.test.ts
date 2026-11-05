// Cashback na NFC-e: o saldo usado é desconto por item, como o cupom (um benefício por pedido). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { descontoTotalNfceCentavos, ratearDesconto, totalDaNotaCentavos } from '../supabase/functions/_shared/descontoNfce.ts'

describe('descontoTotalNfceCentavos', () => {
  test('só saldo ou só cupom devolve o próprio valor', () => {
    assert.equal(descontoTotalNfceCentavos(0, 500), 500)
    assert.equal(descontoTotalNfceCentavos(300, 0), 300)
    assert.equal(descontoTotalNfceCentavos(0, 0), 0)
  })
  test('SUPOSIÇÃO-CASHBACK-4: cupom e saldo juntos lançam RangeError', () => {
    assert.throws(() => descontoTotalNfceCentavos(300, 200), RangeError)
  })
  test('valor inválido vira zero (nunca desconto negativo ou fracionado)', () => {
    assert.equal(descontoTotalNfceCentavos(0, -50), 0)
    assert.equal(descontoTotalNfceCentavos(0, 250.9), 250)
  })
  test('rateado entre os itens, a soma é o saldo e a nota vale itens menos saldo', () => {
    const brutos = [1000, 3000]
    const desconto = descontoTotalNfceCentavos(0, 400)
    const partes = ratearDesconto(brutos, desconto)
    assert.equal(partes.reduce((a, b) => a + b, 0), 400)
    assert.equal(totalDaNotaCentavos(brutos, desconto), 3600)
  })
})

describe('emitir-nfce/handler.ts', () => {
  const texto = readFileSync(new URL('../supabase/functions/emitir-nfce/handler.ts', import.meta.url), 'utf8')
  test('lê cashback_usado_centavos num select separado e tolerante', () => {
    assert.match(texto, /\.select\('cashback_usado_centavos'\)/)
    assert.doesNotMatch(texto, /select\('desconto_cupom_centavos,\s*cashback_usado_centavos'\)/)
  })
  test('o desconto da nota usa descontoTotalNfceCentavos', () => {
    assert.match(texto, /descontoTotalNfceCentavos\(/)
  })
  test('rateio e pedido grátis usam o desconto somado, não só o do cupom', () => {
    assert.doesNotMatch(texto, /totalDaNotaCentavos\([^)]*descontoCupomCentavos\)/s)
    assert.match(texto, /ratearDesconto\([\s\S]*?descontoNotaCentavos/)
  })
})
