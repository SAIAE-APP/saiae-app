// Confirmação e liberação do cupom (webhook do Pix e "pagar na entrega"). Rodar: npm test
// A prova de comportamento está em tests/cuponsWebhook.staging.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { totalEsperadoDoPendente } from '../supabase/functions/_shared/pagamento/conciliacao.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const webhook = ler('supabase/functions/webhook-mercadopago/index.ts')
const entrega = ler('supabase/functions/criar-pedido-cardapio/index.ts')
const mig = ler('supabase/migrations/20261018112000_cupom_liberar_uso.sql')

describe('totalEsperadoDoPendente (valor que o Pix deve ter)', () => {
  const itens = [{ quantidade: 2, preco_centavos_unitario: 2500 }]
  test('sem cupom: conta de antes (itens + taxa)', () => {
    assert.equal(totalEsperadoDoPendente(itens, 700), 5700)
  })
  test('com cupom: desconta só os itens; a taxa fica inteira', () => {
    assert.equal(totalEsperadoDoPendente(itens, 700, 500), 5200)
  })
})

describe('webhook do Pix', () => {
  test('confere o valor pago contra o total JÁ descontado do pendente', () => {
    assert.match(webhook, /Number\(pendente\.desconto_cupom_centavos \?\? 0\)/)
  })
  test('aprovado confirma o uso ANTES de marcar o pendente aprovado (falha = 500, o provedor reenvia)', () => {
    const iConfirma = webhook.indexOf("rpc('cupom_confirmar'")
    const iAprova = webhook.indexOf("update({ status: 'aprovado'")
    assert.ok(iConfirma > 0 && iAprova > iConfirma)
    assert.match(webhook, /falha ao confirmar o cupom' \}, 500\)/)
  })
  test('expirado e rejeitado liberam a vaga', () => {
    assert.equal((webhook.match(/rpc\('cupom_liberar', \{ p_pendente_id: pendente\.id \}\)/g) ?? []).length, 2)
  })
  test('só confirma quando o pendente tem uso de cupom (sem cupom, fluxo de antes)', () => {
    assert.match(webhook, /if \(pendente\.cupom_uso_id\) \{/)
  })
})

describe('pagar na entrega', () => {
  test('reserva curta sem cobrança, cria o pedido e confirma direto', () => {
    assert.match(entrega, /pendenteId: null/)
    const iReserva = entrega.indexOf('reservarCupomDoPedido(')
    const iCria = entrega.indexOf("rpc('criar_pedido'")
    const iConfirma = entrega.indexOf("rpc('cupom_confirmar'")
    assert.ok(iReserva > 0 && iCria > iReserva && iConfirma > iCria)
  })
  test('falha em criar_pedido libera a reserva', () => {
    const bloco = entrega.slice(entrega.indexOf('if (erroPedido || !criado) {'))
    assert.match(bloco.slice(0, 300), /cupom_liberar_uso/)
  })
  test('total esperado vale com cupom mesmo sem entrega estruturada', () => {
    assert.match(entrega, /if \(entregaEstruturada \|\| cupomCodigo\) \{/)
    assert.match(entrega, /totalCobrado\(totalCentavos, descontoCentavos, taxaEntregaCentavos\)/)
  })
  test('só o código viaja; o desconto não vem do corpo', () => {
    assert.match(entrega, /cupom_codigo\?: string \| null/)
    assert.doesNotMatch(entrega, /body\.desconto/)
  })
})

describe('migration cupom_liberar_uso', () => {
  test('nunca mexe em confirmado e só o papel de serviço executa', () => {
    assert.match(mig, /where id = p_uso_id and estado = 'reservado'/)
    assert.match(mig, /revoke all on function public\.cupom_liberar_uso\(uuid\) from public, anon, authenticated/)
    assert.match(mig, /grant execute on function public\.cupom_liberar_uso\(uuid\) to service_role/)
  })
})
