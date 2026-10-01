// Cria uma Checkout Session da Stripe pro dono assinar o Sai aê — chamada
// por src/pages/Assinar.tsx (autenticado, usuário já logado). Substitui o
// redirecionamento estático pra Kirvano: a Stripe não usa link fixo por
// plano, a sessão é criada na hora via API com o price_id certo.
//
// client_reference_id = usuario_id é como webhook-stripe liga a assinatura
// de volta à conta (mesmo papel que utm.src=usuario_id tinha na Kirvano).
import { createClient } from 'jsr:@supabase/supabase-js@2'

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

  let plano: string | undefined
  let ciclo: string | undefined
  try {
    const body = await req.json()
    plano = body?.plano
    ciclo = body?.ciclo
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }

  if (!plano || !ciclo) {
    return jsonResponse({ erro: 'plano e ciclo são obrigatórios' }, 400)
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
    return jsonResponse({ erro: 'Stripe ainda não configurada — falta o secret STRIPE_SECRET_KEY' }, 500)
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: oferta, error: erroOferta } = await supabaseAdmin
    .from('assinatura_ofertas')
    .select('stripe_price_id')
    .eq('plano', plano)
    .eq('ciclo', ciclo)
    .eq('ativo', true)
    .maybeSingle()

  if (erroOferta || !oferta?.stripe_price_id) {
    return jsonResponse({ erro: 'Essa oferta ainda não está disponível' }, 422)
  }

  const origin = req.headers.get('origin') || 'https://app.saiae.com.br'

  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('line_items[0][price]', oferta.stripe_price_id)
  params.set('line_items[0][quantity]', '1')
  params.set('client_reference_id', userData.user.id)
  if (userData.user.email) params.set('customer_email', userData.user.email)
  params.set('metadata[usuario_id]', userData.user.id)
  params.set('subscription_data[metadata][usuario_id]', userData.user.id)
  params.set('success_url', `${origin}/?assinatura=sucesso`)
  params.set('cancel_url', `${origin}/?assinatura=cancelada`)

  let respostaStripe: Response
  try {
    respostaStripe = await fetch('https://api.stripe.com/v1/checkout/sessions', {
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

  if (!respostaStripe.ok || !resultado?.url) {
    return jsonResponse({ erro: resultado?.error?.message ?? 'Erro desconhecido na Stripe' }, 502)
  }

  return jsonResponse({ url: resultado.url })
})
