/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// Purchase pelo servidor (Meta CAPI + GA4): payloads, consentimento, só a 1ª cobrança, e o webhook segue 200 se a Meta falha.
// Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { enviarPurchase, hashEmail, montarPayloadGa4, montarPayloadMeta } from '../supabase/functions/_shared/medicaoServidor.ts'
import type { DadosPurchase } from '../supabase/functions/_shared/medicaoServidor.ts'
import { tratarWebhookStripe } from '../supabase/functions/_shared/stripeWebhook.ts'

const SEGREDO = 'whsec_teste'
const AGORA_MS = Date.UTC(2026, 10, 7, 12, 0, 0)
const AGORA_S = Math.floor(AGORA_MS / 1000)

const dados: DadosPurchase = {
  eventId: 'in_123', valorCentavos: 4990, email: '  Teste@Exemplo.COM ', fbp: 'fb.1.1.2', fbc: null,
  gaClientId: '111.222', usuarioId: 'u1', eventoEmSegundos: AGORA_S,
}

describe('payloads', () => {
  test('Meta: e-mail em minúsculas e SHA-256, value em reais, BRL, event_id, sem e-mail em claro', async () => {
    const p = await montarPayloadMeta(dados)
    const ev = p.data[0] as any
    assert.equal(ev.event_name, 'Purchase')
    assert.equal(ev.event_id, 'in_123')
    assert.deepEqual(ev.custom_data, { value: 49.9, currency: 'BRL' })
    assert.deepEqual(ev.user_data.em, [await hashEmail('teste@exemplo.com')])
    assert.match(ev.user_data.em[0], /^[0-9a-f]{64}$/)
    assert.equal(ev.user_data.fbp, 'fb.1.1.2')
    assert.equal('fbc' in ev.user_data, false)
    assert.doesNotMatch(JSON.stringify(p), /exemplo/i)
  })
  test('GA4: purchase com transaction_id, value em reais e BRL; client_id do _ga ou derivado do usuário', async () => {
    const p = await montarPayloadGa4(dados)
    assert.deepEqual(p.events[0], { name: 'purchase', params: { transaction_id: 'in_123', value: 49.9, currency: 'BRL' } })
    assert.equal(p.client_id, '111.222')
    const sem = await montarPayloadGa4({ ...dados, gaClientId: null })
    assert.match(sem.client_id, /^[0-9a-f]{20}$/)
  })
  test('enviarPurchase nunca lança: Meta com 500 e GA4 com timeout/erro de rede', async () => {
    const f = (async (url: string) => {
      if (String(url).includes('facebook')) return new Response('{}', { status: 500 })
      throw new Error('rede')
    }) as unknown as typeof fetch
    const r = await enviarPurchase(dados, { fetch: f, metaToken: 't', ga4Secret: 's' })
    assert.deepEqual(r, { meta: false, ga4: false })
  })
  test('sem as chaves (variáveis de ambiente) nada é enviado', async () => {
    let chamadas = 0
    const f = (async () => { chamadas++; return new Response('{}') }) as unknown as typeof fetch
    await enviarPurchase(dados, { fetch: f, metaToken: undefined, ga4Secret: undefined })
    assert.equal(chamadas, 0)
  })
})

// ---------- webhook ----------
async function hmac(texto: string) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto)))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Linha = Record<string, any>
function supabaseFalso(assinatura: Linha) {
  const eventos = new Set<string>()
  const from = (tabela: string) => {
    const st: { op: string; dados: Linha; filtros: Array<(r: Linha) => boolean>; retorna: boolean; unico: boolean } = { op: 'select', dados: {}, filtros: [], retorna: false, unico: false }
    const b: any = {
      insert(d: Linha) { st.op = 'insert'; st.dados = d; return b },
      update(d: Linha) { st.op = 'update'; st.dados = d; return b },
      delete() { st.op = 'delete'; return b },
      select() { if (st.op === 'update') st.retorna = true; return b },
      eq(c: string, v: unknown) { st.filtros.push((r) => r[c] === v); return b },
      is(c: string, v: null) { st.filtros.push((r) => (r[c] ?? null) === v); return b },
      or() { return b },
      limit() { return b },
      maybeSingle() { st.unico = true; return b },
      then(ok: (v: any) => unknown, err?: (e: unknown) => unknown) { return Promise.resolve(executar()).then(ok, err) },
    }
    function executar() {
      if (tabela === 'eventos_webhook_stripe') {
        if (st.op === 'insert') {
          if (eventos.has(st.dados.stripe_event_id)) return { data: null, error: { code: '23505', message: 'dup' } }
          eventos.add(st.dados.stripe_event_id)
        }
        return { data: null, error: null }
      }
      if (tabela === 'assinatura_ofertas') return { data: { plano: 'pro', ciclo: 'mensal' }, error: null }
      const alvo = st.filtros.every((f) => f(assinatura)) ? [assinatura] : []
      if (st.op === 'update') {
        for (const r of alvo) Object.assign(r, st.dados)
        return { data: st.retorna ? alvo.map((r) => ({ usuario_id: r.usuario_id })) : null, error: null }
      }
      return { data: st.unico ? (alvo[0] ?? null) : alvo, error: null }
    }
    return b
  }
  return { from }
}

