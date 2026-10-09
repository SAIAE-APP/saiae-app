// "Enviar confirmação" da tela Atendente IA: pede ao CRM que mande ao WhatsApp cadastrado do dono o pedido
// "responda CONFIRMAR #CODIGO". Chamada pelo app com o login do dono: confere que a loja é dele, aplica o intervalo
// mínimo de 60 s (no banco) e só então fala com o CRM (assinado, contrato docs/contrato/v1/ia-dono-confirmar.md).
// O telefone enviado ao CRM sai do BANCO, nunca do navegador. Nunca devolve erro cru do CRM.
// Segredos: IA_CONTEXTO_SEGREDO (o mesmo da rota ia-contexto), CRM_IA_DONO_PEDIR_URL (URL da rota do CRM).
//   supabase functions deploy ia-dono-pedir-confirmacao --project-ref <ref>   (com JWT: quem chama é o dono logado)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { pedirConfirmacaoAoCrm } from '../_shared/iaDono.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: usuario, error: erroUsuario } = await supabaseAuth.auth.getUser(jwt)
  if (erroUsuario || !usuario?.user) return json({ erro: 'Não autenticado' }, 401)

  let corpo: { barraca_id?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  const barracaId = typeof corpo.barraca_id === 'string' ? corpo.barraca_id : ''
  if (!UUID.test(barracaId)) return json({ erro: 'Loja inválida' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // A loja precisa ser do usuário logado. Sem vínculo: 403, sem dizer se a loja existe.
  const { data: vinculo } = await supabase
    .from('usuarios_barracas')
    .select('barraca_id')
    .eq('usuario_id', usuario.user.id)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!vinculo) return json({ erro: 'Sem acesso a esta loja' }, 403)

  const { data: preparo, error: erroPreparo } = await supabase.rpc('ia_dono_pedir_preparar', { p_barraca_id: barracaId })
  if (erroPreparo || !preparo) {
    console.error('ia-dono-pedir-confirmacao: falha ao preparar')
    return json({ erro: 'Não foi possível pedir a confirmação agora' }, 500)
  }
  const p = preparo as { estado?: string; codigo?: string; telefone?: string }
  if (p.estado !== 'ok') return json({ ok: false, estado: p.estado ?? 'erro' })

  const r = await pedirConfirmacaoAoCrm({
    url: Deno.env.get('CRM_IA_DONO_PEDIR_URL'),
    segredo: Deno.env.get('IA_CONTEXTO_SEGREDO'),
    codigoLoja: p.codigo ?? '',
    telefone: p.telefone ?? '',
  })
  if (!r.ok || !r.enviado) {
    // O pedido não saiu: libera o intervalo para o dono tentar de novo logo.
    await supabase.from('barracas').update({ ia_dono_confirmacao_pedida_em: null }).eq('id', barracaId)
    if (r.ok) return json({ ok: false, estado: 'nao_enviado', motivo: r.motivo })
    console.error('ia-dono-pedir-confirmacao: CRM indisponível')
    return json({ erro: 'Confirmação indisponível' }, 502)
  }
  return json({ ok: true, estado: 'enviado' })
})
