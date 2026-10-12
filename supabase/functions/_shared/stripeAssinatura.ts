// Checkout e cancelamento da assinatura SaaS (dono da barraca → Sai aê) na Stripe. Fica em _shared, sem imports de
// jsr:/Deno, pra ser EXECUTADO nos testes (tests/stripeAssinatura.test.ts) com supabase e fetch simulados; as Edge
// Functions (criar-checkout-stripe, cancelar-assinatura-stripe) só ligam as dependências reais.
//
// Checkout: nunca cobra em dobro (409 se já há assinatura viva), reaproveita o cliente da Stripe, usa chave de
// idempotência (duplo clique), só redireciona pra origens conhecidas e não repassa a mensagem de erro da Stripe.
// Cancelamento: só cancela assinatura ativa; grava `canceled` SÓ com o fim do período devolvido pela Stripe (período
// nulo cortaria o acesso na hora: assinatura_tem_acesso exige current_period_end > now() em 'canceled'); checa erro;
// segue o mesmo critério de ordem do webhook (stripe_evento_em); limite de tentativas.
import { STRIPE_API, atualizarAssinatura, periodoFimIso, type SupabaseMinimo } from './stripeWebhook.ts'

export const URL_APP_PUBLICA = 'https://app.saiae.com.br'
/** Origens de onde o checkout pode ser iniciado. `https://localhost` é o WebView do app Android (Capacitor). */
export const ORIGENS_PADRAO = [URL_APP_PUBLICA, 'https://localhost', 'http://localhost:5173', 'http://localhost:4173']
export const LIMITE_CANCELAMENTOS_HORA = 5
const JANELA_IDEMPOTENCIA_MS = 5 * 60 * 1000
/** A Stripe exige trial_end a pelo menos 48 h no futuro; 10 min de folga cobrem a latência até a API. */
export const MIN_TRIAL_MS = 48 * 60 * 60 * 1000 + 10 * 60 * 1000
/** Estados da assinatura na Stripe em que uma segunda assinatura seria cobrança em dobro. */
const STATUS_STRIPE_VIVOS = ['active', 'trialing', 'past_due', 'unpaid']

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const MSG_CHECKOUT_FALHA = 'Não foi possível iniciar o pagamento agora. Tente de novo em instantes.'
export const MSG_CANCELAR_FALHA = 'Não foi possível cancelar agora. Tente novamente em instantes.'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

