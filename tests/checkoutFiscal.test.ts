/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// criar-checkout-fiscal EXECUTADO com supabase e fetch simulados. Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import { TERMO_FISCAL_VERSAO, tratarCriarCheckoutFiscal } from '../supabase/functions/_shared/checkoutFiscal.ts'
import { tratarCancelarAssinatura } from '../supabase/functions/_shared/stripeAssinatura.ts'
import { BancoFiscal, stripeSimulada, type Chamada, type Rota } from './fakesFiscal.ts'

const AGORA_MS = Date.UTC(2026, 10, 18, 12, 0, 0)
const BARRACA = '11111111-1111-4111-8111-111111111111'
const CNPJ = '11222333000181'

let banco: BancoFiscal
let chamadas: Chamada[]
let rotas: Record<string, Rota>
let sessoes: number

const USUARIO = { id: 'u1', email: 'dono@exemplo.com' }
function requisicao(corpo: unknown, autorizado = true) {
  return new Request('https://x/fn', {
    method: 'POST',
    body: JSON.stringify(corpo),
    headers: { origin: 'https://app.saiae.com.br', ...(autorizado ? { Authorization: 'Bearer jwt' } : {}) },
  })
}
const deps = (agora = AGORA_MS) => ({
  autenticar: async (jwt: string) => (jwt === 'jwt' ? USUARIO : null),
  supabase: banco as any,
  fetch: stripeSimulada(rotas, chamadas),
  stripeSecretKey: 'sk_teste',
  agoraMs: () => agora,
})
const chamar = (corpo: unknown = { barraca_id: BARRACA, termo_versao: TERMO_FISCAL_VERSAO }, agora?: number) => tratarCriarCheckoutFiscal(requisicao(corpo), deps(agora))
const sessoesCriadas = () => chamadas.filter((c) => c.url === 'checkout/sessions')

beforeEach(() => {
  banco = new BancoFiscal()
  banco.tabelas.assinaturas = [{ usuario_id: 'u1', status: 'active', stripe_customer_id: 'cus_1', bloqueada_admin: false }]
  banco.tabelas.usuarios_barracas = [{ usuario_id: 'u1', barraca_id: BARRACA, papel: 'dono' }]
  banco.tabelas.barracas = [{ id: BARRACA, cnpj: '11.222.333/0001-81' }]
  banco.tabelas.assinatura_ofertas = [{ plano: 'fiscal', ciclo: 'mensal', ativo: true, stripe_price_id: 'price_fiscal' }]
  chamadas = []
  sessoes = 0
  rotas = {}
  Object.defineProperty(rotas, 'POST checkout/sessions', {
    enumerable: true,
    get: () => ({ status: 200, corpo: { id: `cs_${++sessoes}`, url: `https://checkout.stripe.com/c/${sessoes}` } }),
  })
})

