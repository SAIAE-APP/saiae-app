// Consulta CNPJ (BrasilAPI) ou CEP (ViaCEP) para o assistente de configuração inicial.
// O NAVEGADOR nunca chama terceiros: passa por aqui (nenhuma chave exposta; o CNPJ/CEP consultado não vai para
// log nem para o banco). Exige login (JWT do usuário), limite por usuário/hora e timeout curto. Falha ou lentidão
// do terceiro devolve "indisponivel": o assistente sempre deixa preencher à mão.
//   supabase functions deploy consultar-externo --project-ref <ref>   (COM verificação de JWT)
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cepValido, cnpjValido, normalizarBrasilApi, normalizarViaCep, soDigitos } from '../_shared/consultaExterna.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const LIMITE_POR_HORA = 30
const TIMEOUT_MS = 6000

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

async function buscar(url: string): Promise<{ status: number; corpo: unknown } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', headers: { Accept: 'application/json' } })
    const corpo = await r.json().catch(() => null)
    return { status: r.status, corpo }
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, motivo: 'metodo' }, 405)

  let body: { tipo?: string; valor?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, motivo: 'invalido' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: usuario, error: erroUser } = await admin.auth.getUser(jwt)
  if (erroUser || !usuario?.user) return json({ ok: false, motivo: 'nao_autenticado' }, 401)

  const tipo = body.tipo === 'cnpj' || body.tipo === 'cep' ? body.tipo : null
  const digitos = soDigitos(body.valor)
  if (!tipo || (tipo === 'cnpj' ? !cnpjValido(digitos) : !cepValido(digitos))) return json({ ok: false, motivo: 'invalido' }, 422)

  const { data: cabe, error: erroLimite } = await admin.rpc('consulta_externa_registrar', {
    p_usuario_id: usuario.user.id,
    p_tipo: tipo,
    p_limite: LIMITE_POR_HORA,
  })
  if (erroLimite) return json({ ok: false, motivo: 'indisponivel' })
  if (cabe !== true) return json({ ok: false, motivo: 'limite' }, 429)

  if (tipo === 'cnpj') {
    const r = await buscar(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`)
    if (!r || r.status >= 500 || r.status === 429) return json({ ok: false, motivo: 'indisponivel' })
    if (r.status === 404) return json({ ok: false, motivo: 'nao_encontrado' })
    const dados = normalizarBrasilApi(r.corpo)
    return dados ? json({ ok: true, tipo, dados }) : json({ ok: false, motivo: 'indisponivel' })
  }

  const r = await buscar(`https://viacep.com.br/ws/${digitos}/json/`)
  if (!r || r.status >= 500 || r.status === 429) return json({ ok: false, motivo: 'indisponivel' })
  const dados = normalizarViaCep(r.corpo)
  return dados ? json({ ok: true, tipo, dados }) : json({ ok: false, motivo: 'nao_encontrado' })
})
