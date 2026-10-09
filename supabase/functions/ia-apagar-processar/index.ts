// Job periódico: reenvia ao CRM os pedidos de apagar conversas da IA que ainda estão na fila (ia_apagar_fila), com
// backoff. Chamado por um agendador (a cada 15 min) com o segredo do job no cabeçalho Authorization: Bearer <segredo>;
// sem o segredo configurado a rota não existe. Nunca devolve nem registra telefone, código ou erro do CRM.
// Segredos: IA_APAGAR_JOB_SEGREDO (do job), IA_CONTEXTO_SEGREDO e CRM_IA_APAGAR_URL (envio ao CRM).
//   supabase functions deploy ia-apagar-processar --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { segredosIguais } from '../_shared/eventosSaida.ts'
import { drenarFilaApagarIa } from '../_shared/iaApagarSupabase.ts'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const segredo = Deno.env.get('IA_APAGAR_JOB_SEGREDO')
  if (!segredo) return new Response(null, { status: 503 })
  const enviado = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!enviado || !segredosIguais(enviado, segredo)) return new Response(null, { status: 401 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const r = await drenarFilaApagarIa(supabase, 25, 8_000)
  return new Response(JSON.stringify({ ok: true, ...r }), { headers: { 'Content-Type': 'application/json' } })
})
