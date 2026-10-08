// Pede um código de verificação por WhatsApp (perfil do cliente final). Endpoint PÚBLICO:
// resposta idêntica para telefone novo ou já cadastrado; limites por telefone, IP e loja; honeypot.
// Segredos: CLIENTE_HASH_PEPPER, CRM_CODIGO_URL, CRM_CODIGO_SEGREDO. Deploy sem JWT:
//   supabase functions deploy cliente-pedir-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { hashIp, ipDoCliente, pareceBot } from '../_shared/antiabuso.ts'
import {
  LIMITE_IP_GLOBAL_HORA,
  LIMITE_IP_HORA,
  LIMITE_TELEFONE_HORA,
  VALIDADE_CODIGO_MS,
  codigoSimuladoPermitido,
  gerarCodigo,
  hashSegredo,
} from '../_shared/clienteCodigo.ts'
import { enviarCodigoAoCrm } from '../_shared/codigoCrm.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  const ipHash = await hashIp('cliente-codigo', ipDoCliente(req), barraca.id)
  const ipHashGlobal = await hashIp('cliente-codigo-global', ipDoCliente(req), 'global')

  // Limites e inserção ATÔMICOS (lock por loja+telefone no banco): nada de contar e inserir em duas idas.
  const codigo = gerarCodigo()
  const { data: reserva, error: erroReserva } = await supabase.rpc('cliente_reservar_codigo', {
    p_barraca_id: barraca.id,
    p_telefone: telefone,
    p_codigo_hash: await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo),
    p_expira_em: new Date(agora + VALIDADE_CODIGO_MS).toISOString(),
    p_ip_hash: ipHash,
    p_ip_hash_global: ipHashGlobal,
    p_limite_telefone: LIMITE_TELEFONE_HORA,
    p_limite_ip: LIMITE_IP_HORA,
    p_limite_ip_global: LIMITE_IP_GLOBAL_HORA,
  })
  const r = reserva as { decisao?: string; id?: string; enviosLoja24h?: number } | null
  if (erroReserva || !r) {
    console.error('cliente-pedir-codigo: falha ao reservar código')
    return json({ erro: 'Não conseguimos enviar o código agora. Tente de novo.' }, 500)
  }
  if (r.decisao === 'muito_cedo') return json({ erro: 'Aguarde um minuto para pedir outro código.' }, 429)
  if (r.decisao !== 'ok' || !r.id) {
    // Mensagem neutra (não revela se foi telefone, IP ou teto da loja); log só com contagem.
    if (r.decisao === 'limite_loja') console.warn('cliente-pedir-codigo: teto diário da loja atingido', r.enviosLoja24h ?? null)
    return json({ erro: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429)
  }
  const requestId = r.id

  // Simulação SÓ no staging (lista branca pelo ref; nunca na produção, mesmo com o secret por engano).
  if (codigoSimuladoPermitido(Deno.env.get('CODIGO_SIMULADO'), Deno.env.get('SUPABASE_URL'))) {
    return json({ ok: true, reenvio_em_s: 60, codigo_simulado: codigo })
  }

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
    // Não apaga: a linha continua contando nos limites; marca como falha e inutiliza (nunca foi entregue).
    const agoraIso = new Date().toISOString()
    await supabase.from('cliente_codigos').update({ falhou_em: agoraIso, usado_em: agoraIso }).eq('id', requestId)
    return json({ erro: 'Não conseguimos enviar o código. Tente de novo.' }, 502)
  }
  return json({ ok: true, reenvio_em_s: 60 })
})
