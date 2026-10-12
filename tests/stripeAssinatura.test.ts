/* eslint-disable @typescript-eslint/no-explicit-any -- fakes de supabase/fetch dos testes */
// criar-checkout-stripe e cancelar-assinatura-stripe EXECUTADOS com supabase e fetch simulados. Rodar: npm test
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'
import {
  LIMITE_CANCELAMENTOS_HORA,
  MIN_TRIAL_MS,
  MSG_CANCELAR_FALHA,
  MSG_CHECKOUT_FALHA,
  origemDeRetorno,
  tratarCancelarAssinatura,
  tratarCriarCheckout,
} from '../supabase/functions/_shared/stripeAssinatura.ts'

const AGORA_MS = Date.UTC(2026, 9, 24, 12, 0, 0)
const DIA = 86_400_000
const FIM_PERIODO_S = Math.floor((AGORA_MS + 30 * DIA) / 1000)

type Linha = Record<string, any>
class Banco {
  assinaturas: Linha[] = []
  ofertas: Linha[] = [{ plano: 'pro', ciclo: 'mensal', ativo: true, stripe_price_id: 'price_pro' }]
  falhas = new Set<string>()
  rpcResposta: { data: unknown; error: { message: string } | null } = { data: true, error: null }
  rpcChamadas: Array<{ nome: string; args: Record<string, unknown> }> = []
  from(tabela: string) {
    const st: { op: string | null; dados: Linha | null; filtros: Array<(r: Linha) => boolean>; retorna: boolean; single: boolean } = {
      op: null, dados: null, filtros: [], retorna: false, single: false,
    }
    const linhas = () => (tabela === 'assinaturas' ? this.assinaturas : tabela === 'assinatura_ofertas' ? this.ofertas : [])
    const b: any = {
      update: (d: Linha) => { st.op = 'update'; st.dados = d; return b },
      select: () => { if (st.op === 'update') st.retorna = true; else st.op = 'select'; return b },
      eq: (c: string, v: unknown) => { st.filtros.push((r) => r[c] === v); return b },
      or: (expr: string) => {
        const lte = expr.match(/stripe_evento_em\.lte\.(.+)$/)?.[1]
        st.filtros.push((r) => r.stripe_evento_em == null || (lte !== undefined && Date.parse(r.stripe_evento_em) <= Date.parse(lte)))
        return b
      },
      limit: () => b,
      maybeSingle: () => { st.single = true; return b },
      then: (ok: (v: any) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, err),
    }
    const exec = () => {
      if (this.falhas.has(`${tabela}:${st.op}`)) return { data: null, error: { message: `falha simulada ${tabela}:${st.op}` } }
      const alvo = linhas().filter((r) => st.filtros.every((f) => f(r)))
      if (st.op === 'update') {
        for (const r of alvo) Object.assign(r, st.dados)
        return { data: st.retorna ? alvo.map((r) => ({ usuario_id: r.usuario_id })) : null, error: null }
      }
      return { data: st.single ? (alvo[0] ?? null) : alvo, error: null }
    }
    return b
  }
  rpc(nome: string, args: Record<string, unknown>) {
    this.rpcChamadas.push({ nome, args })
    return Promise.resolve(this.rpcResposta)
  }
}

type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: URLSearchParams }
type Rota = { status: number; corpo?: unknown }
let banco: Banco
let chamadas: Chamada[]
let rotas: Record<string, Rota> // "METODO caminho"

function fetchSimulado(): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const caminho = String(url).replace('https://api.stripe.com/v1/', '')
    const metodo = init?.method ?? 'GET'
    chamadas.push({ url: caminho, metodo, headers: (init?.headers ?? {}) as Record<string, string>, corpo: new URLSearchParams(String(init?.body ?? '')) })
    const r = rotas[`${metodo} ${caminho}`] ?? { status: 404 }
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status })
  }) as typeof fetch
}

