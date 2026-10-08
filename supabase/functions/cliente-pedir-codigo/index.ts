// Pede um código de verificação por WhatsApp (perfil do cliente final). Endpoint PÚBLICO:
// resposta idêntica para telefone novo ou já cadastrado; limites por telefone, IP e loja; honeypot.
// Segredos: CLIENTE_HASH_PEPPER, CRM_CODIGO_URL, CRM_CODIGO_SEGREDO. Deploy sem JWT:
//   supabase functions deploy cliente-pedir-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { hashIp, ipDoCliente, pareceBot } from '../_shared/antiabuso.ts'
import { VALIDADE_CODIGO_MS, decidirLimites, gerarCodigo, hashSegredo } from '../_shared/clienteCodigo.ts'
import { enviarCodigoAoCrm } from '../_shared/codigoCrm.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const PRODUCAO_REF = 'vimjwzumjggrlvlxdejr'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; nome?: string; telefone?: string; website?: string; ms_no_checkout?: number }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  // Robô: mesma resposta de sucesso, sem enviar nada nem dizer o motivo.
  if (pareceBot(body)) return json({ ok: true, reenvio_em_s: 60 })

  const slug = String(body.barraca_slug ?? '').trim().toLowerCase().slice(0, 80)
  const nome = String(body.nome ?? '').trim().slice(0, 80)
  if (!slug) return json({ erro: 'Loja inválida' }, 400)
  if (nome.length < 2) return json({ erro: 'Informe seu nome' }, 422)
  if (!telefoneValido(String(body.telefone ?? ''))) return json({ erro: 'Informe um telefone com DDD' }, 422)
  const telefone = normalizarTelefone(String(body.telefone))

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  if (!pimenta) {
    console.error('cliente-pedir-codigo: CLIENTE_HASH_PEPPER ausente')
    return json({ erro: 'Não conseguimos enviar o código agora. Tente de novo.' }, 503)
  }

  const { data: barraca } = await supabase.from('barracas').select('id, codigos_dia_max').eq('slug', slug).maybeSingle()
  if (!barraca) return json({ erro: 'Loja não encontrada' }, 404)

  const agora = Date.now()
  const umaHora = new Date(agora - 3600_000).toISOString()
  const vinteQuatroH = new Date(agora - 24 * 3600_000).toISOString()
  const ipHash = await hashIp('cliente-codigo', ipDoCliente(req), barraca.id)

  const [{ count: porTelefone }, { count: porIp }, { count: porLoja }, { data: ultimo }] = await Promise.all([
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id).eq('telefone', telefone).gte('criado_em', umaHora),
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('criado_em', umaHora),
    supabase.from('cliente_codigos').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id).gte('criado_em', vinteQuatroH),
    supabase.from('cliente_codigos').select('criado_em').eq('barraca_id', barraca.id).eq('telefone', telefone).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
  ])

  const decisao = decidirLimites({
    pedidosTelefoneHora: porTelefone ?? 0,
    pedidosIpHora: porIp ?? 0,
    enviosLoja24h: porLoja ?? 0,
    tetoLoja: barraca.codigos_dia_max,
    msDesdeUltimoEnvio: ultimo ? agora - Date.parse(ultimo.criado_em) : null,
  })
  if (decisao === 'muito_cedo') return json({ erro: 'Aguarde um minuto para pedir outro código.' }, 429)
  if (decisao !== 'ok') return json({ erro: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429)

  const codigo = gerarCodigo()
  const requestId = crypto.randomUUID()
  const { error: erroInsert } = await supabase.from('cliente_codigos').insert({
    id: requestId,
    barraca_id: barraca.id,
    telefone,
    codigo_hash: await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo),
    expira_em: new Date(agora + VALIDADE_CODIGO_MS).toISOString(),
    ip_hash: ipHash,
  })
  if (erroInsert) {
    console.error('cliente-pedir-codigo: falha ao gravar código')
    return json({ erro: 'Não conseguimos enviar o código agora. Tente de novo.' }, 500)
  }

  // Simulação SÓ no staging (nunca na produção, mesmo que o secret exista por engano).
  const simulado =
    Deno.env.get('CODIGO_SIMULADO') === '1' && !(Deno.env.get('SUPABASE_URL') ?? '').includes(PRODUCAO_REF)
  if (simulado) return json({ ok: true, reenvio_em_s: 60, codigo_simulado: codigo })

  const envio = await enviarCodigoAoCrm({
    url: Deno.env.get('CRM_CODIGO_URL') ?? '',
    segredo: Deno.env.get('CRM_CODIGO_SEGREDO') ?? '',
    barracaId: barraca.id,
    telefone,
    codigo,
    requestId,
  })
  if (!envio.ok) {
    console.error('cliente-pedir-codigo: envio falhou:', envio.motivo)
    await supabase.from('cliente_codigos').delete().eq('id', requestId)
    return json({ erro: 'Não conseguimos enviar o código. Tente de novo.' }, 502)
  }
  return json({ ok: true, reenvio_em_s: 60 })
})
