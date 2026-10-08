// Consumo do mês da IA do WhatsApp, para a tela "Atendente IA". Chamada pelo app com o login do dono: confere que a
// loja é dele, pergunta ao CRM (assinado, SAI-002) e devolve { mes, conversas, limite }. Nunca devolve erro cru do CRM.
// Segredos: IA_CONTEXTO_SEGREDO (o mesmo da rota ia-contexto), CRM_IA_CONSUMO_URL (URL da rota do CRM).
//   supabase functions deploy ia-consumo --project-ref <ref>   (com JWT: quem chama é o dono logado)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buscarConsumo, escolherLimite } from '../_shared/iaConsumo.ts'

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

  // A loja precisa ser do usuário logado (qualquer papel da barraca). Sem vínculo: 403, sem dizer se a loja existe.
  const { data: vinculo } = await supabase
    .from('usuarios_barracas')
    .select('barraca_id')
    .eq('usuario_id', usuario.user.id)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!vinculo) return json({ erro: 'Sem acesso a esta loja' }, 403)

  const { data: barraca } = await supabase.from('barracas').select('ia_codigo').eq('id', barracaId).maybeSingle()
  // Loja que nunca ligou a IA não tem código: nada a perguntar ao CRM.
  if (!barraca?.ia_codigo) return json({ ok: true, conversas: 0, limite: null, mes: null })

  const r = await buscarConsumo({
    url: Deno.env.get('CRM_IA_CONSUMO_URL'),
    segredo: Deno.env.get('IA_CONTEXTO_SEGREDO'),
    codigoLoja: barraca.ia_codigo,
  })
  if (!r.ok) {
    console.error('ia-consumo: consumo indisponível')
    return json({ erro: 'Consumo indisponível' }, 502)
  }

  // O limite é da Comanda (plano do dono em ia_limites_plano; cobrança desligada = plano pro). O do CRM é só reserva.
  const { data: dono } = await supabase
    .from('usuarios_barracas')
    .select('usuario_id')
    .eq('barraca_id', barracaId)
    .eq('papel', 'dono')
    .limit(1)
    .maybeSingle()
  const { data: cobranca } = await supabase.rpc('cobranca_ativa')
  let plano: string | null = cobranca === false ? 'pro' : null
  if (!plano && dono?.usuario_id) {
    const { data: assinatura } = await supabase.from('assinaturas').select('plan').eq('usuario_id', dono.usuario_id).maybeSingle()
    plano = assinatura?.plan ?? null
  }
  let limiteDaComanda: number | null = null
  if (plano) {
    const { data: linha } = await supabase.from('ia_limites_plano').select('conversas_mes').eq('plano', plano).maybeSingle()
    limiteDaComanda = linha?.conversas_mes ?? null
  }
  return json({ ok: true, ...r.consumo, limite: escolherLimite(limiteDaComanda, r.consumo.limite) })
})
