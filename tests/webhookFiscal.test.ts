/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// webhook-stripe: assinaturas do módulo Fiscal (metadata.tipo = 'fiscal') EXECUTADAS com supabase e fetch simulados.
// Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { tratarWebhookStripe } from '../supabase/functions/_shared/stripeWebhook.ts'
import { BancoFiscal, stripeSimulada, type Chamada, type Rota } from './fakesFiscal.ts'

const SEGREDO = 'whsec_teste'
const AGORA_MS = Date.UTC(2026, 10, 18, 12, 0, 0)
const AGORA_S = Math.floor(AGORA_MS / 1000)
const DIA = 86400
const BARRACA = '11111111-1111-4111-8111-111111111111'
const CNPJ = '11222333000181'
const META = { tipo: 'fiscal', usuario_id: 'u1', barraca_id: BARRACA, cnpj: CNPJ, termo_versao: 'termos-2026-10-v1', reserva_id: 'f1' }

async function hmac(texto: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let banco: BancoFiscal
let chamadas: Chamada[]
let rotas: Record<string, Rota>

const subStripe = (opcoes: { price: string; fim: number; meta?: Record<string, string>; status?: string }) => ({
  status: 200,
  corpo: { status: opcoes.status ?? 'active', metadata: opcoes.meta ?? {}, items: { data: [{ price: { id: opcoes.price }, current_period_end: opcoes.fim }] } },
})

async function enviar(evento: Record<string, unknown>) {
  const corpo = JSON.stringify(evento)
  const req = new Request('https://x/webhook-stripe', {
    method: 'POST',
    body: corpo,
    headers: { 'Stripe-Signature': `t=${AGORA_S},v1=${await hmac(`${AGORA_S}.${corpo}`)}` },
  })
  return tratarWebhookStripe(req, {
    supabase: banco as any,
    fetch: stripeSimulada(rotas, chamadas),
    segredoWebhook: SEGREDO,
    stripeSecretKey: 'sk_teste',
    agoraMs: () => AGORA_MS,
  })
}
const ev = (id: string, type: string, created: number, object: Record<string, unknown>) => ({ id, type, created, data: { object } })
const sessaoFiscal = (id: string, sessao = 'cs_f', sub = 'sub_f', pago = 'paid', created = AGORA_S) =>
  ev(id, 'checkout.session.completed', created, { id: sessao, subscription: sub, customer: 'cus_1', payment_status: pago, metadata: META })
const faturaFiscal = (id: string, tipo: 'invoice.paid' | 'invoice.payment_failed', created: number, sub = 'sub_f') =>
  ev(id, tipo, created, { parent: { subscription_details: { subscription: sub, metadata: META } } })

const fiscal = () => banco.tabelas.fiscal_assinaturas[0]
const base = () => banco.tabelas.assinaturas[0]
const modulos = () => banco.rpcChamadas.filter((c) => c.nome === 'fiscal_sincronizar_modulo')
const fim1 = AGORA_S + 30 * DIA

beforeEach(() => {
  banco = new BancoFiscal()
  banco.tabelas.assinaturas = [
    { usuario_id: 'u1', status: 'active', plan: 'ponto', cycle: 'anual', stripe_subscription_id: 'sub_base', stripe_evento_em: null, current_period_end: '2027-06-01T00:00:00.000Z' },
  ]
  banco.tabelas.assinatura_ofertas = [
    { stripe_price_id: 'price_base_anual', plano: 'ponto', ciclo: 'anual', ativo: true },
    { stripe_price_id: 'price_fiscal', plano: 'fiscal', ciclo: 'mensal', ativo: true },
  ]
  banco.tabelas.fiscal_assinaturas = [
    { id: 'f1', usuario_id: 'u1', barraca_id: BARRACA, cnpj: CNPJ, status: 'pendente', stripe_checkout_session_id: 'cs_f', stripe_subscription_id: null, stripe_evento_em: null },
  ]
  chamadas = []
  rotas = { 'GET subscriptions/sub_f': subStripe({ price: 'price_fiscal', fim: fim1, meta: META }) }
})

describe('webhook fiscal', () => {
  test('ativação: checkout pago vincula a assinatura, fica active e liga o módulo até o fim do período', async () => {
    const r = await enviar(sessaoFiscal('e1'))
    assert.equal(r.status, 200)
    assert.equal(fiscal().status, 'active')
    assert.equal(fiscal().stripe_subscription_id, 'sub_f')
    assert.equal(fiscal().stripe_customer_id, 'cus_1')
    assert.equal(fiscal().current_period_end, new Date(fim1 * 1000).toISOString())
    assert.equal(modulos().length, 1)
    // O módulo é sincronizado pelo estado da linha (RPC transacional), com o termo da metadata.
    assert.deepEqual(modulos()[0].args, { p_barraca_id: BARRACA, p_termo_versao: 'termos-2026-10-v1' })
  })

  test('sem metadata.termo_versao: NÃO liga o módulo em silêncio (500, Stripe reenvia, nada ativado)', async () => {
    const semTermo: Record<string, string> = { ...META }
    delete semTermo.termo_versao
    const evento = ev('e1', 'checkout.session.completed', AGORA_S, { id: 'cs_f', subscription: 'sub_f', customer: 'cus_1', payment_status: 'paid', metadata: semTermo })
    const r = await enviar(evento)
    assert.equal(r.status, 500)
    assert.equal(modulos().length, 0)
    assert.equal(fiscal().status, 'pendente')
    assert.equal(banco.tabelas.eventos_webhook_stripe.length, 0)
  })

  test('boleto/pagamento pendente só vincula; o invoice.paid ativa', async () => {
    await enviar(sessaoFiscal('e1', 'cs_f', 'sub_f', 'unpaid'))
    assert.equal(fiscal().status, 'pendente')
    assert.equal(fiscal().stripe_subscription_id, 'sub_f')
    assert.equal(modulos().length, 0)
    await enviar(faturaFiscal('e2', 'invoice.paid', AGORA_S + 5))
    assert.equal(fiscal().status, 'active')
    assert.equal(modulos().length, 1)
  })

  test('falha de pagamento: past_due com carência de 3 dias; a RPC reflete o novo estado; retry de falha NÃO estende a carência', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(faturaFiscal('e2', 'invoice.payment_failed', AGORA_S + 10))
    assert.equal(fiscal().status, 'past_due')
    assert.equal(fiscal().grace_until, new Date(AGORA_MS + 3 * DIA * 1000).toISOString())
    assert.equal(modulos().length, 2)
    assert.equal(modulos()[1].args.p_termo_versao, null)
    const carencia = fiscal().grace_until
    await enviar(faturaFiscal('e3', 'invoice.payment_failed', AGORA_S + 3600))
    assert.equal(fiscal().grace_until, carencia, 'segunda falha não renova os 3 dias')
  })

  test('renovação: invoice.paid volta a active, limpa a carência e estende o módulo', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(faturaFiscal('e2', 'invoice.payment_failed', AGORA_S + 10))
    const fim2 = fim1 + 30 * DIA
    rotas['GET subscriptions/sub_f'] = subStripe({ price: 'price_fiscal', fim: fim2, meta: META })
    await enviar(faturaFiscal('e3', 'invoice.paid', AGORA_S + 20))
    assert.equal(fiscal().status, 'active')
    assert.equal(fiscal().grace_until, null)
    assert.equal(fiscal().current_period_end, new Date(fim2 * 1000).toISOString())
    assert.equal(modulos().length, 3)
  })

  test('evento atrasado não sobrescreve o mais novo', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(faturaFiscal('e2', 'invoice.paid', AGORA_S + 100))
    const r = await enviar(faturaFiscal('e3', 'invoice.payment_failed', AGORA_S + 50))
    assert.equal(r.status, 200)
    assert.equal(fiscal().status, 'active')
  })

  test('cancelamento no fim do período: canceled com fim do período, módulo ressincronizado; reativar volta a active', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(ev('e2', 'customer.subscription.updated', AGORA_S + 10, { id: 'sub_f', metadata: META, cancel_at_period_end: true, items: { data: [{ current_period_end: fim1 }] } }))
    assert.equal(fiscal().status, 'canceled')
    assert.equal(fiscal().current_period_end, new Date(fim1 * 1000).toISOString())
    assert.equal(modulos().length, 2)
    await enviar(ev('e3', 'customer.subscription.updated', AGORA_S + 20, { id: 'sub_f', metadata: META, cancel_at_period_end: false, items: { data: [{ current_period_end: fim1 }] } }))
    assert.equal(fiscal().status, 'active')
  })

  test('subscription.deleted: expired e módulo cancelado', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(ev('e2', 'customer.subscription.deleted', AGORA_S + 10, { id: 'sub_f', metadata: META, items: { data: [{ current_period_end: fim1 }] } }))
    assert.equal(fiscal().status, 'expired')
    assert.equal(modulos().length, 2) // ressincronizou com a linha expired (a RPC desliga o módulo da cobrança)
  })

  test('reembolso total expira e cancela o módulo; parcial não altera', async () => {
    await enviar(sessaoFiscal('e1'))
    rotas['GET invoices/in_f'] = { status: 200, corpo: { parent: { subscription_details: { subscription: 'sub_f' } } } }
    await enviar(ev('e2', 'charge.refunded', AGORA_S + 10, { refunded: false, invoice: 'in_f' }))
    assert.equal(fiscal().status, 'active')
    await enviar(ev('e3', 'charge.refunded', AGORA_S + 20, { refunded: true, invoice: 'in_f' }))
    assert.equal(fiscal().status, 'expired')
    assert.equal(modulos().length, 2)
    assert.equal(base().status, 'active')
  })

  test('reentrega do mesmo evento é idempotente (módulo ligado uma vez)', async () => {
    assert.equal((await enviar(sessaoFiscal('e1'))).status, 200)
    const r = await enviar(sessaoFiscal('e1'))
    assert.equal((await r.json()).duplicado, true)
    assert.equal(modulos().length, 1)
  })

  test('segunda subscription fiscal paga para a mesma barraca: cancelada na Stripe e a viva NÃO é sobrescrita', async () => {
    await enviar(sessaoFiscal('e1'))
    rotas['GET subscriptions/sub_dup'] = subStripe({ price: 'price_fiscal', fim: fim1, meta: META })
    rotas['DELETE subscriptions/sub_dup'] = { status: 200, corpo: { status: 'canceled' } }
    const r = await enviar(sessaoFiscal('e2', 'cs_outra', 'sub_dup', 'paid', AGORA_S + 30))
    assert.equal(r.status, 200)
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.url === 'subscriptions/sub_dup'))
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 1)
    assert.equal(fiscal().stripe_subscription_id, 'sub_f')
    assert.equal(fiscal().status, 'active')
    assert.equal(modulos().length, 1)
    // O delete da duplicada chega depois e é ignorado (sem linha vinculada), sem derrubar a viva.
    const d = await enviar(ev('e3', 'customer.subscription.deleted', AGORA_S + 40, { id: 'sub_dup', metadata: META }))
    assert.equal(d.status, 200)
    assert.equal(fiscal().status, 'active')
  })

  test('duplicada por invoice.paid (chegou antes do checkout): cancelada, viva intacta', async () => {
    await enviar(sessaoFiscal('e1'))
    rotas['GET subscriptions/sub_dup'] = subStripe({ price: 'price_fiscal', fim: fim1, meta: META })
    rotas['DELETE subscriptions/sub_dup'] = { status: 200, corpo: { status: 'canceled' } }
    const r = await enviar(faturaFiscal('e2', 'invoice.paid', AGORA_S + 30, 'sub_dup'))
    assert.equal(r.status, 200)
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.url === 'subscriptions/sub_dup'))
    assert.equal(fiscal().stripe_subscription_id, 'sub_f')
  })

  test('falha ao cancelar a duplicada: 500 (a Stripe reenvia) e libera a idempotência', async () => {
    await enviar(sessaoFiscal('e1'))
    rotas['GET subscriptions/sub_dup'] = subStripe({ price: 'price_fiscal', fim: fim1, meta: META })
    rotas['DELETE subscriptions/sub_dup'] = { status: 500 }
    const r = await enviar(sessaoFiscal('e2', 'cs_outra', 'sub_dup', 'paid', AGORA_S + 30))
    assert.equal(r.status, 500)
    assert.equal(banco.tabelas.eventos_webhook_stripe.some((e) => e.stripe_event_id === 'e2'), false)
  })

  test('invoice.paid antes do checkout: liga à reserva da barraca e ativa', async () => {
    const r = await enviar(faturaFiscal('e1', 'invoice.paid', AGORA_S))
    assert.equal(r.status, 200)
    assert.equal(fiscal().status, 'active')
    assert.equal(fiscal().stripe_subscription_id, 'sub_f')
  })

  test('pagamento ATRASADO nunca desfaz um deleted mais novo: nem a linha nem a sincronização do módulo', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(ev('e2', 'customer.subscription.deleted', AGORA_S + 100, { id: 'sub_f', metadata: META, items: { data: [{ current_period_end: fim1 }] } }))
    const antes = modulos().length
    await enviar(faturaFiscal('e3', 'invoice.paid', AGORA_S + 50)) // mais antigo que o deleted
    assert.equal(fiscal().status, 'expired')
    assert.equal(modulos().length, antes, 'evento descartado não chama a RPC do módulo')
  })

  test('expired não é revivido nem por pagamento mais novo (estado de origem inesperado)', async () => {
    await enviar(sessaoFiscal('e1'))
    await enviar(ev('e2', 'customer.subscription.deleted', AGORA_S + 10, { id: 'sub_f', metadata: META }))
    await enviar(faturaFiscal('e3', 'invoice.paid', AGORA_S + 20))
    assert.equal(fiscal().status, 'expired')
  })

  test('duas subscriptions paralelas para a MESMA reserva: só uma vincula, a outra é cancelada', async () => {
    rotas['GET subscriptions/sub_g'] = subStripe({ price: 'price_fiscal', fim: fim1, meta: META })
    rotas['DELETE subscriptions/sub_f'] = { status: 200, corpo: { status: 'canceled' } }
    rotas['DELETE subscriptions/sub_g'] = { status: 200, corpo: { status: 'canceled' } }
    const [a, b] = await Promise.all([sessaoFiscal('p1', 'cs_f', 'sub_f'), sessaoFiscal('p2', 'cs_g', 'sub_g')].map(enviar))
    assert.equal(a.status, 200)
    assert.equal(b.status, 200)
    const canceladas = chamadas.filter((c) => c.metodo === 'DELETE').map((c) => c.url)
    assert.equal(canceladas.length, 1)
    assert.equal(fiscal().status, 'active')
    assert.equal(canceladas[0], `subscriptions/${fiscal().stripe_subscription_id === 'sub_f' ? 'sub_g' : 'sub_f'}`)
  })

  test('reserva inexistente (id da metadata não existe): a assinatura órfã é cancelada e nada é criado', async () => {
    banco.tabelas.fiscal_assinaturas = []
    rotas['DELETE subscriptions/sub_f'] = { status: 200, corpo: { status: 'canceled' } }
    const r = await enviar(sessaoFiscal('e1'))
    assert.equal(r.status, 200)
    assert.ok(chamadas.some((c) => c.metodo === 'DELETE' && c.url === 'subscriptions/sub_f'))
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
    assert.equal(modulos().length, 0)
  })

  test('sem reserva_id na metadata de uma assinatura ainda não vinculada: 500 (nunca adivinha pela barraca)', async () => {
    const semReserva: Record<string, string> = { ...META }
    delete semReserva.reserva_id
    const evento = ev('e1', 'checkout.session.completed', AGORA_S, { id: 'cs_f', subscription: 'sub_f', customer: 'cus_1', payment_status: 'paid', metadata: semReserva })
    assert.equal((await enviar(evento)).status, 500)
    assert.equal(fiscal().stripe_subscription_id, null)
  })

  test('evento fiscal NUNCA toca `assinaturas`', async () => {
    const antes = JSON.stringify(banco.tabelas.assinaturas)
    await enviar(sessaoFiscal('e1'))
    await enviar(faturaFiscal('e2', 'invoice.payment_failed', AGORA_S + 10))
    await enviar(faturaFiscal('e3', 'invoice.paid', AGORA_S + 20))
    await enviar(ev('e4', 'customer.subscription.updated', AGORA_S + 30, { id: 'sub_f', metadata: META, cancel_at_period_end: true, items: { data: [{ current_period_end: fim1 }] } }))
    await enviar(ev('e5', 'customer.subscription.deleted', AGORA_S + 40, { id: 'sub_f', metadata: META }))
    assert.equal(JSON.stringify(banco.tabelas.assinaturas), antes)
  })
})