const USUARIO = { id: 'u1', email: 'dono@exemplo.com' }
function requisicao(corpo: unknown, origin?: string, autorizado = true) {
  return new Request('https://x/fn', {
    method: 'POST',
    body: JSON.stringify(corpo),
    headers: { ...(origin ? { origin } : {}), ...(autorizado ? { Authorization: 'Bearer jwt' } : {}) },
  })
}
const deps = (extra: Record<string, unknown> = {}) => ({
  autenticar: async (jwt: string) => (jwt === 'jwt' ? USUARIO : null),
  supabase: banco as any,
  fetch: fetchSimulado(),
  stripeSecretKey: 'sk_teste',
  agoraMs: () => AGORA_MS,
  ...extra,
})
const sessaoCriada = () => chamadas.find((c) => c.url === 'checkout/sessions')
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(() => {
  banco = new Banco()
  banco.assinaturas = [{ usuario_id: 'u1', status: 'expired', stripe_subscription_id: null, stripe_customer_id: null, trial_ends_at: null, stripe_evento_em: null }]
  chamadas = []
  rotas = { 'POST checkout/sessions': { status: 200, corpo: { url: 'https://checkout.stripe.com/c/abc' } } }
})

describe('criar-checkout-stripe — não cobra em dobro', () => {
  test('sem JWT válido: 401', async () => {
    const r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }, undefined, false), deps())
    assert.equal(r.status, 401)
  })

  test('assinatura ativa ou em atraso: 409 em português e NENHUMA sessão criada', async () => {
    for (const status of ['active', 'past_due']) {
      banco.assinaturas[0].status = status
      const r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
      assert.equal(r.status, 409)
      assert.match((await r.json()).erro, /já tem uma assinatura/)
    }
    assert.equal(sessaoCriada(), undefined)
  })

  test('vinculada à Stripe e VIVA lá (mesmo com status local de teste): 409; cancelada-até-o-fim tem frase própria', async () => {
    banco.assinaturas[0] = { ...banco.assinaturas[0], status: 'trialing', stripe_subscription_id: 'sub_1' }
    rotas['GET subscriptions/sub_1'] = { status: 200, corpo: { status: 'active', cancel_at_period_end: false } }
    let r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(r.status, 409)
    rotas['GET subscriptions/sub_1'] = { status: 200, corpo: { status: 'active', cancel_at_period_end: true } }
    r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(r.status, 409)
    assert.match((await r.json()).erro, /cancelada, mas continua ativa até o fim do período/)
    assert.equal(sessaoCriada(), undefined)
  })

  test('vinculada mas encerrada na Stripe (canceled / 404): pode assinar de novo', async () => {
    banco.assinaturas[0] = { ...banco.assinaturas[0], status: 'expired', stripe_subscription_id: 'sub_1' }
    rotas['GET subscriptions/sub_1'] = { status: 200, corpo: { status: 'canceled' } }
    assert.equal((await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())).status, 200)
    chamadas.length = 0
    rotas['GET subscriptions/sub_1'] = { status: 404 }
    assert.equal((await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())).status, 200)
  })

  test('Stripe fora do ar ao conferir a assinatura: falha FECHADA (502 genérico, sem criar sessão)', async () => {
    banco.assinaturas[0] = { ...banco.assinaturas[0], status: 'expired', stripe_subscription_id: 'sub_1' }
    rotas['GET subscriptions/sub_1'] = { status: 503 }
    const r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(r.status, 502)
    assert.equal((await r.json()).erro, MSG_CHECKOUT_FALHA)
    assert.equal(sessaoCriada(), undefined)
  })

  test('erro da Stripe ao criar a sessão: mensagem genérica (o detalhe não vaza para o cliente)', async () => {
    rotas['POST checkout/sessions'] = { status: 400, corpo: { error: { type: 'invalid_request_error', message: 'No such price: price_SEGREDO_INTERNO' } } }
    const r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(r.status, 502)
    const texto = await r.text()
    assert.ok(!texto.includes('price_SEGREDO_INTERNO'))
    assert.ok(texto.includes(MSG_CHECKOUT_FALHA))
  })

  test('plano/ciclo malformados e oferta inexistente', async () => {
    assert.equal((await tratarCriarCheckout(requisicao({ plano: 'pro; drop', ciclo: 'mensal' }), deps())).status, 400)
    assert.equal((await tratarCriarCheckout(requisicao({ plano: 'pro' }), deps())).status, 400)
    assert.equal((await tratarCriarCheckout(requisicao({ plano: 'ouro', ciclo: 'mensal' }), deps())).status, 422)
  })
})

