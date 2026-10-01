// Recebe eventos de assinatura da Stripe e atualiza `assinaturas` — único
// portão de verdade da cobrança SaaS (dono da barraca → Sai aê), substitui
// processar_webhook_kirvano (RPC via PostgREST) nesse papel. Precisa ser
// Edge Function (não RPC): Stripe exige verificar a assinatura HMAC do
// header Stripe-Signature contra o CORPO BRUTO da requisição, que
// PostgREST não expõe pro SQL.
//
// Deploy com --no-verify-jwt (quem chama é a Stripe, sem JWT do Supabase
// Auth — a autenticação real é a assinatura HMAC verificada abaixo).
//
// Mesmo princípio de webhook-mercadopago: nunca confia cegamente no corpo
// do evento pra dado crítico (current_period_end, price) quando dá pra
// confirmar com um GET de volta pra API da Stripe.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const STRIPE_API = 'https://api.stripe.com/v1'
const TOLERANCIA_TIMESTAMP_SEGUNDOS = 300 // 5min, proteção contra replay

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function paraHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Reimplementa Stripe.webhooks.constructEvent manualmente (sem SDK) —
 * formato do header: "t=<timestamp>,v1=<assinatura hex>". Assinatura é
 * HMAC-SHA256 de "<timestamp>.<corpo bruto>" com o signing secret. */
async function assinaturaStripeValida(corpoBruto: string, headerAssinatura: string, segredo: string): Promise<boolean> {
  const partes = Object.fromEntries(
    headerAssinatura.split(',').map((parte) => parte.split('=') as [string, string]),
  )
  const timestamp = partes['t']
  const v1 = partes['v1']
  if (!timestamp || !v1) return false

  const agora = Math.floor(Date.now() / 1000)
  if (Math.abs(agora - Number(timestamp)) > TOLERANCIA_TIMESTAMP_SEGUNDOS) return false

  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinaturaCalculada = paraHex(
    await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${timestamp}.${corpoBruto}`)),
  )

  return assinaturaCalculada === v1
}

type EventoStripe = { id: string; type: string; data: { object: Record<string, unknown> } }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const corpoBruto = await req.text()
  const headerAssinatura = req.headers.get('Stripe-Signature') ?? ''
  const segredo = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!segredo) {
    return jsonResponse({ erro: 'STRIPE_WEBHOOK_SECRET não configurado' }, 500)
  }
  if (!(await assinaturaStripeValida(corpoBruto, headerAssinatura, segredo))) {
    return jsonResponse({ erro: 'Assinatura inválida' }, 400)
  }

  let evento: EventoStripe
  try {
    evento = JSON.parse(corpoBruto)
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

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

  async function buscarAssinaturaNaStripe(subscriptionId: string): Promise<Record<string, unknown> | null> {
    const resp = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${stripeSecretKey}` },
    })
    return resp.ok ? await resp.json() : null
  }

  const obj = evento.data.object

  switch (evento.type) {
    case 'checkout.session.completed': {
      const usuarioId = obj.client_reference_id as string | null
      const subscriptionId = obj.subscription as string | null
      const customerId = obj.customer as string | null
      // Boleto: a sessão "completa" (cliente gerou o boleto) MUITO antes do
      // pagamento cair — payment_status continua 'unpaid' até lá. Só
      // cartão/Pix instantâneo vem 'paid' já neste evento. Confirmação de
      // verdade pro caso do boleto é o invoice.paid, mais abaixo.
      const paymentStatus = obj.payment_status as string | null
      if (!usuarioId || !subscriptionId) break

      // Checkout Session não carrega current_period_end/price — confirma
      // com a Stripe em vez de confiar no corpo do evento.
      const assinaturaStripe = await buscarAssinaturaNaStripe(subscriptionId)
      if (!assinaturaStripe) {
        // 500 faz a Stripe tentar de novo — não dá pra ativar sem confirmar.
        return jsonResponse({ erro: 'Falha ao confirmar assinatura na Stripe' }, 500)
      }

      const items = assinaturaStripe.items as { data?: Array<{ price?: { id?: string } }> } | undefined
      const priceId = items?.data?.[0]?.price?.id ?? null
      const { data: oferta } = await supabase
        .from('assinatura_ofertas')
        .select('plano, ciclo')
        .eq('stripe_price_id', priceId)
        .maybeSingle()

      // Sempre linka a assinatura Stripe à conta (precisa disso pro
      // invoice.paid achar a linha certa depois, mesmo sem liberar acesso
      // ainda). Só ativa de verdade quando o pagamento já está confirmado.
      await supabase
        .from('assinaturas')
        .update({
          plan: oferta?.plano ?? 'pro',
          cycle: oferta?.ciclo ?? null,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          updated_at: new Date().toISOString(),
          ...(paymentStatus === 'paid'
            ? {
                status: 'active',
                current_period_end: new Date((assinaturaStripe.current_period_end as number) * 1000).toISOString(),
                grace_until: null,
                canceled_at: null,
              }
            : {}),
        })
        .eq('usuario_id', usuarioId)
      break
    }

    case 'invoice.paid': {
      const subscriptionId = obj.subscription as string | null
      if (!subscriptionId) break
      const assinaturaStripe = await buscarAssinaturaNaStripe(subscriptionId)
      if (!assinaturaStripe) break
      await supabase
        .from('assinaturas')
        .update({
          status: 'active',
          current_period_end: new Date((assinaturaStripe.current_period_end as number) * 1000).toISOString(),
          grace_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId)
      break
    }

    case 'invoice.payment_failed': {
      const subscriptionId = obj.subscription as string | null
      if (!subscriptionId) break
      await supabase
        .from('assinaturas')
        .update({
          status: 'past_due',
          grace_until: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId)
      break
    }

    // "updated" cobre tanto "usuário pediu cancelamento, mas mantém acesso
    // até o fim do período" (cancel_at_period_end=true) quanto "mudou de
    // ideia e reativou antes do fim do período" (volta a false).
    case 'customer.subscription.updated': {
      const subscriptionId = obj.id as string
      const canceladaNoFim = obj.cancel_at_period_end as boolean
      const periodoFim = new Date((obj.current_period_end as number) * 1000).toISOString()

      if (canceladaNoFim) {
        await supabase
          .from('assinaturas')
          .update({ status: 'canceled', canceled_at: new Date().toISOString(), current_period_end: periodoFim, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscriptionId)
      } else {
        await supabase
          .from('assinaturas')
          .update({ status: 'active', canceled_at: null, current_period_end: periodoFim, updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subscriptionId)
          .eq('status', 'canceled')
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscriptionId = obj.id as string
      await supabase
        .from('assinaturas')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          current_period_end: new Date((obj.current_period_end as number) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId)
      break
    }

    case 'charge.refunded': {
      const invoiceId = obj.invoice as string | null
      if (!invoiceId) break
      const respInvoice = await fetch(`${STRIPE_API}/invoices/${invoiceId}`, {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      })
      const invoice = respInvoice.ok ? await respInvoice.json() : null
      const subscriptionId = invoice?.subscription as string | undefined
      if (!subscriptionId) break
      await supabase
        .from('assinaturas')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .eq('stripe_subscription_id', subscriptionId)
      break
    }

    default:
      break // evento não tratado: já ficou logado em eventos_webhook_stripe
  }

  return jsonResponse({ ok: true })
})
