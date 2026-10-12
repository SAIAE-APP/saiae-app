// Núcleo do webhook da Stripe (assinatura SaaS: dono da barraca → Sai aê). Fica em _shared, sem imports de
// jsr:/Deno, pra ser EXECUTADO nos testes (Node) com supabase e fetch simulados. A Edge Function
// (webhook-stripe/index.ts) só liga as dependências reais.
//
// Regras que este módulo garante:
//  - Idempotência por evento, mas SEM perder evento: se o processamento falha, o registro de idempotência é
//    apagado e a Stripe recebe 500 (ela reenvia). Antes, o registro ficava e o reenvio virava "duplicado".
//  - Todo update checa erro. invoice.paid que chega antes do checkout.session.completed (assinatura ainda não
//    vinculada) vira 500 pra Stripe reenviar, em vez de sumir.
//  - Evento atrasado não sobrescreve o mais novo (coluna assinaturas.stripe_evento_em).
//  - Só reembolso TOTAL tira o acesso.
//  - Comparação de assinatura em tempo constante e aceitando vários v1 (rotação de segredo).
import { iguaisConstante } from './clienteCodigo.ts'

export const STRIPE_API = 'https://api.stripe.com/v1'
export const TOLERANCIA_TIMESTAMP_SEGUNDOS = 300 // 5min, proteção contra replay

export type EventoStripe = { id: string; type: string; created?: number; data: { object: Record<string, unknown> } }

// Só o que o módulo usa do supabase-js (o teste injeta um simulado).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SupabaseMinimo = { from: (tabela: string) => any }