describe('criar-checkout-stripe — cliente, idempotência e redirecionamento', () => {
  test('reaproveita o stripe_customer_id (customer) em vez de customer_email', async () => {
    banco.assinaturas[0].stripe_customer_id = 'cus_1'
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(sessaoCriada()!.corpo.get('customer'), 'cus_1')
    assert.equal(sessaoCriada()!.corpo.get('customer_email'), null)
  })
  test('sem cliente ainda: usa customer_email', async () => {
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(sessaoCriada()!.corpo.get('customer_email'), 'dono@exemplo.com')
    assert.equal(sessaoCriada()!.corpo.get('customer'), null)
    assert.equal(sessaoCriada()!.corpo.get('client_reference_id'), 'u1')
  })

  test('chave de idempotência: igual no duplo clique (mesma janela), diferente em outro plano e depois da janela', async () => {
    const chave = async (corpo: unknown, agora = AGORA_MS) => {
      chamadas.length = 0
      await tratarCriarCheckout(requisicao(corpo), deps({ agoraMs: () => agora }))
      return sessaoCriada()!.headers['Idempotency-Key']
    }
    const a = await chave({ plano: 'pro', ciclo: 'mensal' })
    assert.ok(a && a.includes('u1'))
    assert.equal(await chave({ plano: 'pro', ciclo: 'mensal' }, AGORA_MS + 60_000), a)
    banco.ofertas.push({ plano: 'essencial', ciclo: 'mensal', ativo: true, stripe_price_id: 'price_ess' })
    assert.notEqual(await chave({ plano: 'essencial', ciclo: 'mensal' }), a)
    assert.notEqual(await chave({ plano: 'pro', ciclo: 'mensal' }, AGORA_MS + 6 * 60_000), a)
  })

  test('origens: desconhecida e app Android caem no app público; dev e produção são mantidas', async () => {
    const urlDe = async (origin?: string) => {
      chamadas.length = 0
      await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }, origin), deps())
      return sessaoCriada()!.corpo.get('success_url')
    }
    assert.equal(await urlDe('https://evil.example'), 'https://app.saiae.com.br/?assinatura=sucesso')
    assert.equal(await urlDe(undefined), 'https://app.saiae.com.br/?assinatura=sucesso')
    assert.equal(await urlDe('https://localhost'), 'https://app.saiae.com.br/?assinatura=sucesso')
    assert.equal(await urlDe('http://localhost:5173'), 'http://localhost:5173/?assinatura=sucesso')
    assert.equal(await urlDe('https://app.saiae.com.br'), 'https://app.saiae.com.br/?assinatura=sucesso')
    assert.equal(origemDeRetorno('https://x.com', ['https://x.com']), 'https://x.com')
  })
})