export type DepsAssinatura = {
  /** Valida o JWT do usuário (supabase.auth.getUser com a anon key). */
  autenticar: (jwt: string) => Promise<{ id: string; email: string | null } | null>
  supabase: SupabaseMinimo & { rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
  fetch: typeof fetch
  stripeSecretKey: string | undefined
  origensPermitidas?: string[]
  agoraMs?: () => number
}

/** Pra onde a Stripe devolve o usuário. Origem desconhecida cai no app público; o WebView do Android
 * (`https://localhost`) também, porque a página de retorno abre no navegador do sistema, fora do app. */
export function origemDeRetorno(origin: string | null, permitidas: string[] = ORIGENS_PADRAO): string {
  if (!origin || !permitidas.includes(origin)) return URL_APP_PUBLICA
  if (origin === 'https://localhost') return URL_APP_PUBLICA
  return origin
}

async function lerCorpo(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const corpo = await req.json()
    return corpo && typeof corpo === 'object' ? (corpo as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const TOKEN = /^[a-z0-9_-]{1,30}$/i

export async function tratarCriarCheckout(req: Request, deps: DepsAssinatura): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const corpo = await lerCorpo(req)
  if (!corpo) return json({ erro: 'JSON inválido' }, 400)
  const plano = typeof corpo.plano === 'string' ? corpo.plano : ''
  const ciclo = typeof corpo.ciclo === 'string' ? corpo.ciclo : ''
  if (!plano || !ciclo) return json({ erro: 'plano e ciclo são obrigatórios' }, 400)
  if (!TOKEN.test(plano) || !TOKEN.test(ciclo)) return json({ erro: 'plano ou ciclo inválido' }, 400)

  const usuario = await deps.autenticar((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''))
  if (!usuario) return json({ erro: 'Não autenticado' }, 401)

  const chaveStripe = deps.stripeSecretKey
  if (!chaveStripe) {
    console.error('criar-checkout-stripe: STRIPE_SECRET_KEY ausente')
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  const { supabase } = deps
  const agora = (deps.agoraMs ?? Date.now)()

  const { data: assinatura, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select('status, stripe_subscription_id, stripe_customer_id, trial_ends_at')
    .eq('usuario_id', usuario.id)
    .maybeSingle()
  if (erroAssinatura) {
    console.error('criar-checkout-stripe: leitura da assinatura', erroAssinatura.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }

  // Segunda assinatura = cobrança em dobro (e o webhook sobrescreveria o vínculo, deixando a antiga cobrando órfã).
  if (assinatura?.status === 'active' || assinatura?.status === 'past_due') {
    return json({ erro: 'Você já tem uma assinatura. Para mudar de plano ou ajustar o pagamento, fale com o suporte.' }, 409)
  }
  if (assinatura?.stripe_subscription_id) {
    // Vinculada mas o estado local não é "vivo" (ex.: cancelada que segue até o fim do período, boleto
    // pendente): a Stripe é a fonte da verdade. Na dúvida (Stripe fora do ar) NÃO cria outra: falha fechada.
    let resposta: Response
    try {
      resposta = await deps.fetch(`${STRIPE_API}/subscriptions/${assinatura.stripe_subscription_id}`, {
        headers: { Authorization: `Bearer ${chaveStripe}` },
      })
    } catch (erro) {
      console.error('criar-checkout-stripe: Stripe inacessível', String(erro))
      return json({ erro: MSG_CHECKOUT_FALHA }, 502)
    }
    if (resposta.ok) {
      const viva = (await resposta.json().catch(() => null)) as { status?: string; cancel_at_period_end?: boolean } | null
      if (viva?.status && STATUS_STRIPE_VIVOS.includes(viva.status)) {
        return json(
          {
            erro: viva.cancel_at_period_end
              ? 'Sua assinatura foi cancelada, mas continua ativa até o fim do período já pago. Você poderá assinar de novo depois disso.'
              : 'Você já tem uma assinatura. Para mudar de plano ou ajustar o pagamento, fale com o suporte.',
          },
          409,
        )
      }
    } else if (resposta.status !== 404) {
      console.error('criar-checkout-stripe: Stripe respondeu', resposta.status)
      return json({ erro: MSG_CHECKOUT_FALHA }, 502)
    }
  }

  const { data: oferta, error: erroOferta } = await supabase
    .from('assinatura_ofertas')
    .select('stripe_price_id')
    .eq('plano', plano)
    .eq('ciclo', ciclo)
    .eq('ativo', true)
    .maybeSingle()
  if (erroOferta) {
    console.error('criar-checkout-stripe: leitura da oferta', erroOferta.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (!oferta?.stripe_price_id) return json({ erro: 'Essa oferta ainda não está disponível' }, 422)

  const base = origemDeRetorno(req.headers.get('origin'), deps.origensPermitidas)
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('line_items[0][price]', oferta.stripe_price_id)
  params.set('line_items[0][quantity]', '1')
  params.set('client_reference_id', usuario.id)
  // Cliente já existente na Stripe: reaproveita (não cria um novo a cada tentativa).
  if (assinatura?.stripe_customer_id) params.set('customer', assinatura.stripe_customer_id)
  else if (usuario.email) params.set('customer_email', usuario.email)
  params.set('metadata[usuario_id]', usuario.id)
  params.set('subscription_data[metadata][usuario_id]', usuario.id)
  // Teste grátis do app (decisão do dono): quem assina DURANTE o teste só é cobrado quando ele acabar. Vale o que
  // resta do teste (trial_end = trial_ends_at). Faltando menos de 48 h a Stripe não aceita trial_end: cobra na hora
  // e a resposta avisa a tela (`inicio_cobranca: 'imediata'`).
  const fimTesteMs = assinatura?.status === 'trialing' && assinatura.trial_ends_at ? Date.parse(assinatura.trial_ends_at) : NaN
  const comTeste = Number.isFinite(fimTesteMs) && fimTesteMs - agora >= MIN_TRIAL_MS
  const trialEnd = comTeste ? Math.floor(fimTesteMs / 1000) : null
  if (trialEnd !== null) params.set('subscription_data[trial_end]', String(trialEnd))
  // Campo "Código promocional" no checkout (cupom de 100% pra testar o fluxo real sem cobrar, e promoções futuras).
  params.set('allow_promotion_codes', 'true')
  params.set('success_url', `${base}/?assinatura=sucesso`)
  params.set('cancel_url', `${base}/?assinatura=cancelada`)

  // Duplo clique em 5 min = mesma sessão. A janela evita reaproveitar, por 24 h, uma sessão já expirada.
  const janela = Math.floor(agora / JANELA_IDEMPOTENCIA_MS)
  const chaveIdempotencia = `checkout:${usuario.id}:${plano}:${ciclo}:${assinatura?.stripe_customer_id ?? 'novo'}:${base}:${trialEnd ?? 'sem-teste'}:${janela}`

  let respostaStripe: Response
  try {
    respostaStripe = await deps.fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chaveStripe}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': chaveIdempotencia,
      },
      body: params.toString(),
    })
  } catch (erro) {
    console.error('criar-checkout-stripe: Stripe inacessível', String(erro))
    return json({ erro: MSG_CHECKOUT_FALHA }, 502)
  }

  const resultado = (await respostaStripe.json().catch(() => null)) as
    | { url?: string; error?: { type?: string; code?: string; message?: string } }
    | null
  if (!respostaStripe.ok || !resultado?.url) {
    // O detalhe fica só no log; o cliente recebe a mensagem genérica.
    console.error('criar-checkout-stripe: Stripe recusou', respostaStripe.status, resultado?.error?.type, resultado?.error?.code, resultado?.error?.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 502)
  }
  return json({
    url: resultado.url,
    inicio_cobranca: trialEnd !== null ? 'fim_do_teste' : 'imediata',
    ...(trialEnd !== null ? { teste_ate: new Date(trialEnd * 1000).toISOString() } : {}),
    // Teste em andamento mas curto demais pra Stripe: a tela explica por que a cobrança começa agora.
    ...(trialEnd === null && Number.isFinite(fimTesteMs) && fimTesteMs > agora ? { teste_curto_demais: true } : {}),
  })
}

export async function tratarCancelarAssinatura(req: Request, deps: DepsAssinatura): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const usuario = await deps.autenticar((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''))
  if (!usuario) return json({ erro: 'Não autenticado' }, 401)

  const chaveStripe = deps.stripeSecretKey
  if (!chaveStripe) {
    console.error('cancelar-assinatura-stripe: STRIPE_SECRET_KEY ausente')
    return json({ erro: MSG_CANCELAR_FALHA }, 500)
  }
  const { supabase } = deps
  const agora = (deps.agoraMs ?? Date.now)()

  const { data: assinatura, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select('stripe_subscription_id, status')
    .eq('usuario_id', usuario.id)
    .maybeSingle()
  if (erroAssinatura) {
    console.error('cancelar-assinatura-stripe: leitura da assinatura', erroAssinatura.message)
    return json({ erro: MSG_CANCELAR_FALHA }, 500)
  }
  if (!assinatura?.stripe_subscription_id) {
    return json({ erro: 'Nenhuma assinatura Stripe encontrada pra essa conta. Se você assinou antes da migração, fala com o suporte.' }, 422)
  }
  if (assinatura.status === 'canceled') return json({ ok: true, ja_cancelada: true })
  // Só a ativa. Cancelar em atraso/expirada/teste cortaria a carência ou nem faz sentido.
  if (assinatura.status !== 'active') {
    return json({ erro: 'Só dá para cancelar uma assinatura ativa. Se o pagamento está em atraso, regularize ou fale com o suporte.' }, 409)
  }

  // Limite simples de tentativas por usuário (a Stripe é chamada a cada uma).
  const { data: cabe, error: erroLimite } = await supabase.rpc('consulta_externa_registrar', {
    p_usuario_id: usuario.id,
    p_tipo: 'cancelar_assinatura',
    p_limite: LIMITE_CANCELAMENTOS_HORA,
  })
  if (erroLimite) {
    console.error('cancelar-assinatura-stripe: limite', erroLimite.message)
    return json({ erro: MSG_CANCELAR_FALHA }, 503)
  }
  if (cabe !== true) return json({ erro: 'Muitas tentativas. Tente de novo mais tarde.' }, 429)

  let respostaStripe: Response
  try {
    respostaStripe = await deps.fetch(`${STRIPE_API}/subscriptions/${assinatura.stripe_subscription_id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chaveStripe}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ cancel_at_period_end: 'true' }).toString(),
    })
  } catch (erro) {
    console.error('cancelar-assinatura-stripe: Stripe inacessível', String(erro))
    return json({ erro: MSG_CANCELAR_FALHA }, 502)
  }
  const resultado = (await respostaStripe.json().catch(() => null)) as Record<string, unknown> | null
  if (!respostaStripe.ok || !resultado || resultado.cancel_at_period_end !== true) {
    const detalhe = (resultado?.error as { type?: string; code?: string; message?: string } | undefined) ?? {}
    console.error('cancelar-assinatura-stripe: Stripe recusou', respostaStripe.status, detalhe.type, detalhe.code, detalhe.message)
    return json({ erro: MSG_CANCELAR_FALHA }, 502)
  }

  // Fim do período devolvido pela Stripe (items.data[0] na API dahlia, raiz como fallback — mesmo critério do
  // webhook). Sem ele NÃO gravamos `canceled`: o acesso seria cortado na hora. O webhook
  // (customer.subscription.updated) grava o estado completo.
  const periodoFim = periodoFimIso(resultado)
  if (!periodoFim) {
    console.warn('cancelar-assinatura-stripe: Stripe não devolveu o fim do período; estado fica com o webhook')
    return json({ ok: true, aguardando_confirmacao: true })
  }

  const quandoIso = new Date(Math.floor(agora / 1000) * 1000).toISOString()
  const agoraIso = new Date(agora).toISOString()
  try {
    await atualizarAssinatura(
      supabase,
      { coluna: 'usuario_id', valor: usuario.id },
      { status: 'canceled', canceled_at: agoraIso, current_period_end: periodoFim, updated_at: agoraIso },
      quandoIso,
      // Só vira `canceled` quem está ativa: o webhook pode já ter mudado o estado entre a leitura e agora.
      { contexto: 'cancelar-assinatura-stripe', extra: (q) => q.eq('status', 'active') },
    )
  } catch (erro) {
    console.error('cancelar-assinatura-stripe: gravação', String(erro))
    return json(
      { erro: 'O cancelamento foi registrado na Stripe, mas não conseguimos atualizar sua tela agora. Atualize a página em instantes.' },
      500,
    )
  }
  return json({ ok: true })
}
