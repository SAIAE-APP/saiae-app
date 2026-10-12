/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// webhook-stripe EXECUTADO com supabase e fetch simulados (dinheiro: não basta casar regex no código-fonte).
// Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import {
  assinaturaStripeValida,
  subscriptionIdDaFatura,
  tratarWebhookStripe,
} from '../supabase/functions/_shared/stripeWebhook.ts'

const SEGREDO = 'whsec_teste'
const AGORA_MS = Date.UTC(2026, 9, 24, 12, 0, 0)
const AGORA_S = Math.floor(AGORA_MS / 1000)

// ---------- assinatura ----------
async function hmac(segredo: string, texto: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function cabecalho(corpo: string, opcoes: { ts?: number; segredo?: string; extraV1?: string[] } = {}) {
  const ts = opcoes.ts ?? AGORA_S
  const v1 = await hmac(opcoes.segredo ?? SEGREDO, `${ts}.${corpo}`)
  return [`t=${ts}`, ...(opcoes.extraV1 ?? []).map((x) => `v1=${x}`), `v1=${v1}`].join(',')
}

// ---------- supabase simulado (em memória, com semântica de filtro real) ----------
type Linha = Record<string, any>
class Banco {
  eventos = new Map<string, Linha>()
  assinaturas: Linha[] = []
  ofertas: Linha[] = [{ stripe_price_id: 'price_pro', plano: 'pro', ciclo: 'mensal' }]
  falhas = new Set<string>() // "tabela:operacao"
  from(tabela: string) {
    return construtor(this, tabela)
  }
}
function construtor(banco: Banco, tabela: string) {
  const st: { op: string | null; dados: Linha | null; filtros: Array<(r: Linha) => boolean>; retorna: boolean; single: boolean } = {
    op: null, dados: null, filtros: [], retorna: false, single: false,
  }
  const linhas = () => (tabela === 'assinaturas' ? banco.assinaturas : tabela === 'assinatura_ofertas' ? banco.ofertas : [])
  const b: any = {
    insert(d: Linha) { st.op = 'insert'; st.dados = d; return b },
    update(d: Linha) { st.op = 'update'; st.dados = d; return b },
    delete() { st.op = 'delete'; return b },
    select() { if (st.op === 'update') st.retorna = true; else st.op = 'select'; return b },
    eq(c: string, v: unknown) { st.filtros.push((r) => r[c] === v); return b },
    or(expr: string) {
      // padrão usado pelo módulo: "stripe_evento_em.is.null,stripe_evento_em.lte.<iso>"
      const lte = expr.match(/stripe_evento_em\.lte\.(.+)$/)?.[1]
      st.filtros.push((r) => r.stripe_evento_em == null || (lte !== undefined && Date.parse(r.stripe_evento_em) <= Date.parse(lte)))
      return b
    },
    limit() { return b },
    maybeSingle() { st.single = true; return b },
    then(ok: (v: any) => unknown, err?: (e: unknown) => unknown) {
      return Promise.resolve(executar()).then(ok, err)
    },
  }
  function executar() {
    if (banco.falhas.has(`${tabela}:${st.op}`)) return { data: null, error: { message: `falha simulada ${tabela}:${st.op}`, code: 'XX000' } }
    if (tabela === 'eventos_webhook_stripe') {
      if (st.op === 'insert') {
        const id = st.dados!.stripe_event_id
        if (banco.eventos.has(id)) return { data: null, error: { message: 'duplicate', code: '23505' } }
        banco.eventos.set(id, st.dados!)
        return { data: null, error: null }
      }
      if (st.op === 'delete') {
        for (const [id, r] of [...banco.eventos]) if (st.filtros.every((f) => f(r))) banco.eventos.delete(id)
        return { data: null, error: null }
      }
    }
    const alvo = linhas().filter((r) => st.filtros.every((f) => f(r)))
    if (st.op === 'update') {
      for (const r of alvo) Object.assign(r, st.dados)
      return { data: st.retorna ? alvo.map((r) => ({ usuario_id: r.usuario_id })) : null, error: null }
    }
    if (st.op === 'select') return { data: st.single ? (alvo[0] ?? null) : alvo, error: null }
    return { data: null, error: null }
  }
  return b
}

// ---------- Stripe simulada ----------
type RespostaStripe = { status: number; corpo?: unknown }
function fetchStripe(rotas: Record<string, RespostaStripe>, chamadas: string[]): typeof fetch {
  return (async (url: string | URL | Request) => {
    const caminho = String(url).replace('https://api.stripe.com/v1/', '')
    chamadas.push(caminho)
    const r = rotas[caminho] ?? { status: 404 }
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status })
  }) as typeof fetch
}
const SUB = (periodoFim: number) => ({ status: 200, corpo: { items: { data: [{ price: { id: 'price_pro' }, current_period_end: periodoFim }] } } })
const FIM_1 = AGORA_S + 30 * 86400