describe('base anual + fiscal mensal, eventos intercalados', () => {
  const fimAnual = AGORA_S + 365 * DIA
  beforeEach(() => {
    banco.tabelas.assinaturas = [
      { usuario_id: 'u1', status: 'trialing', plan: 'ponto', cycle: null, stripe_subscription_id: null, stripe_evento_em: null },
    ]
    rotas['GET subscriptions/sub_base'] = subStripe({ price: 'price_base_anual', fim: fimAnual })
  })
  const sessaoBase = (id: string, created: number) =>
    ev(id, 'checkout.session.completed', created, { id: 'cs_b', client_reference_id: 'u1', subscription: 'sub_base', customer: 'cus_1', payment_status: 'paid', metadata: { usuario_id: 'u1' } })
  const faturaBase = (id: string, tipo: string, created: number) =>
    ev(id, tipo, created, { parent: { subscription_details: { subscription: 'sub_base', metadata: { usuario_id: 'u1' } } } })

  test('cada produto grava na sua tabela, sem interferência', async () => {
    await enviar(sessaoBase('b1', AGORA_S))
    assert.equal(base().status, 'active')
    assert.equal(base().plan, 'ponto')
    assert.equal(base().cycle, 'anual')
    assert.equal(base().current_period_end, new Date(fimAnual * 1000).toISOString())

    await enviar(sessaoFiscal('f1', 'cs_f', 'sub_f', 'paid', AGORA_S + 10))
    assert.equal(fiscal().status, 'active')
    assert.equal(base().current_period_end, new Date(fimAnual * 1000).toISOString())

    // Falha no fiscal: base segue active.
    await enviar(faturaFiscal('f2', 'invoice.payment_failed', AGORA_S + 20))
    assert.equal(fiscal().status, 'past_due')
    assert.equal(base().status, 'active')

    // Falha na base não derruba o fiscal.
    await enviar(faturaBase('b2', 'invoice.payment_failed', AGORA_S + 30))
    assert.equal(base().status, 'past_due')
    assert.equal(fiscal().status, 'past_due')

    // Renovação mensal do fiscal só mexe no fiscal.
    const fim2 = fim1 + 30 * DIA
    rotas['GET subscriptions/sub_f'] = subStripe({ price: 'price_fiscal', fim: fim2, meta: META })
    await enviar(faturaFiscal('f3', 'invoice.paid', AGORA_S + 40))
    assert.equal(fiscal().status, 'active')
    assert.equal(base().status, 'past_due')

    // Base regularizada; cancelar a base NÃO cancela o fiscal.
    await enviar(faturaBase('b3', 'invoice.paid', AGORA_S + 50))
    assert.equal(base().status, 'active')
    await enviar(ev('b4', 'customer.subscription.updated', AGORA_S + 60, { id: 'sub_base', metadata: { usuario_id: 'u1' }, cancel_at_period_end: true, items: { data: [{ current_period_end: fimAnual }] } }))
    assert.equal(base().status, 'canceled')
    assert.equal(fiscal().status, 'active')
    assert.equal(fiscal().current_period_end, new Date(fim2 * 1000).toISOString())
  })
})