describe('criar-checkout-stripe — teste grátis (cobra só quando o teste acabar)', () => {
  const emTeste = (ms: number | null, status = 'trialing') => {
    banco.assinaturas[0].status = status
    banco.assinaturas[0].trial_ends_at = ms === null ? null : iso(ms)
  }

  test('durante o teste: trial_end = trial_ends_at (em segundos) e a resposta diz que a cobrança começa no fim', async () => {
    emTeste(AGORA_MS + 10 * DIA)
    const r = await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    const corpo = await r.json()
    assert.equal(sessaoCriada()!.corpo.get('subscription_data[trial_end]'), String(Math.floor((AGORA_MS + 10 * DIA) / 1000)))
    assert.equal(corpo.inicio_cobranca, 'fim_do_teste')
    assert.equal(corpo.teste_ate, iso(AGORA_MS + 10 * DIA))
  })

  test('faltando menos de 48 h: cobra na hora (a Stripe recusaria trial_end) e avisa a tela', async () => {
    emTeste(AGORA_MS + 24 * 3600_000)
    const corpo = await (await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())).json()
    assert.equal(sessaoCriada()!.corpo.get('subscription_data[trial_end]'), null)
    assert.equal(corpo.inicio_cobranca, 'imediata')
    assert.equal(corpo.teste_curto_demais, true)
  })

  test('limite exato: MIN_TRIAL_MS à frente ainda usa trial_end; 1 ms a menos não', async () => {
    emTeste(AGORA_MS + MIN_TRIAL_MS)
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.notEqual(sessaoCriada()!.corpo.get('subscription_data[trial_end]'), null)
    chamadas.length = 0
    emTeste(AGORA_MS + MIN_TRIAL_MS - 1)
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.equal(sessaoCriada()!.corpo.get('subscription_data[trial_end]'), null)
  })

  test('teste vencido, sem data ou conta que não está em teste: cobra na hora, sem trial_end', async () => {
    for (const [ms, status] of [[AGORA_MS - DIA, 'trialing'], [null, 'trialing'], [AGORA_MS + 10 * DIA, 'expired']] as const) {
      chamadas.length = 0
      emTeste(ms, status)
      const corpo = await (await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())).json()
      assert.equal(sessaoCriada()!.corpo.get('subscription_data[trial_end]'), null, `${status}/${ms}`)
      assert.equal(corpo.inicio_cobranca, 'imediata')
      assert.equal(corpo.teste_curto_demais, undefined, 'sem aviso de "teste curto" quando não há teste')
    }
  })

  test('a chave de idempotência muda com o trial_end (mesmos parâmetros => mesma chave; senão a Stripe recusa)', async () => {
    emTeste(AGORA_MS + 10 * DIA)
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    const comTeste = sessaoCriada()!.headers['Idempotency-Key']
    chamadas.length = 0
    emTeste(null)
    await tratarCriarCheckout(requisicao({ plano: 'pro', ciclo: 'mensal' }), deps())
    assert.notEqual(sessaoCriada()!.headers['Idempotency-Key'], comTeste)
  })
})