describe('criar-checkout-fiscal', () => {
  test('caminho feliz: sessão com preço da oferta, metadata fiscal, sem trial, cliente reaproveitado e reserva gravada', async () => {
    const r = await chamar()
    assert.equal(r.status, 200)
    assert.match((await r.json()).url, /^https:\/\/checkout\.stripe\.com/)
    const [s] = sessoesCriadas()
    assert.equal(s.corpo.get('line_items[0][price]'), 'price_fiscal')
    assert.equal(s.corpo.get('customer'), 'cus_1')
    assert.equal(s.corpo.get('metadata[tipo]'), 'fiscal')
    assert.equal(s.corpo.get('subscription_data[metadata][tipo]'), 'fiscal')
    assert.equal(s.corpo.get('subscription_data[metadata][cnpj]'), CNPJ)
    assert.equal(s.corpo.get('subscription_data[metadata][barraca_id]'), BARRACA)
    assert.equal(s.corpo.get('subscription_data[metadata][usuario_id]'), 'u1')
    assert.equal(s.corpo.get('metadata[termo_versao]'), TERMO_FISCAL_VERSAO)
    assert.equal(s.corpo.get('subscription_data[metadata][termo_versao]'), TERMO_FISCAL_VERSAO)
    assert.equal(s.corpo.get('subscription_data[trial_end]'), null)
    assert.equal(s.corpo.get('client_reference_id'), null)
    assert.ok(s.headers['Idempotency-Key'])
    const reservas = banco.tabelas.fiscal_assinaturas
    assert.equal(reservas.length, 1)
    assert.equal(reservas[0].status, 'pendente')
    assert.equal(reservas[0].cnpj, CNPJ)
    assert.equal(reservas[0].stripe_checkout_session_id, 'cs_1')
  })

  test('cliente nunca escolhe preço nem CNPJ: campos extras no corpo são ignorados', async () => {
    await chamar({ barraca_id: BARRACA, termo_versao: TERMO_FISCAL_VERSAO, price: 'price_hacker', stripe_price_id: 'price_hacker', cnpj: '00000000000000', ciclo: 'anual' })
    const [s] = sessoesCriadas()
    assert.equal(s.corpo.get('line_items[0][price]'), 'price_fiscal')
    assert.equal(s.corpo.get('metadata[cnpj]'), CNPJ)
  })

  test('flag fechada: 403 fiscal_indisponivel, sem Stripe e sem reserva', async () => {
    banco.fiscalAberto = false
    const r = await chamar()
    assert.equal(r.status, 403)
    assert.equal((await r.json()).erro, 'fiscal_indisponivel')
    assert.equal(chamadas.length, 0)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })

  test('termo ausente ou de outra versão: 422 termo_nao_aceito, sem reserva nem Stripe', async () => {
    for (const corpo of [{ barraca_id: BARRACA }, { barraca_id: BARRACA, termo_versao: 'termos-antigo' }, { barraca_id: BARRACA, termo_versao: true }]) {
      const r = await chamar(corpo)
      assert.equal(r.status, 422)
      assert.equal((await r.json()).erro, 'termo_nao_aceito')
    }
    assert.equal(chamadas.length, 0)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })

  test('sem JWT: 401; barraca_id inválido: 400', async () => {
    assert.equal((await tratarCriarCheckoutFiscal(requisicao({ barraca_id: BARRACA, termo_versao: TERMO_FISCAL_VERSAO }, false), deps())).status, 401)
    assert.equal((await chamar({ barraca_id: 'x' })).status, 400)
    assert.equal((await chamar({})).status, 400)
  })

  test('base sem vigência paga (trial, trial Stripe, atraso, cancelada, expirada: o predicado SQL diz false): 403 e nada criado', async () => {
    banco.baseVigente = false
    const r = await chamar()
    assert.equal(r.status, 403)
    assert.equal((await r.json()).erro, 'assinatura_base_inativa')
    assert.deepEqual(banco.rpcChamadas.find((c) => c.nome === 'assinatura_base_paga_vigente')?.args, { p_usuario_id: 'u1' })
    banco.baseVigente = true
    banco.tabelas.assinaturas[0].bloqueada_admin = true
    assert.equal((await chamar()).status, 403)
    assert.equal(chamadas.length, 0)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })

  test('o servidor nunca decide a vigência pelo status local: base active mas predicado false (ex.: trial Stripe) = 403', async () => {
    banco.tabelas.assinaturas[0].status = 'active'
    banco.baseVigente = false
    assert.equal((await chamar()).status, 403)
    assert.equal(sessoesCriadas().length, 0)
  })

  test('a metadata leva reserva_id = id da reserva gravada (o webhook liga por ele)', async () => {
    await chamar()
    const [s] = sessoesCriadas()
    assert.equal(s.corpo.get('metadata[reserva_id]'), banco.tabelas.fiscal_assinaturas[0].id)
    assert.equal(s.corpo.get('subscription_data[metadata][reserva_id]'), banco.tabelas.fiscal_assinaturas[0].id)
  })

  test('canceled DENTRO do período pago continua bloqueando (409); depois do fim, ou expired, libera', async () => {
    const dia = 86_400_000
    banco.tabelas.fiscal_assinaturas = [
      { id: 'f0', usuario_id: 'u9', barraca_id: BARRACA, cnpj: CNPJ, status: 'canceled', current_period_end: new Date(banco.agoraMs + 5 * dia).toISOString() },
    ]
    assert.equal((await chamar()).status, 409)
    banco.tabelas.fiscal_assinaturas[0].current_period_end = new Date(banco.agoraMs - dia).toISOString()
    assert.equal((await chamar()).status, 200)
  })

  test('barraca de outro dono (ou sem papel de dono): 403', async () => {
    banco.tabelas.usuarios_barracas = [{ usuario_id: 'u2', barraca_id: BARRACA, papel: 'dono' }]
    assert.equal((await chamar()).status, 403)
    banco.tabelas.usuarios_barracas = [{ usuario_id: 'u1', barraca_id: BARRACA, papel: 'caixa' }]
    assert.equal((await chamar()).status, 403)
    assert.equal(chamadas.length, 0)
  })

  test('CNPJ ausente ou inválido na barraca: 422 cnpj_invalido', async () => {
    for (const cnpj of [null, '', '11222333000182', '123']) {
      banco.tabelas.barracas[0].cnpj = cnpj
      const r = await chamar()
      assert.equal(r.status, 422)
      assert.equal((await r.json()).erro, 'cnpj_invalido')
    }
    assert.equal(chamadas.length, 0)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })

  test('sem oferta fiscal ativa: 422 e sem reserva', async () => {
    banco.tabelas.assinatura_ofertas[0].ativo = false
    assert.equal((await chamar()).status, 422)
    banco.tabelas.assinatura_ofertas = []
    assert.equal((await chamar()).status, 422)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })

  test('clique repetido: o segundo é 409 e só UMA sessão e UMA reserva existem', async () => {
    assert.equal((await chamar()).status, 200)
    const r2 = await chamar()
    assert.equal(r2.status, 409)
    assert.equal((await r2.json()).erro, 'fiscal_ja_contratado')
    assert.equal(sessoesCriadas().length, 1)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 1)
  })

  test('requisições concorrentes: uma sessão só', async () => {
    const respostas = await Promise.all([chamar(), chamar(), chamar()])
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409, 409])
    assert.equal(sessoesCriadas().length, 1)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 1)
  })

  test('CNPJ já contratado por outra barraca/dono (viva): 409', async () => {
    banco.tabelas.fiscal_assinaturas = [{ id: 'f0', usuario_id: 'u9', barraca_id: 'outra', cnpj: CNPJ, status: 'active' }]
    assert.equal((await chamar()).status, 409)
    assert.equal(sessoesCriadas().length, 0)
  })

  test('assinatura fiscal já cancelada/expirada do mesmo CNPJ não bloqueia nova contratação', async () => {
    banco.tabelas.fiscal_assinaturas = [{ id: 'f0', usuario_id: 'u9', barraca_id: 'outra', cnpj: CNPJ, status: 'canceled' }]
    assert.equal((await chamar()).status, 200)
  })

  test('reserva parada (> 35 min, sem assinatura) do mesmo usuário é liberada; recente continua bloqueando', async () => {
    banco.tabelas.fiscal_assinaturas = [
      { id: 'f0', usuario_id: 'u1', barraca_id: BARRACA, cnpj: CNPJ, status: 'pendente', created_at: new Date(AGORA_MS - 10 * 60_000).toISOString() },
    ]
    assert.equal((await chamar()).status, 409)
    banco.tabelas.fiscal_assinaturas[0].created_at = new Date(AGORA_MS - 40 * 60_000).toISOString()
    assert.equal((await chamar()).status, 200)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 1)
    assert.notEqual(banco.tabelas.fiscal_assinaturas[0].id, 'f0')
  })

  test('Stripe recusa: 502 genérico e a reserva é liberada (dá pra tentar de novo)', async () => {
    rotas = { 'POST checkout/sessions': { status: 400, corpo: { error: { message: 'segredo interno' } } } }
    const r = await chamar()
    assert.equal(r.status, 502)
    assert.doesNotMatch(JSON.stringify(await r.json()), /segredo interno/)
    assert.equal(banco.tabelas.fiscal_assinaturas.length, 0)
  })
})

