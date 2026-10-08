// Cupom no Pix: total descontado só nos itens, reserva ligada à cobrança, vaga devolvida se a cobrança falha.
// Rodar: npm test (a prova de comportamento está em tests/cuponsPix.staging.mjs)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { totalCobrado } from '../supabase/functions/_shared/cupom.ts'

const pix = readFileSync(new URL('../supabase/functions/criar-pagamento-pix/index.ts', import.meta.url), 'utf8')
const mig = readFileSync(new URL('../supabase/migrations/20261018111000_cupons_mesmo_cliente.sql', import.meta.url), 'utf8')

describe('totalCobrado', () => {
  test('itens − desconto + taxa (a taxa nunca é descontada)', () => {
    assert.equal(totalCobrado(5000, 500, 700), 5200)
    assert.equal(totalCobrado(5000, 0, 700), 5700)
    assert.equal(totalCobrado(100, 0, 0), 100)
  })
})

describe('criar-pagamento-pix com cupom', () => {
  test('aceita só o código; o desconto vem do banco', () => {
    assert.match(pix, /cupom_codigo\?: string \| null/)
    assert.doesNotMatch(pix, /body\.desconto|desconto_cupom_centavos\?:/)
    assert.match(pix, /rpc\('cupom_avaliar'/)
    assert.match(pix, /rpc\('cupom_reservar'/)
  })
  test('total esperado é conferido contra o total JÁ descontado', () => {
    assert.match(pix, /totalCobrado\(totalCentavos, descontoCentavos, taxaEntregaCentavos\)/)
    assert.ok(pix.indexOf("rpc('cupom_avaliar'") < pix.indexOf('esperado !== totalCobradoCentavos'))
  })
  test('reserva dura até o Pix vencer e é ligada à cobrança', () => {
    assert.match(pix, /p_reservado_ate: expiraEm\.toISOString\(\)/)
    assert.match(pix, /p_pendente_id: pendente\.id/)
  })
  test('falha da cobrança no provedor devolve a vaga', () => {
    const catchBloco = pix.slice(pix.indexOf('} catch (erro) {'))
    assert.match(catchBloco, /rpc\('cupom_liberar'/)
  })
  test('retry do QR já emitido compara com o total descontado', () => {
    assert.match(pix, /Number\(pendenteExistente\.desconto_cupom_centavos \?\? 0\)/)
  })
  test('cupom conta tentativa (mesmo limite de adivinhação) e perda de corrida não cobra', () => {
    assert.match(pix, /rpc\('cupom_registrar_tentativa'/)
    assert.match(pix, /codigo: 'cupom_tentativas'/)
    assert.match(pix, /Perdeu a corrida/)
  })
  test('sem cupom, o fluxo antigo segue (cupom só entra se enviado)', () => {
    assert.match(pix, /if \(cupomBruto !== ''\)/)
  })
})

describe('migration: uma vez por cliente não trava quem refaz o checkout', () => {
  test('só confirmado conta e as outras reservas do cliente são liberadas', () => {
    const regras = mig.slice(0, mig.indexOf('create or replace function public.cupom_reservar'))
    assert.match(regras, /cliente_id = p_cliente_id and estado = 'confirmado'/)
    assert.doesNotMatch(regras, /cliente_id = p_cliente_id\s+and \(estado/)
    assert.match(mig, /if c\.uma_por_cliente and p_cliente_id is not null then\s+update public\.cupom_usos set estado = 'liberado'/)
  })
  test('mesmas assinaturas e sem novo grant', () => {
    assert.doesNotMatch(mig, /grant execute|drop function/)
  })
})
