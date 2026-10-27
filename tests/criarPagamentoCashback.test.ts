import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calcularResgate } from '../src/lib/cashbackRegras.ts'

const src = readFileSync(new URL('../supabase/functions/criar-pagamento-pix/index.ts', import.meta.url), 'utf8')

test('criar-pagamento-pix importa cashbackPedido e cashback e lê usar_cashback do corpo', () => {
  assert.match(src, /_shared\/cashbackPedido\.ts/)
  assert.match(src, /descontoDoBeneficio/)
  assert.match(src, /usar_cashback\?: boolean/)
  assert.match(src, /usar: body\.usar_cashback/)
})

test('SUPOSIÇÃO-CASHBACK-4: o total cobrado usa o desconto do benefício (cupom OU saldo)', () => {
  assert.match(src, /descontoCentavos: descontoBeneficio/)
  assert.match(src, /descontoDoBeneficio\(descontoCentavos, cashbackCentavos\)/)
})

test('avaliação de saldo vem depois do cupom e a reserva depois do pendente gravado', () => {
  const iCupom = src.indexOf('avaliarCupomDoPedido(supabase')
  const iAval = src.indexOf('avaliarCashbackDoPedido(supabase')
  const iPend = src.indexOf(".from('pagamentos_pendentes')\n      .insert(")
  const iReserva = src.indexOf('reservarCashbackDoPedido(supabase')
  assert.ok(iCupom > 0 && iAval > iCupom, 'avaliar saldo depois do cupom')
  assert.ok(iPend > iAval && iReserva > iPend, 'reservar depois de gravar o pendente')
  assert.ok(src.indexOf('liberarCashbackAbandonado(supabase') < iAval, 'liberar abandonadas antes de avaliar')
})

test('retry da cobrança emitida inclui o saldo usado no total esperado', () => {
  assert.match(src, /Number\(pendenteExistente\.desconto_cupom_centavos \?\? 0\) \+ Number\(pendenteExistente\.cashback_usado_centavos \?\? 0\)/)
})

test('falha da cobrança libera a reserva também quando só há saldo', () => {
  assert.doesNotMatch(src, /if \(cupomCodigo\) await supabase\.rpc\('cupom_liberar'/)
  assert.match(src, /cupomCodigo \|\| cashbackCentavos > 0/)
})

test('grava cashback_usado_centavos e cashback_uso_id no pendente e responde cashback_usado_centavos', () => {
  assert.match(src, /cashback_usado_centavos: res\.resgate, cashback_uso_id: res\.usoId/)
  assert.match(src, /cashback_usado_centavos: cashbackCentavos/)
})

test('não toca na taxa da plataforma', () => {
  assert.doesNotMatch(src, /TAXA_PLATAFORMA/)
  assert.match(src, /taxaPlataformaCentavos/)
})

test('o piso garante que o saldo nunca zera o pedido (ramo de pedido grátis inalcançável com saldo)', () => {
  for (const itens of [100, 101, 150, 1999, 4000, 100000]) {
    const r = calcularResgate({ saldoDisponivel: 10_000_000, itens, tetoUsoPct: 90 })
    assert.ok(itens - r >= 100, `itens ${itens}, resgate ${r}`)
    assert.ok(r < itens)
  }
})