describe('cancelar-assinatura-stripe', () => {
  const ativa = () => {
    banco.assinaturas[0] = { ...banco.assinaturas[0], status: 'active', stripe_subscription_id: 'sub_1', current_period_end: null }
  }
  const respostaCancelada = (periodo: number | null, cancelAtEnd = true) => ({
    status: 200,
    corpo: { id: 'sub_1', cancel_at_period_end: cancelAtEnd, ...(periodo ? { items: { data: [{ current_period_end: periodo }] } } : {}) },
  })
  beforeEach(() => {
    ativa()
    rotas['POST subscriptions/sub_1'] = respostaCancelada(FIM_PERIODO_S)
  })

  test('cancela: grava canceled COM o fim do período devolvido pela Stripe (acesso segue até lá)', async () => {
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(r.status, 200)
    assert.equal(banco.assinaturas[0].status, 'canceled')
    assert.equal(banco.assinaturas[0].current_period_end, new Date(FIM_PERIODO_S * 1000).toISOString())
    assert.equal(chamadas[0].corpo.get('cancel_at_period_end'), 'true')
    assert.deepEqual(banco.rpcChamadas[0], { nome: 'consulta_externa_registrar', args: { p_usuario_id: 'u1', p_tipo: 'cancelar_assinatura', p_limite: LIMITE_CANCELAMENTOS_HORA } })
  })

  test('Stripe sem fim de período: NÃO grava canceled (cortaria o acesso na hora); estado fica com o webhook', async () => {
    rotas['POST subscriptions/sub_1'] = respostaCancelada(null)
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(r.status, 200)
    assert.equal((await r.json()).aguardando_confirmacao, true)
    assert.equal(banco.assinaturas[0].status, 'active')
    assert.equal(banco.assinaturas[0].current_period_end, null)
  })

  test('fallback do período na raiz da assinatura (API antiga) também vale', async () => {
    rotas['POST subscriptions/sub_1'] = { status: 200, corpo: { cancel_at_period_end: true, current_period_end: FIM_PERIODO_S } }
    await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(banco.assinaturas[0].status, 'canceled')
    assert.equal(banco.assinaturas[0].current_period_end, new Date(FIM_PERIODO_S * 1000).toISOString())
  })

  test('erro ao gravar vira resposta de erro (500, mensagem útil), não "sucesso" silencioso', async () => {
    banco.falhas.add('assinaturas:update')
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(r.status, 500)
    assert.match((await r.json()).erro, /registrado na Stripe/)
    assert.equal(banco.assinaturas[0].status, 'active')
  })

  test('só cancela assinatura ATIVA: em atraso, expirada e teste recebem 409 e a Stripe nem é chamada', async () => {
    for (const status of ['past_due', 'expired', 'trialing']) {
      chamadas.length = 0
      banco.assinaturas[0].status = status
      const r = await tratarCancelarAssinatura(requisicao({}), deps())
      assert.equal(r.status, 409, status)
      assert.equal(chamadas.length, 0)
      assert.equal(banco.assinaturas[0].status, status, 'a carência não é cortada')
    }
  })

  test('já cancelada: responde ok sem chamar a Stripe; sem vínculo Stripe: 422', async () => {
    banco.assinaturas[0].status = 'canceled'
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.deepEqual(await r.json(), { ok: true, ja_cancelada: true })
    assert.equal(chamadas.length, 0)
    banco.assinaturas[0].stripe_subscription_id = null
    assert.equal((await tratarCancelarAssinatura(requisicao({}), deps())).status, 422)
  })

  test('limite de tentativas: estourou => 429 sem chamar a Stripe; erro no limitador => 503', async () => {
    banco.rpcResposta = { data: false, error: null }
    assert.equal((await tratarCancelarAssinatura(requisicao({}), deps())).status, 429)
    banco.rpcResposta = { data: null, error: { message: 'boom' } }
    assert.equal((await tratarCancelarAssinatura(requisicao({}), deps())).status, 503)
    assert.equal(chamadas.length, 0)
  })

  test('erro da Stripe: mensagem genérica, sem vazar o detalhe, e nada é gravado', async () => {
    rotas['POST subscriptions/sub_1'] = { status: 400, corpo: { error: { type: 'invalid_request_error', message: 'detalhe interno sub_1' } } }
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(r.status, 502)
    const texto = await r.text()
    assert.ok(!texto.includes('detalhe interno'))
    assert.ok(texto.includes(MSG_CANCELAR_FALHA))
    assert.equal(banco.assinaturas[0].status, 'active')
  })

  test('mesmo critério de ordem do webhook: se um evento MAIS NOVO já foi aplicado, não sobrescreve (e não é erro)', async () => {
    banco.assinaturas[0].stripe_evento_em = iso(AGORA_MS + 60_000)
    const r = await tratarCancelarAssinatura(requisicao({}), deps())
    assert.equal(r.status, 200)
    assert.equal(banco.assinaturas[0].status, 'active')
  })

  test('sem JWT: 401', async () => {
    assert.equal((await tratarCancelarAssinatura(requisicao({}, undefined, false), deps())).status, 401)
  })
})
