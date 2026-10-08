// Contexto da loja para a IA do WhatsApp (contrato SAI-002, docs/contrato/v1/ia-contexto.md). Rota SERVIDOR→SERVIDOR:
// só o CRM chama, assinada com HMAC. A assinatura é conferida ANTES de qualquer consulta; sem ela nada vai ao banco.
// Segredo de plataforma: IA_CONTEXTO_SEGREDO (igual ao COMANDA_IA_SEGREDO do CRM). Nunca registra telefone, código
// nem corpo. Deploy sem JWT (a autenticação é a assinatura):
//   supabase functions deploy ia-contexto --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { TAMANHO_MAX_CORPO, validarCorpoIa, verificarAssinaturaIa } from '../_shared/iaAssinatura.ts'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  // Sem o segredo configurado a rota não existe de verdade: nunca aceita nada.
  const segredo = Deno.env.get('IA_CONTEXTO_SEGREDO')
  if (!segredo) return new Response(null, { status: 503 })

  const declarado = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAX_CORPO) return new Response(null, { status: 413 })

  // O corpo é lido UMA vez, em texto: é exatamente esse texto que foi assinado.
  const corpoBruto = await req.text()
  if (corpoBruto.length > TAMANHO_MAX_CORPO) return new Response(null, { status: 413 })

  const assinaturaValida = await verificarAssinaturaIa(
    segredo,
    req.headers.get('x-saiae-timestamp'),
    req.headers.get('x-saiae-signature'),
    corpoBruto,
  )
  if (!assinaturaValida) return new Response(null, { status: 401 })

  const corpo = validarCorpoIa(corpoBruto)
  if (!corpo.ok) return json({ erro: 'Corpo inválido' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data, error } = await supabase.rpc('ia_contexto', { p_codigo: corpo.codigo, p_telefone: corpo.telefone })
  if (error || !data) {
    console.error('ia-contexto: falha ao montar o contexto')
    return json({ erro: 'Falha ao montar o contexto' }, 500)
  }
  return json(data)
})
