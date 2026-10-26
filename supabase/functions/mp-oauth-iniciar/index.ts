// Inicia a conexão da barraca com o Mercado Pago (OAuth do marketplace). Exige o JWT do dono da barraca, grava um
// `state` de uso único (10 min) em mp_oauth_estados e devolve { url } para o app abrir.
// Secrets: MP_CLIENT_ID e MP_OAUTH_REDIRECT_URI (igual, inclusive a barra final, ao cadastrado no app do MP).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { montarUrlAutorizacao, VALIDADE_STATE_MINUTOS } from '../_shared/pagamento/oauthMercadoPago.ts'

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

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ erro: 'Não autenticado' }, 401)

  let barracaId: string
  try {
    const corpo = (await req.json()) as { barraca_id?: unknown }
    barracaId = typeof corpo.barraca_id === 'string' ? corpo.barraca_id : ''
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }
  if (!barracaId) return json({ erro: 'Loja inválida' }, 400)

  const clientId = Deno.env.get('MP_CLIENT_ID')
  const redirectUri = Deno.env.get('MP_OAUTH_REDIRECT_URI')
  if (!clientId || !redirectUri) {
    console.error('mp-oauth-iniciar: configuração do Mercado Pago ausente')
    return json({ erro: 'Conexão indisponível no momento.' }, 503)
  }

  const supabaseAuth = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '')
  const { data: sessao, error: erroSessao } = await supabaseAuth.auth.getUser(jwt)
  if (erroSessao || !sessao?.user) return json({ erro: 'Não autenticado' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  // A service role ignora RLS: a checagem de dono é explícita.
  const { data: acesso, error: erroAcesso } = await supabase
    .from('usuarios_barracas')
    .select('usuario_id')
    .eq('usuario_id', sessao.user.id)
    .eq('barraca_id', barracaId)
    .eq('papel', 'dono')
    .maybeSingle()
  if (erroAcesso) {
    console.error('mp-oauth-iniciar: falha ao conferir dono', erroAcesso.message)
    return json({ erro: 'Não foi possível iniciar agora.' }, 500)
  }
  if (!acesso) return json({ erro: 'Sem acesso a esta loja.' }, 403)

  const state = crypto.randomUUID()
  const { error: erroEstado } = await supabase.from('mp_oauth_estados').insert({
    state,
    barraca_id: barracaId,
    usuario_id: sessao.user.id,
    expira_em: new Date(Date.now() + VALIDADE_STATE_MINUTOS * 60_000).toISOString(),
  })
  if (erroEstado) {
    console.error('mp-oauth-iniciar: falha ao gravar state', erroEstado.message)
    return json({ erro: 'Não foi possível iniciar agora.' }, 500)
  }

  return json({ url: montarUrlAutorizacao({ clientId, redirectUri, state }) })
})
