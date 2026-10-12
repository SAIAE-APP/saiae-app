// Cria uma Checkout Session da Stripe pro dono assinar o Sai aê — chamada
// por src/pages/Assinar.tsx (autenticado, usuário já logado). Substitui o
// redirecionamento estático pra Kirvano: a Stripe não usa link fixo por
// plano, a sessão é criada na hora via API com o price_id certo.
//
// client_reference_id = usuario_id é como webhook-stripe liga a assinatura
// de volta à conta (mesmo papel que utm.src=usuario_id tinha na Kirvano).
//
// A lógica (409 com assinatura viva, cliente reaproveitado, idempotência,
// allowlist de origens, erro genérico) vive em ../_shared/stripeAssinatura.ts,
// sem imports de Deno, e é executada em tests/stripeAssinatura.test.ts.
// Secret opcional ALLOWED_ORIGINS (lista separada por vírgula) substitui a allowlist padrão.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { ORIGENS_PADRAO, tratarCriarCheckout } from '../_shared/stripeAssinatura.ts'

const origensEnv = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean)

Deno.serve((req: Request) =>
  tratarCriarCheckout(req, {
    autenticar: async (jwt) => {
      const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
      const { data, error } = await supabaseAuth.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id, email: data.user.email ?? null }
    },
    supabase: createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    fetch,
    stripeSecretKey: Deno.env.get('STRIPE_SECRET_KEY'),
    origensPermitidas: origensEnv.length > 0 ? origensEnv : ORIGENS_PADRAO,
  }),
)
