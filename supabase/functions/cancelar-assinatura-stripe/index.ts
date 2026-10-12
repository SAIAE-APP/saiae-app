// Cancela a assinatura Stripe do usuário autenticado — chamada por
// src/pages/Assinatura.tsx. Marca cancel_at_period_end=true na Stripe (o
// dono mantém acesso até o fim do período já pago, mesma semântica do
// status 'canceled' que o webhook-stripe já aplica) em vez de cancelar na
// hora — consistente com o texto "ativa até o fim do período".
//
// A lógica (só assinatura ativa, fim do período vindo da Stripe, update
// checado com o mesmo critério de ordem do webhook, limite de tentativas)
// vive em ../_shared/stripeAssinatura.ts e é executada em
// tests/stripeAssinatura.test.ts. O limite usa consulta_externa_registrar
// (migration 20261024120000 libera o tipo 'cancelar_assinatura').
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarCancelarAssinatura } from '../_shared/stripeAssinatura.ts'

Deno.serve((req: Request) =>
  tratarCancelarAssinatura(req, {
    autenticar: async (jwt) => {
      const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
      const { data, error } = await supabaseAuth.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id, email: data.user.email ?? null }
    },
    supabase: createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    fetch,
    stripeSecretKey: Deno.env.get('STRIPE_SECRET_KEY'),
  }),
)
