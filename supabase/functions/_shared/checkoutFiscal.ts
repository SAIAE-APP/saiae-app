// Checkout do módulo Fiscal (NFC-e): assinatura Stripe PRÓPRIA, sempre mensal, por CNPJ. Fica em _shared, sem imports
// de jsr:/Deno, pra ser EXECUTADO nos testes (tests/checkoutFiscal.test.ts). A Edge Function criar-checkout-fiscal só
// liga as dependências reais.
//
// Regras, todas no servidor: contratação precisa estar aberta (RPC fiscal_contratacao_aberta, padrão FALSO); a assinatura
// base precisa ser PAGA e vigente (RPC assinatura_base_paga_vigente: não vale teste, nem trial da Stripe sem cobrança, nem
// atraso; legado Pro active vale); a barraca é dele; o CNPJ vem de barracas.cnpj
// (nunca do cliente), normalizado e validado; o preço vem da oferta fiscal ativa (cliente nunca manda price). Antes de
// falar com a Stripe grava uma reserva `pendente` em fiscal_assinaturas: o índice único parcial e o trigger de fiscal_assinaturas (cnpj, barraca; inclui
// canceled ainda dentro do período pago) fazem clique repetido e requisição concorrente virarem 409, com UMA só sessão. Sem trial: fiscal não herda o teste da base.
import { normalizarCnpj } from './cnpj.ts'
import { comCors } from './cors.ts'
import { MSG_CHECKOUT_FALHA, origemDeRetorno, type DepsAssinatura } from './stripeAssinatura.ts'
import { STRIPE_API } from './stripeWebhook.ts'

const CORS_HEADERS = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
/** Versão do termo do Fiscal que o dono precisa aceitar (checkbox na tela); vai na metadata e liga o módulo no webhook. */
export const TERMO_FISCAL_VERSAO = 'termos-2026-10-v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Estados em que a linha impede nova contratação do mesmo CNPJ/barraca. */
export const STATUS_FISCAL_VIVOS = ['pendente', 'active', 'past_due']
/** A sessão da Stripe expira em 31 min (o mínimo aceito é 30); só depois de 35 min uma reserva parada pode ser reaproveitada. */
const SESSAO_EXPIRA_S = 31 * 60
const RESERVA_PARADA_MS = 35 * 60 * 1000

export const MSG_FISCAL_JA_CONTRATADO = 'O módulo Fiscal já está contratado (ou em contratação) para este CNPJ ou ponto de venda.'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