function ambiente(assinatura: Linha, opcoes: { metaStatus?: number; criadaHaDias?: number } = {}) {
  const chamadasMedicao: string[] = []
  const tarefas: Promise<unknown>[] = []
  const criada = AGORA_S - (opcoes.criadaHaDias ?? 1) * 86400
  const fetchFalso = (async (url: string) => {
    const u = String(url)
    if (u.startsWith('https://api.stripe.com')) return new Response(JSON.stringify({ created: criada, items: { data: [{ price: { id: 'p' } }] }, current_period_end: AGORA_S + 86400 }), { status: 200 })
    chamadasMedicao.push(u.includes('facebook') ? 'meta' : 'ga4')
    return new Response('{}', { status: u.includes('facebook') ? (opcoes.metaStatus ?? 200) : 200 })
  }) as unknown as typeof fetch
  const supabase = supabaseFalso(assinatura)
  const deps = {
    supabase, fetch: fetchFalso, segredoWebhook: SEGREDO, stripeSecretKey: 'sk', agoraMs: () => AGORA_MS,
    medicao: { fetch: fetchFalso, metaToken: 't', ga4Secret: 's' },
    emSegundoPlano: (t: Promise<unknown>) => void tarefas.push(t),
  }
  async function entregar(eventoId: string, fatura: Record<string, unknown>) {
    const corpo = JSON.stringify({ id: eventoId, type: 'invoice.paid', created: AGORA_S, data: { object: { id: 'in_1', subscription: 'sub_1', customer_email: 'cliente@exemplo.com', currency: 'brl', amount_paid: 4990, ...fatura } } })
    const req = new Request('https://x/webhook', { method: 'POST', body: corpo, headers: { 'Stripe-Signature': `t=${AGORA_S},v1=${await hmac(`${AGORA_S}.${corpo}`)}` } })
    const resp = await tratarWebhookStripe(req, deps)
    await Promise.all(tarefas.splice(0))
    return resp
  }
  return { entregar, chamadasMedicao }
}

const conta = (extra: Linha = {}): Linha => ({ usuario_id: 'u1', status: 'trialing', stripe_subscription_id: 'sub_1', stripe_evento_em: null, consentimento_marketing: true, fbp: 'fb.1', fbc: null, ga_client_id: '1.2', purchase_enviado_em: null, ...extra })

describe('webhook da Stripe + Purchase', () => {
  test('primeira cobrança paga com consentimento: envia Meta e GA4 uma vez; reentrega do webhook e renovação não repetem', async () => {
    const a = ambiente(conta())
    assert.equal((await a.entregar('evt_1', {})).status, 200)
    assert.deepEqual(a.chamadasMedicao.sort(), ['ga4', 'meta'])
    assert.ok(a.chamadasMedicao.length === 2)
    // reentrega do MESMO evento
    const r2 = await a.entregar('evt_1', {})
    assert.equal(r2.status, 200)
    // renovação mensal (outro evento, outra fatura)
    assert.equal((await a.entregar('evt_2', { id: 'in_2' })).status, 200)
    assert.equal(a.chamadasMedicao.length, 2)
  })
  test('SEM consentimento nada sai para a Meta nem para o GA4', async () => {
    const a = ambiente(conta({ consentimento_marketing: false }))
    assert.equal((await a.entregar('evt_1', {})).status, 200)
    assert.deepEqual(a.chamadasMedicao, [])
  })
  test('fatura de valor zero (teste grátis) não vira Purchase; a 1ª cobrança depois do teste vira', async () => {
    const a = ambiente(conta(), { criadaHaDias: 3 })
    await a.entregar('evt_1', { amount_paid: 0, billing_reason: 'subscription_create' })
    assert.deepEqual(a.chamadasMedicao, [])
    await a.entregar('evt_2', { id: 'in_2', billing_reason: 'subscription_cycle' })
    assert.deepEqual(a.chamadasMedicao.sort(), ['ga4', 'meta'])
  })
  test('assinatura antiga (renovação de cliente de antes) não vira Purchase', async () => {
    const a = ambiente(conta(), { criadaHaDias: 200 })
    await a.entregar('evt_1', {})
    assert.deepEqual(a.chamadasMedicao, [])
  })
  test('Meta fora do ar (500) NÃO derruba a resposta 200 do webhook', async () => {
    const a = ambiente(conta(), { metaStatus: 500 })
    assert.equal((await a.entregar('evt_1', {})).status, 200)
  })
})
