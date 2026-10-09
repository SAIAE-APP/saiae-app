// Confirmação do WhatsApp do dono (CRM → Comanda; contrato docs/contrato/v1/ia-dono-confirmar.md). O CRM chama depois
// que o dono respondeu "CONFIRMAR #CODIGO" do número cadastrado. Assinada como a rota ia-contexto (mesmo segredo,
// IA_CONTEXTO_SEGREDO, janela de 5 min): a assinatura é conferida ANTES de qualquer consulta. Nunca registra
// telefone, código nem corpo. Deploy sem JWT (a autenticação é a assinatura):
//   supabase functions deploy ia-dono-confirmar --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { TAMANHO_MAX_CORPO, validarCorpoIa, verificarAssinaturaIa } from '../_shared/iaAssinatura.ts'
import { respostaDaConfirmacao } from '../_shared/iaDono.ts'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })

  const segredo = Deno.env.get('IA_CONTEXTO_SEGREDO')
  if (!segredo) return new Response(null, { status: 503 })

  const declarado = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAX_CORPO) return new Response(null, { status: 413 })

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
  const { data, error } = await supabase.rpc('ia_dono_confirmar', { p_codigo: corpo.codigo, p_telefone: corpo.telefone })
  if (error || !data) {
    console.error('ia-dono-confirmar: falha ao confirmar')
    return json({ confirmado: false, motivo: 'erro' }, 500)
  }
  return json(respostaDaConfirmacao((data as { estado?: unknown }).estado))
})