async function checkoutFiscalInterno(req: Request, deps: DepsAssinatura): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  const corpo = await req
    .json()
    .then((bruto) => (bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : null))
    .catch(() => null)
  if (!corpo) return json({ erro: 'JSON inválido' }, 400)
  const barracaId = typeof corpo.barraca_id === 'string' ? corpo.barraca_id : ''
  if (!UUID.test(barracaId)) return json({ erro: 'barraca_id inválido' }, 400)

  const usuario = await deps.autenticar((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''))
  if (!usuario) return json({ erro: 'Não autenticado' }, 401)

  const { supabase } = deps
  const agora = (deps.agoraMs ?? Date.now)()

  // Enquanto a emissão real não estiver homologada ponta a ponta, nenhuma sessão de checkout é criada.
  const { data: aberta, error: erroFlag } = await supabase.rpc('fiscal_contratacao_aberta', {})
  if (erroFlag) {
    console.error('criar-checkout-fiscal: flag', erroFlag.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (aberta !== true) return json({ erro: 'fiscal_indisponivel' }, 403)

  const chaveStripe = deps.stripeSecretKey
  if (!chaveStripe) {
    console.error('criar-checkout-fiscal: STRIPE_SECRET_KEY ausente')
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }

  const { data: assinatura, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select('stripe_customer_id, bloqueada_admin')
    .eq('usuario_id', usuario.id)
    .maybeSingle()
  if (erroAssinatura) {
    console.error('criar-checkout-fiscal: leitura da assinatura', erroAssinatura.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (assinatura?.bloqueada_admin) return json({ erro: 'Sua conta está bloqueada. Fale com o suporte do Sai aê.' }, 403)
  // Predicado único de "base paga e vigente" (SQL): Stripe active com pagamento > 0 e período em dia, ou legado Pro
  // active. Trial (inclusive o da Stripe, sem cobrança), atraso, cancelada e expirada não contratam fiscal.
  const { data: baseVigente, error: erroBase } = await supabase.rpc('assinatura_base_paga_vigente', { p_usuario_id: usuario.id })
  if (erroBase) {
    console.error('criar-checkout-fiscal: base vigente', erroBase.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (baseVigente !== true) {
    return json({ erro: 'assinatura_base_inativa', mensagem: 'O módulo Fiscal exige a assinatura do Sai aê ativa e em dia.' }, 403)
  }

  const { data: vinculo, error: erroVinculo } = await supabase
    .from('usuarios_barracas')
    .select('usuario_id')
    .eq('usuario_id', usuario.id)
    .eq('barraca_id', barracaId)
    .eq('papel', 'dono')
    .maybeSingle()
  if (erroVinculo) {
    console.error('criar-checkout-fiscal: vínculo', erroVinculo.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (!vinculo) return json({ erro: 'Sem acesso a esta barraca' }, 403)

  const { data: barraca, error: erroBarraca } = await supabase.from('barracas').select('cnpj').eq('id', barracaId).maybeSingle()
  if (erroBarraca) {
    console.error('criar-checkout-fiscal: barraca', erroBarraca.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  const cnpj = normalizarCnpj(barraca?.cnpj)
  if (!cnpj) {
    return json({ erro: 'cnpj_invalido', mensagem: 'Cadastre um CNPJ válido nas configurações da barraca antes de contratar o Fiscal.' }, 422)
  }

  const { data: oferta, error: erroOferta } = await supabase
    .from('assinatura_ofertas')
    .select('stripe_price_id')
    .eq('plano', 'fiscal')
    .eq('ciclo', 'mensal')
    .eq('ativo', true)
    .maybeSingle()
  if (erroOferta) {
    console.error('criar-checkout-fiscal: oferta', erroOferta.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }
  if (!oferta?.stripe_price_id) return json({ erro: 'Essa oferta ainda não está disponível' }, 422)

  // Termo aceito (versão atual) antes de qualquer reserva.
  if (corpo.termo_versao !== TERMO_FISCAL_VERSAO) {
    return json({ erro: 'termo_nao_aceito', mensagem: 'Aceite o termo do módulo Fiscal para continuar.' }, 422)
  }

  // Reserva: o índice único parcial decide quem fica com o CNPJ/barraca.
  const reservaId = crypto.randomUUID()
  const tentarReservar = () =>
    supabase.from('fiscal_assinaturas').insert({ id: reservaId, usuario_id: usuario.id, barraca_id: barracaId, cnpj, status: 'pendente' })
  let { error: erroReserva } = await tentarReservar()
  if (erroReserva?.code === '23505') {
    // Reserva abandonada do próprio usuário (a sessão já expirou na Stripe): libera e tenta uma vez mais.
    const corte = new Date(agora - RESERVA_PARADA_MS).toISOString()
    const { error: erroLiberar } = await supabase
      .from('fiscal_assinaturas')
      .delete()
      .eq('usuario_id', usuario.id)
      .eq('barraca_id', barracaId)
      .eq('status', 'pendente')
      .is('stripe_subscription_id', null)
      .lt('created_at', corte)
    if (erroLiberar) console.error('criar-checkout-fiscal: liberar reserva parada', erroLiberar.message)
    ;({ error: erroReserva } = await tentarReservar())
  }
  if (erroReserva) {
    if (erroReserva.code === '23505') return json({ erro: 'fiscal_ja_contratado', mensagem: MSG_FISCAL_JA_CONTRATADO }, 409)
    console.error('criar-checkout-fiscal: reserva', erroReserva.message)
    return json({ erro: MSG_CHECKOUT_FALHA }, 500)
  }

  const liberarReserva = async () => {
    const { error } = await supabase.from('fiscal_assinaturas').delete().eq('id', reservaId).eq('status', 'pendente')
    if (error) console.error('criar-checkout-fiscal: não consegui liberar a reserva', error.message)
  }

  const base = origemDeRetorno(req.headers.get('origin'), deps.origensPermitidas)
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('line_items[0][price]', oferta.stripe_price_id)
  params.set('line_items[0][quantity]', '1')
  if (assinatura?.stripe_customer_id) params.set('customer', assinatura.stripe_customer_id)
  else if (usuario.email) params.set('customer_email', usuario.email)
  // reserva_id: o webhook liga a assinatura à reserva por este id (nunca "adivinhando" pela barraca).
  for (const [chave, valor] of Object.entries({ tipo: 'fiscal', usuario_id: usuario.id, barraca_id: barracaId, cnpj, termo_versao: TERMO_FISCAL_VERSAO, reserva_id: reservaId })) {
    params.set(`metadata[${chave}]`, valor)
    params.set(`subscription_data[metadata][${chave}]`, valor)
  }
  params.set('expires_at', String(Math.floor(agora / 1000) + SESSAO_EXPIRA_S))
  params.set('success_url', `${base}/?fiscal=sucesso`)
  params.set('cancel_url', `${base}/?fiscal=cancelada`)

  let respostaStripe: Response
  try {
    respostaStripe = await deps.fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chaveStripe}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `fiscal:${reservaId}`,
      },
      body: params.toString(),
    })
  } catch (erro) {
    console.error('criar-checkout-fiscal: Stripe inacessível', String(erro))
    await liberarReserva()
    return json({ erro: MSG_CHECKOUT_FALHA }, 502)
  }
  const resultado = (await respostaStripe.json().catch(() => null)) as
    | { id?: string; url?: string; error?: { type?: string; code?: string; message?: string } }
    | null
  if (!respostaStripe.ok || !resultado?.url || !resultado.id) {
    console.error('criar-checkout-fiscal: Stripe recusou', respostaStripe.status, resultado?.error?.type, resultado?.error?.code, resultado?.error?.message)
    await liberarReserva()
    return json({ erro: MSG_CHECKOUT_FALHA }, 502)
  }

  // O webhook liga a assinatura pela metadata.reserva_id, então esta gravação é só informativa (idempotência/consulta).
  const { error: erroSessao } = await supabase
    .from('fiscal_assinaturas')
    .update({ stripe_checkout_session_id: resultado.id, updated_at: new Date(agora).toISOString() })
    .eq('id', reservaId)
  if (erroSessao) console.error('criar-checkout-fiscal: gravar sessão', erroSessao.message)

  return json({ url: resultado.url })
}

export function tratarCriarCheckoutFiscal(req: Request, deps: DepsAssinatura): Promise<Response> {
  return comCors(req, checkoutFiscalInterno(req, deps))
}