// ---------- helpers ----------
let banco: Banco
let chamadasStripe: string[]
let rotas: Record<string, RespostaStripe>

beforeEach(() => {
  banco = new Banco()
  banco.assinaturas = [{ usuario_id: 'u1', status: 'trialing', plan: 'essencial', stripe_subscription_id: null, stripe_evento_em: null }]
  chamadasStripe = []
  rotas = { 'subscriptions/sub_1': SUB(FIM_1), 'invoices/in_1': { status: 200, corpo: { parent: { subscription_details: { subscription: 'sub_1' } } } } }
})

async function enviar(evento: Record<string, unknown>, opcoes: { header?: string; segredoWebhook?: string | undefined } = {}) {
  const corpo = JSON.stringify(evento)
  const req = new Request('https://x/webhook-stripe', {
    method: 'POST',
    body: corpo,
    headers: { 'Stripe-Signature': opcoes.header ?? (await cabecalho(corpo)) },
  })
  return tratarWebhookStripe(req, {
    supabase: banco as any,
    fetch: fetchStripe(rotas, chamadasStripe),
    segredoWebhook: 'segredoWebhook' in opcoes ? opcoes.segredoWebhook : SEGREDO,
    stripeSecretKey: 'sk_teste',
    agoraMs: () => AGORA_MS,
  })
}
const ev = (id: string, type: string, created: number, object: Record<string, unknown>) => ({ id, type, created, data: { object } })
const checkout = (id = 'evt_co', created = AGORA_S, pago = 'paid') =>
  ev(id, 'checkout.session.completed', created, { client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1', payment_status: pago })
const faturaPaga = (id: string, created: number) =>
  ev(id, 'invoice.paid', created, { parent: { subscription_details: { subscription: 'sub_1' } } })
const sub = () => banco.assinaturas[0]

describe('assinatura do webhook', () => {
  test('válida passa; segredo errado, sem v1, timestamp velho e sem segredo configurado são recusados', async () => {
    const corpo = '{"a":1}'
    assert.equal(await assinaturaStripeValida(corpo, await cabecalho(corpo), SEGREDO, AGORA_MS), true)
    assert.equal(await assinaturaStripeValida(corpo, await cabecalho(corpo, { segredo: 'outro' }), SEGREDO, AGORA_MS), false)
    assert.equal(await assinaturaStripeValida(corpo, `t=${AGORA_S}`, SEGREDO, AGORA_MS), false)
    assert.equal(await assinaturaStripeValida(corpo, await cabecalho(corpo, { ts: AGORA_S - 301 }), SEGREDO, AGORA_MS), false)
    assert.equal((await enviar(checkout(), { segredoWebhook: undefined })).status, 500)
  })

  test('vários v1 (rotação de segredo): vale se QUALQUER um bater, em qualquer posição', async () => {
    const corpo = '{"a":1}'
    const falso = 'ab'.repeat(32)
    assert.equal(await assinaturaStripeValida(corpo, await cabecalho(corpo, { extraV1: [falso] }), SEGREDO, AGORA_MS), true) // certo é o último
    const certo = await hmac(SEGREDO, `${AGORA_S}.${corpo}`)
    assert.equal(await assinaturaStripeValida(corpo, `t=${AGORA_S},v1=${certo},v1=${falso}`, SEGREDO, AGORA_MS), true) // certo é o primeiro
    assert.equal(await assinaturaStripeValida(corpo, `t=${AGORA_S},v1=${falso},v1=${falso.replace('a', 'c')}`, SEGREDO, AGORA_MS), false)
  })

  test('assinatura inválida: 400 e nada é gravado', async () => {
    const r = await enviar(checkout(), { header: `t=${AGORA_S},v1=${'0'.repeat(64)}` })
    assert.equal(r.status, 400)
    assert.equal(banco.eventos.size, 0)
    assert.equal(sub().status, 'trialing')
  })
})

describe('A1 — falha não pode perder o evento', () => {
  test('update com erro => 500 e o registro de idempotência é apagado (a Stripe reenvia e processa)', async () => {
    banco.falhas.add('assinaturas:update')
    const r = await enviar(checkout())
    assert.equal(r.status, 500)
    assert.equal(banco.eventos.size, 0, 'idempotência liberada')
    assert.equal(sub().status, 'trialing')

    banco.falhas.clear()
    const reenvio = await enviar(checkout())
    assert.equal(reenvio.status, 200)
    assert.equal(sub().status, 'active', 'o reenvio processa de verdade')
    assert.equal(sub().stripe_subscription_id, 'sub_1')
  })

  test('erro ao ler a oferta => 500 (antes seguia com plano "pro" por padrão)', async () => {
    banco.falhas.add('assinatura_ofertas:select')
    assert.equal((await enviar(checkout())).status, 500)
    assert.equal(banco.eventos.size, 0)
  })

  test('Stripe fora do ar (500) ao confirmar a assinatura => 500 e libera; 404 também (não ativa sem confirmar)', async () => {
    rotas['subscriptions/sub_1'] = { status: 503 }
    assert.equal((await enviar(checkout())).status, 500)
    assert.equal(banco.eventos.size, 0)
    rotas['subscriptions/sub_1'] = { status: 404 }
    assert.equal((await enviar(checkout('evt_co2'))).status, 500)
    assert.equal(sub().status, 'trialing')
  })

  test('evento repetido (duplicado) responde 200 sem reprocessar', async () => {
    assert.equal((await enviar(checkout())).status, 200)
    chamadasStripe.length = 0
    const r = await enviar(checkout())
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { ok: true, duplicado: true })
    assert.equal(chamadasStripe.length, 0)
  })

  test('invoice.paid ANTES do checkout.session.completed: 500 (não some); depois do vínculo, o reenvio ativa', async () => {
    const r1 = await enviar(faturaPaga('evt_inv', AGORA_S))
    assert.equal(r1.status, 500)
    assert.equal(banco.eventos.size, 0)
    assert.equal(sub().status, 'trialing')

    assert.equal((await enviar(checkout('evt_co', AGORA_S - 5, 'unpaid'))).status, 200) // vincula, ainda sem ativar
    assert.equal(sub().stripe_subscription_id, 'sub_1')
    assert.equal(sub().status, 'trialing')

    assert.equal((await enviar(faturaPaga('evt_inv', AGORA_S))).status, 200) // reenvio da Stripe
    assert.equal(sub().status, 'active')
    assert.equal(sub().current_period_end, new Date(FIM_1 * 1000).toISOString())
  })

  test('checkout com boleto (unpaid) vincula mas NÃO ativa', async () => {
    assert.equal((await enviar(checkout('evt_co', AGORA_S, 'unpaid'))).status, 200)
    assert.equal(sub().status, 'trialing')
    assert.equal(sub().stripe_customer_id, 'cus_1')
  })
})

describe('API basil+ (conta em 2026-08-26.dahlia): id da assinatura vem em parent.subscription_details', () => {
  test('subscriptionIdDaFatura: parent, fallback na raiz (versão antiga), objeto expandido e fatura avulsa', () => {
    assert.equal(subscriptionIdDaFatura({ parent: { subscription_details: { subscription: 'sub_1' } } }), 'sub_1')
    assert.equal(subscriptionIdDaFatura({ subscription: 'sub_2' }), 'sub_2')
    assert.equal(subscriptionIdDaFatura({ parent: { subscription_details: { subscription: { id: 'sub_3' } } } }), 'sub_3')
    assert.equal(subscriptionIdDaFatura({ parent: null }), null)
    assert.equal(subscriptionIdDaFatura({}), null)
  })

  test('invoice.payment_failed no formato novo põe a conta em past_due com carência de 3 dias', async () => {
    sub().stripe_subscription_id = 'sub_1'
    sub().status = 'active'
    const r = await enviar(ev('evt_pf', 'invoice.payment_failed', AGORA_S, { parent: { subscription_details: { subscription: 'sub_1' } } }))
    assert.equal(r.status, 200)
    assert.equal(sub().status, 'past_due')
    assert.equal(sub().grace_until, new Date(AGORA_MS + 3 * 86400_000).toISOString())
  })
})

describe('M1 — charge.refunded', () => {
  beforeEach(() => {
    sub().stripe_subscription_id = 'sub_1'
    sub().status = 'active'
  })
  test('reembolso PARCIAL não altera a assinatura (nem consulta a Stripe)', async () => {
    const r = await enviar(ev('evt_rf1', 'charge.refunded', AGORA_S, { refunded: false, amount: 8790, amount_refunded: 500, invoice: 'in_1' }))
    assert.equal(r.status, 200)
    assert.equal(sub().status, 'active')
    assert.equal(chamadasStripe.length, 0)
  })
  test('reembolso TOTAL expira a assinatura', async () => {
    const r = await enviar(ev('evt_rf2', 'charge.refunded', AGORA_S, { refunded: true, amount: 8790, amount_refunded: 8790, invoice: 'in_1' }))
    assert.equal(r.status, 200)
    assert.equal(sub().status, 'expired')
  })
  test('falha da Stripe ao ler a fatura => 500 (antes o evento era descartado em silêncio)', async () => {
    rotas['invoices/in_1'] = { status: 500 }
    const r = await enviar(ev('evt_rf3', 'charge.refunded', AGORA_S, { refunded: true, invoice: 'in_1' }))
    assert.equal(r.status, 500)
    assert.equal(sub().status, 'active')
    assert.equal(banco.eventos.size, 0)
  })
})

describe('B3 — evento fora de ordem', () => {
  beforeEach(() => {
    sub().stripe_subscription_id = 'sub_1'
    sub().status = 'active'
  })
  test('payment_failed ATRASADO não sobrescreve o invoice.paid mais novo (e responde 200, não 500)', async () => {
    assert.equal((await enviar(faturaPaga('evt_novo', AGORA_S))).status, 200)
    assert.equal(sub().status, 'active')
    const atrasado = await enviar(ev('evt_velho', 'invoice.payment_failed', AGORA_S - 3600, { parent: { subscription_details: { subscription: 'sub_1' } } }))
    assert.equal(atrasado.status, 200)
    assert.equal(sub().status, 'active', 'continua ativa')
    assert.equal(sub().stripe_evento_em, new Date(AGORA_S * 1000).toISOString(), 'marca d\'água não regride')
  })
  test('o inverso vale: payment_failed mais novo vence um invoice.paid antigo', async () => {
    assert.equal((await enviar(ev('evt_pf', 'invoice.payment_failed', AGORA_S, { parent: { subscription_details: { subscription: 'sub_1' } } }))).status, 200)
    assert.equal(sub().status, 'past_due')
    assert.equal((await enviar(faturaPaga('evt_pg_velho', AGORA_S - 60))).status, 200)
    assert.equal(sub().status, 'past_due')
  })
  test('subscription.updated: cancelar no fim marca canceled; reativar só reverte quem está canceled', async () => {
    const periodo = AGORA_S + 10 * 86400
    const dados = (cancelar: boolean) => ({ id: 'sub_1', cancel_at_period_end: cancelar, items: { data: [{ current_period_end: periodo }] } })
    assert.equal((await enviar(ev('evt_u1', 'customer.subscription.updated', AGORA_S, dados(true)))).status, 200)
    assert.equal(sub().status, 'canceled')
    assert.equal((await enviar(ev('evt_u2', 'customer.subscription.updated', AGORA_S + 5, dados(false)))).status, 200)
    assert.equal(sub().status, 'active')
    // past_due não deve virar active por um "updated" sem cancelamento
    sub().status = 'past_due'
    assert.equal((await enviar(ev('evt_u3', 'customer.subscription.updated', AGORA_S + 9, dados(false)))).status, 200)
    assert.equal(sub().status, 'past_due')
  })
})

describe('teste grátis na Stripe (checkout com trial_end): app fica ativo e coerente', () => {
  const trial = (statusStripe: string) => {
    rotas['subscriptions/sub_1'] = { status: 200, corpo: { status: statusStripe, items: { data: [{ price: { id: 'price_pro' }, current_period_end: FIM_1 }] } } }
  }
  test('no_payment_required + Stripe trialing => active com current_period_end = fim do teste', async () => {
    trial('trialing')
    assert.equal((await enviar(checkout('evt_t1', AGORA_S, 'no_payment_required'))).status, 200)
    assert.equal(sub().status, 'active')
    assert.equal(sub().current_period_end, new Date(FIM_1 * 1000).toISOString())
    assert.equal(sub().stripe_subscription_id, 'sub_1')
    assert.equal(sub().plan, 'pro')
  })
  test('no_payment_required com a assinatura ainda incompleta na Stripe NÃO ativa (só vincula)', async () => {
    trial('incomplete')
    assert.equal((await enviar(checkout('evt_t2', AGORA_S, 'no_payment_required'))).status, 200)
    assert.equal(sub().status, 'trialing')
    assert.equal(sub().stripe_subscription_id, 'sub_1')
  })
  test('depois: o invoice.paid da 1ª cobrança (fim do teste) estende o período e segue active', async () => {
    trial('trialing')
    await enviar(checkout('evt_t3', AGORA_S, 'no_payment_required'))
    const novoFim = FIM_1 + 30 * 86400
    rotas['subscriptions/sub_1'] = { status: 200, corpo: { status: 'active', items: { data: [{ price: { id: 'price_pro' }, current_period_end: novoFim }] } } }
    assert.equal((await enviar(faturaPaga('evt_t4', AGORA_S + 100))).status, 200)
    assert.equal(sub().status, 'active')
    assert.equal(sub().current_period_end, new Date(novoFim * 1000).toISOString())
  })
  test('cancelar durante o teste mantém o acesso até o fim do teste (canceled + current_period_end)', async () => {
    trial('trialing')
    await enviar(checkout('evt_t5', AGORA_S, 'no_payment_required'))
    const dados = { id: 'sub_1', cancel_at_period_end: true, items: { data: [{ current_period_end: FIM_1 }] } }
    assert.equal((await enviar(ev('evt_t6', 'customer.subscription.updated', AGORA_S + 5, dados))).status, 200)
    assert.equal(sub().status, 'canceled')
    assert.equal(sub().current_period_end, new Date(FIM_1 * 1000).toISOString())
  })
})
