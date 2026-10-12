// Exclusão de conta self-service (Ajustes > Excluir minha conta). Irreversível.
// O usuário vem do JWT, nunca do body. Ordem: assinatura na Stripe (cancelamento imediato; se falhar, NADA é
// apagado) → dados (RPC excluir_dados_conta, só service role) → arquivos no Storage → login em auth.users. Se falhar
// no meio, dá pra tentar de novo: cada etapa é idempotente.
//
// A lógica vive em ../_shared/excluirConta.ts (sem imports de Deno) e é executada em tests/excluirConta.test.ts.
// Precisa do secret STRIPE_SECRET_KEY (o mesmo de criar-checkout-stripe).
//
// Deploy fica com o dono do produto (`supabase functions deploy excluir-conta`);
// a migration 20260928170000_excluir_dados_conta.sql precisa estar aplicada antes.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarExcluirConta } from '../_shared/excluirConta.ts'
import { drenarFilaApagarIa } from '../_shared/iaApagarSupabase.ts'

Deno.serve((req: Request) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  return tratarExcluirConta(req, {
    autenticar: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data?.user ? null : { id: data.user.id }
    },
    admin,
    drenarFila: () => drenarFilaApagarIa(admin),
    fetch,
    stripeSecretKey: Deno.env.get('STRIPE_SECRET_KEY'),
  })
})
