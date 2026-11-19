// Cria a Checkout Session da Stripe do módulo Fiscal (NFC-e), autenticado. Assinatura Stripe própria, sempre
// mensal, por CNPJ. A lógica (flag de contratação, base ativa, dono, CNPJ, reserva) vive em
// ../_shared/checkoutFiscal.ts, sem imports de Deno, e é executada em tests/checkoutFiscal.test.ts.
// Depende da migration de fiscal_assinaturas e da RPC fiscal_contratacao_aberta.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarCriarCheckoutFiscal } from '../_shared/checkoutFiscal.ts'
import { ORIGENS_PADRAO } from '../_shared/stripeAssinatura.ts'

const origensEnv = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o) => o.trim()).filter(Boolean)

Deno.serve((req: Request) =>
  tratarCriarCheckoutFiscal(req, {
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
