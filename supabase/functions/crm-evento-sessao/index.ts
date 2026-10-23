// Estado da conexão do WhatsApp avisado pelo CRM (contrato v1 §3, docs/contrato/v1/whatsapp-conexao.md). Rota
// SERVIDOR→SERVIDOR: só o CRM chama, assinada com HMAC; a assinatura é conferida ANTES de qualquer consulta.
// Segredo de plataforma: WHATSAPP_CONEXAO_SEGREDO (= COMANDA_WHATSAPP_SEGREDO do CRM). Nunca registra corpo nem ids.
// Deploy sem JWT (a autenticação é a assinatura):
//   supabase functions deploy crm-evento-sessao --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { tratarEventoSessao } from '../_shared/crmSessaoEvento.ts'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  // O corpo é lido UMA vez, em texto: é exatamente esse texto que foi assinado.
  const corpoBruto = await req.text()
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const r = await tratarEventoSessao(
    {
      corpoBruto,
      timestamp: req.headers.get('x-saiae-timestamp'),
      assinatura: req.headers.get('x-saiae-signature'),
      segredo: Deno.env.get('WHATSAPP_CONEXAO_SEGREDO'),
    },
    async (e) => {
      const { data, error } = await supabase.rpc('whatsapp_status_gravar', {
        p_barraca_id: e.barracaId,
        p_estado: e.estado,
        p_em: e.em,
      })
      if (error) {
        console.error('crm-evento-sessao: falha ao gravar o estado')
        return 'erro'
      }
      return data === 'ok' ? 'ok' : 'ignorado'
    },
  )
  return r.corpo
    ? new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } })
    : new Response(null, { status: r.status })
})
