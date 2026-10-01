// Cancela a assinatura Stripe do usuário autenticado — chamada por
// src/pages/Assinatura.tsx. Marca cancel_at_period_end=true na Stripe (o
// dono mantém acesso até o fim do período já pago, mesma semântica do
// status 'canceled' que o webhook-stripe já aplica) em vez de cancelar na
// hora — consistente com o texto "ativa até o fim do período".
//
// Atualiza `assinaturas` otimisticamente aqui mesmo (não espera o
// webhook) pra UI responder na hora; o customer.subscription.updated que
// a Stripe dispara em seguida confirma a mesma coisa de novo — idempotente,
// sem problema reaplicar.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const STRIPE_API = 'https://api.stripe.com/v1'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data: userData, error: erroUser } = await supabaseAuth.auth.getUser(jwt)
  if (erroUser || !userData?.user) {
    return jsonResponse({ erro: 'Não autenticado' }, 401)
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeSecretKey) {
    return jsonResponse({ erro: 'Stripe não configurada' }, 500)
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: assinatura, error: erroAssinatura } = await supabaseAdmin
    .from('assinaturas')
    .select('stripe_subscription_id, status, current_period_end')
    .eq('usuario_id', userData.user.id)
    .maybeSingle()

  if (erroAssinatura || !assinatura?.stripe_subscription_id) {
    return jsonResponse(
      { erro: 'Nenhuma assinatura Stripe encontrada pra essa conta. Se você assinou antes da migração, fala com o suporte.' },
      422,
    )
  }

  if (assinatura.status === 'canceled') {
    return jsonResponse({ ok: true, ja_cancelada: true })
  }

  const params = new URLSearchParams()
  params.set('cancel_at_period_end', 'true')

  let respostaStripe: Response
  try {
    respostaStripe = await fetch(`${STRIPE_API}/subscriptions/${assinatura.stripe_subscription_id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
  } catch (erroRede) {
    return jsonResponse({ erro: `Falha ao contatar a Stripe: ${String(erroRede)}` }, 502)
  }

  const resultado = await respostaStripe.json().catch(() => null)

  if (!respostaStripe.ok) {
    return jsonResponse({ erro: resultado?.error?.message ?? 'Erro desconhecido na Stripe' }, 502)
  }

  await supabaseAdmin
    .from('assinaturas')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('usuario_id', userData.user.id)

  return jsonResponse({ ok: true })
})