export type DepsWebhookStripe = {
  supabase: SupabaseMinimo
  fetch: typeof fetch
  segredoWebhook: string | undefined
  stripeSecretKey: string
  agoraMs?: () => number
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function paraHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Reimplementa Stripe.webhooks.constructEvent (sem SDK). Header: "t=<ts>,v1=<hex>[,v1=<hex>...]"; a assinatura
 * é HMAC-SHA256 de "<ts>.<corpo bruto>". Durante a rotação do segredo a Stripe manda mais de um v1: vale se
 * QUALQUER um bater. */
export async function assinaturaStripeValida(
  corpoBruto: string,
  headerAssinatura: string,
  segredo: string,
  agoraMs: number = Date.now(),
): Promise<boolean> {
  const partes = headerAssinatura.split(',').map((p) => p.trim())
  const timestamp = partes.find((p) => p.startsWith('t='))?.slice(2)
  const candidatas = partes.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  if (!timestamp || candidatas.length === 0) return false

  if (Math.abs(Math.floor(agoraMs / 1000) - Number(timestamp)) > TOLERANCIA_TIMESTAMP_SEGUNDOS) return false

  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const calculada = paraHex(
    await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${timestamp}.${corpoBruto}`)),
  )
  // some() sem curto-circuito observável importa pouco aqui: o que vaza tempo é a comparação, que é constante.
  return candidatas.map((c) => iguaisConstante(c, calculada)).some(Boolean)
}

/** Desde a API 2025-03-31 da Stripe, current_period_end saiu da raiz da assinatura e foi pra items.data[0].
 * A conta usa 2026-08-26.dahlia, então lê sempre do item primeiro; a raiz é só fallback. */
export function periodoFimIso(sub: Record<string, unknown>): string | null {
  const items = sub.items as { data?: Array<{ current_period_end?: number }> } | undefined
  const unixSegundos = items?.data?.[0]?.current_period_end ?? (sub.current_period_end as number | undefined)
  return typeof unixSegundos === 'number' ? new Date(unixSegundos * 1000).toISOString() : null
}

/** Mesma mudança da API basil+: a fatura não tem mais `subscription` na raiz; o id vem em
 * parent.subscription_details.subscription. A raiz fica de fallback pra eventos de versão antiga. */
export function subscriptionIdDaFatura(fatura: Record<string, unknown>): string | null {
  const parent = fatura.parent as { subscription_details?: { subscription?: unknown } } | null | undefined
  const doParent = parent?.subscription_details?.subscription
  const bruto = doParent ?? fatura.subscription
  if (typeof bruto === 'string') return bruto
  // Objeto expandido: { id }
  if (bruto && typeof bruto === 'object' && typeof (bruto as { id?: unknown }).id === 'string') {
    return (bruto as { id: string }).id
  }
  return null
}

type FiltroAssinatura = { coluna: 'usuario_id' | 'stripe_subscription_id'; valor: string }

/**
 * Atualiza `assinaturas` com 3 garantias: lança em erro; ignora evento mais antigo que o último aplicado
 * (stripe_evento_em); e, com `exigirLinha`, lança se NENHUMA assinatura existe pro filtro (ainda não vinculada:
 * a Stripe reenvia depois). "0 linhas porque o evento é atrasado" NÃO é erro.
 */
async function atualizarAssinatura(
  supabase: SupabaseMinimo,
  filtro: FiltroAssinatura,
  campos: Record<string, unknown>,
  quandoIso: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opcoes: { contexto: string; exigirLinha?: boolean; extra?: (q: any) => any },
): Promise<void> {
  let consulta = supabase
    .from('assinaturas')
    .update({ ...campos, stripe_evento_em: quandoIso })
    .eq(filtro.coluna, filtro.valor)
    .or(`stripe_evento_em.is.null,stripe_evento_em.lte.${quandoIso}`)
  if (opcoes.extra) consulta = opcoes.extra(consulta)
  const { data, error } = await consulta.select('usuario_id')
  if (error) throw new Error(`${opcoes.contexto}: ${error.message}`)
  if (data && data.length > 0) return
  if (!opcoes.exigirLinha) return

  const { data: existente, error: erroExiste } = await supabase
    .from('assinaturas')
    .select('usuario_id')
    .eq(filtro.coluna, filtro.valor)
    .limit(1)
  if (erroExiste) throw new Error(`${opcoes.contexto}: ${erroExiste.message}`)
  if (!existente || existente.length === 0) {
    throw new Error(`${opcoes.contexto}: assinatura ainda não vinculada (${filtro.coluna})`)
  }
  // Existe mas não atualizou: evento mais antigo que o último aplicado. Ignorar é o correto.
}

async function processarEvento(evento: EventoStripe, deps: DepsWebhookStripe): Promise<void> {
  const { supabase, stripeSecretKey } = deps
  const obj = evento.data.object
  const agora = (deps.agoraMs ?? Date.now)()
  const quandoIso = new Date(typeof evento.created === 'number' ? evento.created * 1000 : agora).toISOString()
  const agoraIso = new Date(agora).toISOString()

  async function buscarNaStripe(caminho: string): Promise<Record<string, unknown> | null> {
    const resp = await deps.fetch(`${STRIPE_API}/${caminho}`, { headers: { Authorization: `Bearer ${stripeSecretKey}` } })
    if (resp.ok) return await resp.json()
    // 404 = não existe (nada a fazer). Qualquer outra falha (5xx, 429, 401) é transitória/configuração: lança
    // pra Stripe reenviar em vez de descartar o evento.
    if (resp.status === 404) return null
    throw new Error(`Stripe ${caminho}: HTTP ${resp.status}`)
  }

  switch (evento.type) {
    case 'checkout.session.completed': {
      const usuarioId = obj.client_reference_id as string | null
      const subscriptionId = obj.subscription as string | null
      const customerId = obj.customer as string | null
      // Boleto: a sessão "completa" muito antes do pagamento cair (payment_status 'unpaid'). Só cartão/Pix
      // instantâneo vem 'paid' neste evento; a confirmação do boleto é o invoice.paid.
      const paymentStatus = obj.payment_status as string | null
      if (!usuarioId || !subscriptionId) break

      // A sessão não traz current_period_end/price: confirma na Stripe em vez de confiar no corpo.
      const assinaturaStripe = await buscarNaStripe(`subscriptions/${subscriptionId}`)
      if (!assinaturaStripe) throw new Error('checkout.session.completed: assinatura não encontrada na Stripe')

      const items = assinaturaStripe.items as { data?: Array<{ price?: { id?: string } }> } | undefined
      const priceId = items?.data?.[0]?.price?.id ?? null
      const { data: oferta, error: erroOferta } = await supabase
        .from('assinatura_ofertas')
        .select('plano, ciclo')
        .eq('stripe_price_id', priceId)
        .maybeSingle()
      if (erroOferta) throw new Error(`checkout.session.completed: oferta: ${erroOferta.message}`)

      // Sempre vincula a assinatura Stripe à conta (o invoice.paid precisa disso). Só ativa quando já pago.
      await atualizarAssinatura(
        supabase,
        { coluna: 'usuario_id', valor: usuarioId },
        {
          plan: oferta?.plano ?? 'pro',
          cycle: oferta?.ciclo ?? null,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          updated_at: agoraIso,
          ...(paymentStatus === 'paid'
            ? { status: 'active', current_period_end: periodoFimIso(assinaturaStripe), grace_until: null, canceled_at: null }
            : {}),
        },
        quandoIso,
        { contexto: 'checkout.session.completed' },
      )
      break
    }

    case 'invoice.paid': {
      const subscriptionId = subscriptionIdDaFatura(obj)
      if (!subscriptionId) break // fatura avulsa, sem assinatura
      const assinaturaStripe = await buscarNaStripe(`subscriptions/${subscriptionId}`)
      if (!assinaturaStripe) throw new Error('invoice.paid: assinatura não encontrada na Stripe')
      await atualizarAssinatura(
        supabase,
        { coluna: 'stripe_subscription_id', valor: subscriptionId },
        { status: 'active', current_period_end: periodoFimIso(assinaturaStripe), grace_until: null, updated_at: agoraIso },
        quandoIso,
        // invoice.paid pode chegar ANTES do checkout.session.completed: sem vínculo ainda, 500 pra reenviar.
        { contexto: 'invoice.paid', exigirLinha: true },
      )
      break
    }

    case 'invoice.payment_failed': {
      const subscriptionId = subscriptionIdDaFatura(obj)
      if (!subscriptionId) break
      await atualizarAssinatura(
        supabase,
        { coluna: 'stripe_subscription_id', valor: subscriptionId },
        { status: 'past_due', grace_until: new Date(agora + 3 * 24 * 60 * 60 * 1000).toISOString(), updated_at: agoraIso },
        quandoIso,
        { contexto: 'invoice.payment_failed', exigirLinha: true },
      )
      break
    }

    // "updated" cobre "pediu cancelamento, mantém acesso até o fim do período" (cancel_at_period_end=true) e
    // "mudou de ideia antes do fim" (volta a false).
    case 'customer.subscription.updated': {
      const subscriptionId = obj.id as string
      const canceladaNoFim = obj.cancel_at_period_end as boolean
      const periodoFim = periodoFimIso(obj)
      if (canceladaNoFim) {
        await atualizarAssinatura(
          supabase,
          { coluna: 'stripe_subscription_id', valor: subscriptionId },
          { status: 'canceled', canceled_at: agoraIso, current_period_end: periodoFim, updated_at: agoraIso },
          quandoIso,
          { contexto: 'customer.subscription.updated(cancelada)' },
        )
      } else {
        await atualizarAssinatura(
          supabase,
          { coluna: 'stripe_subscription_id', valor: subscriptionId },
          { status: 'active', canceled_at: null, current_period_end: periodoFim, updated_at: agoraIso },
          quandoIso,
          { contexto: 'customer.subscription.updated(reativada)', extra: (q) => q.eq('status', 'canceled') },
        )
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscriptionId = obj.id as string
      await atualizarAssinatura(
        supabase,
        { coluna: 'stripe_subscription_id', valor: subscriptionId },
        { status: 'canceled', canceled_at: agoraIso, current_period_end: periodoFimIso(obj), updated_at: agoraIso },
        quandoIso,
        { contexto: 'customer.subscription.deleted' },
      )
      break
    }

    case 'charge.refunded': {
      // Só reembolso TOTAL tira o acesso. `refunded` é true apenas quando a cobrança foi estornada por inteiro;
      // reembolso parcial/cortesia não mexe na assinatura.
      if (obj.refunded !== true) break
      const invoiceId = obj.invoice as string | null
      if (!invoiceId) {
        console.warn('webhook-stripe: charge.refunded sem invoice; assinatura NÃO alterada', evento.id)
        break
      }
      const fatura = await buscarNaStripe(`invoices/${invoiceId}`)
      const subscriptionId = fatura ? subscriptionIdDaFatura(fatura) : null
      if (!subscriptionId) break
      await atualizarAssinatura(
        supabase,
        { coluna: 'stripe_subscription_id', valor: subscriptionId },
        { status: 'expired', updated_at: agoraIso },
        quandoIso,
        { contexto: 'charge.refunded' },
      )
      break
    }

    default:
      break // evento não tratado: já ficou logado em eventos_webhook_stripe
  }
}

export async function tratarWebhookStripe(req: Request, deps: DepsWebhookStripe): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok')

  const corpoBruto = await req.text()
  const headerAssinatura = req.headers.get('Stripe-Signature') ?? ''

  if (!deps.segredoWebhook) {
    return jsonResponse({ erro: 'STRIPE_WEBHOOK_SECRET não configurado' }, 500)
  }
  if (!(await assinaturaStripeValida(corpoBruto, headerAssinatura, deps.segredoWebhook, (deps.agoraMs ?? Date.now)()))) {
    return jsonResponse({ erro: 'Assinatura inválida' }, 400)
  }

  let evento: EventoStripe
  try {
    evento = JSON.parse(corpoBruto)
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  const { supabase } = deps

  // Idempotência: evento repetido (retry da própria Stripe) não reprocessa.
  const { error: erroEvento } = await supabase.from('eventos_webhook_stripe').insert({
    stripe_event_id: evento.id,
    event: evento.type,
    payload: evento,
  })
  if (erroEvento) {
    if (erroEvento.code === '23505') return jsonResponse({ ok: true, duplicado: true })
    return jsonResponse({ erro: 'Falha ao registrar evento' }, 500)
  }

  try {
    await processarEvento(evento, deps)
  } catch (erro) {
    console.error('webhook-stripe: falha ao processar', evento.id, evento.type, String(erro))
    // Libera o evento: sem isto o reenvio da Stripe cairia em "duplicado" e o evento se perderia.
    const { error: erroApagar } = await supabase.from('eventos_webhook_stripe').delete().eq('stripe_event_id', evento.id)
    if (erroApagar) console.error('webhook-stripe: não consegui liberar a idempotência', evento.id, erroApagar.message)
    return jsonResponse({ erro: 'Falha ao processar evento' }, 500)
  }

  return jsonResponse({ ok: true })
}
