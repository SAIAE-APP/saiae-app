// Webhook do Pix com cupom: o valor esperado é o DESCONTADO e a decisão (criar pedido / conciliar / ignorar)
// segue as regras de sempre. Rodar: npm test. O teste real fica para o Pix de R$ 1 em produção (loja de teste).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { decidirAprovado, totalEsperadoDoPendente } from '../supabase/functions/_shared/pagamento/conciliacao.ts'

const webhook = readFileSync(new URL('../supabase/functions/webhook-mercadopago/index.ts', import.meta.url), 'utf8')

// Pendente de exemplo: 2 × R$ 25,00 de itens, R$ 7,00 de entrega, cupom de R$ 5,00 => Pix de R$ 52,00.
const itens = [{ quantidade: 2, preco_centavos_unitario: 2500 }]
const esperado = totalEsperadoDoPendente(itens, 700, 500)

describe('aprovado com desconto', () => {
  test('o Pix descontado (R$ 52,00) cria o pedido', () => {
    assert.equal(esperado, 5200)
    assert.deepEqual(decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 5200, totalEsperadoCentavos: esperado }), {
      acao: 'criar_pedido',
      tardio: false,
    })
  })
  test('pagar o valor CHEIO (R$ 57,00) com cupom no pendente não passa: vai para conciliação, sem pedido', () => {
    assert.deepEqual(decidirAprovado({ statusPendente: 'pendente', valorPagoCentavos: 5700, totalEsperadoCentavos: esperado }), {
      acao: 'conciliar_valor',
    })
  })
  test('sem cupom no pendente a conta é a de antes', () => {
    assert.equal(totalEsperadoDoPendente(itens, 700), 5700)
    assert.equal(totalEsperadoDoPendente(itens, 700, 0), 5700)
  })
})

describe('webhook duplicado e fora de ordem', () => {
  test('notificação repetida de pendente já aprovado é ignorada (não confirma o cupom de novo)', () => {
    assert.deepEqual(decidirAprovado({ statusPendente: 'aprovado', valorPagoCentavos: 5200, totalEsperadoCentavos: esperado }), { acao: 'ignorar' })
  })
  test('rejeitado também é final', () => {
    assert.deepEqual(decidirAprovado({ statusPendente: 'rejeitado', valorPagoCentavos: 5200, totalEsperadoCentavos: esperado }), { acao: 'ignorar' })
  })
  test('aprovado DEPOIS de expirado ainda cria o pedido (tardio) — o pagamento nunca é recusado', () => {
    assert.deepEqual(decidirAprovado({ statusPendente: 'expirado', valorPagoCentavos: 5200, totalEsperadoCentavos: esperado }), {
      acao: 'criar_pedido',
      tardio: true,
    })
  })
})

describe('ordem das chamadas do cupom no webhook', () => {
  const iAprovado = webhook.indexOf("update({ status: 'aprovado'")
  test('confirma o uso só depois de existir pedido e ANTES de marcar o pendente aprovado', () => {
    const iPedido = webhook.indexOf('const pedidoId = desfecho.pedidoId')
    const iConfirma = webhook.indexOf("rpc('cupom_confirmar'")
    assert.ok(iPedido > 0 && iConfirma > iPedido && iAprovado > iConfirma)
  })
  test('falha ao confirmar devolve 500 (o provedor reenvia; confirmar é idempotente)', () => {
    assert.match(webhook, /falha ao confirmar o cupom' \}, 500\)/)
  })
  test('só confirma quando o pendente tem uso de cupom', () => {
    assert.match(webhook, /if \(pendente\.cupom_uso_id\) \{/)
  })
  test('expirado e rejeitado devolvem a vaga; aprovado não libera', () => {
    const blocoAprovado = webhook.slice(webhook.indexOf('const pedidoId = desfecho.pedidoId'), iAprovado)
    assert.doesNotMatch(blocoAprovado, /cupom_liberar/)
    const fim = webhook.slice(webhook.indexOf("if (leitura.status === 'expirado')"))
    assert.equal((fim.match(/rpc\('cupom_liberar'/g) ?? []).length, 2)
  })
  test('liberar só atua em pendente aberto: a liberação vem depois do update condicional de status', () => {
    assert.match(webhook, /\.eq\('status', 'pendente'\)\n\s+await supabase\.rpc\('cupom_liberar'/)
  })
})