describe('cancelar-assinatura-stripe: módulo Fiscal', () => {
  const requisicaoCancelar = (corpo: unknown) =>
    new Request('https://x/cancelar', { method: 'POST', body: JSON.stringify(corpo), headers: { Authorization: 'Bearer jwt' } })
  const FIM_S = Math.floor((AGORA_MS + 20 * 86_400_000) / 1000)
  const cancelar = () => tratarCancelarAssinatura(requisicaoCancelar({ tipo: 'fiscal', barraca_id: BARRACA }), deps())

  beforeEach(() => {
    banco.tabelas.fiscal_assinaturas = [
      { id: 'f1', usuario_id: 'u1', barraca_id: BARRACA, cnpj: CNPJ, status: 'active', stripe_subscription_id: 'sub_f', stripe_evento_em: null },
    ]
    rotas = { 'POST subscriptions/sub_f': { status: 200, corpo: { cancel_at_period_end: true, items: { data: [{ current_period_end: FIM_S }] } } } }
  })

  test('cancela só o fiscal ao fim do período, grava canceled e NÃO toca a base', async () => {
    const r = await cancelar()
    assert.equal(r.status, 200)
    assert.equal(chamadas[0].url, 'subscriptions/sub_f')
    assert.equal(chamadas[0].corpo.get('cancel_at_period_end'), 'true')
    assert.equal(banco.tabelas.fiscal_assinaturas[0].status, 'canceled')
    assert.equal(banco.tabelas.fiscal_assinaturas[0].current_period_end, new Date(FIM_S * 1000).toISOString())
    assert.equal(banco.tabelas.assinaturas[0].status, 'active')
  })

  test('fiscal em atraso: 409; barraca sem fiscal do usuário: 422; Stripe recusa: 502 e nada gravado', async () => {
    banco.tabelas.fiscal_assinaturas[0].status = 'past_due'
    assert.equal((await cancelar()).status, 409)
    banco.tabelas.fiscal_assinaturas[0].status = 'active'
    banco.tabelas.fiscal_assinaturas[0].usuario_id = 'u2'
    assert.equal((await cancelar()).status, 422)
    banco.tabelas.fiscal_assinaturas[0].usuario_id = 'u1'
    rotas['POST subscriptions/sub_f'] = { status: 400, corpo: { error: { message: 'x' } } }
    assert.equal((await cancelar()).status, 502)
    assert.equal(banco.tabelas.fiscal_assinaturas[0].status, 'active')
  })
})
