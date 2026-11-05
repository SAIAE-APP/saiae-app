// Recebe eventos de assinatura da Stripe e atualiza `assinaturas` — único
// portão de verdade da cobrança SaaS (dono da barraca → Sai aê), substitui
// processar_webhook_kirvano (RPC via PostgREST) nesse papel. Precisa ser
// Edge Function (não RPC): Stripe exige verificar a assinatura HMAC do
// header Stripe-Signature contra o CORPO BRUTO da requisição, que
// PostgREST não expõe pro SQL.
//
// Deploy com --no-verify-jwt (quem chama é a Stripe, sem JWT do Supabase
// Auth — a autenticação real é a assinatura HMAC verificada em
// ../_shared/stripeWebhook.ts).
//
// Toda a lógica (assinatura, idempotência, atualização das assinaturas) vive
// em ../_shared/stripeWebhook.ts, sem imports de Deno, para ser executada
// nos testes (tests/webhookStripe.test.ts) com supabase e fetch simulados.
// Requer a migration 20261024100000_assinaturas_stripe_evento_em.sql ANTES do deploy.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarWebhookStripe } from '../_shared/stripeWebhook.ts'

Deno.serve((req: Request) =>
  tratarWebhookStripe(req, {
    supabase: createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''),
    fetch,
    segredoWebhook: Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    stripeSecretKey: Deno.env.get('STRIPE_SECRET_KEY') ?? '',
    // Purchase pelo servidor: só liga com META_CAPI_TOKEN e/ou GA4_API_SECRET (secrets do Supabase).
    medicao: {
      fetch,
      metaToken: Deno.env.get('META_CAPI_TOKEN'),
      ga4Secret: Deno.env.get('GA4_API_SECRET'),
      testEventCode: Deno.env.get('META_TEST_EVENT_CODE'),
    },
    emSegundoPlano: (tarefa) => {
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).EdgeRuntime?.waitUntil(tarefa)
    },
  }),
)
