// Exclusão de conta self-service (Ajustes > Excluir minha conta). Irreversível.
// O usuário vem do JWT, nunca do body. Ordem: dados (RPC excluir_dados_conta,
// só service role) → arquivos no Storage → login em auth.users. Se falhar no
// meio, dá pra tentar de novo: cada etapa é idempotente.
//
// Deploy fica com o dono do produto (`supabase functions deploy excluir-conta`);
// a migration 20260928170000_excluir_dados_conta.sql precisa estar aplicada antes.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { drenarFilaApagarIa } from '../_shared/iaApagarSupabase.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKETS = ['cardapio-fotos', 'logo-barraca']

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  let confirmacao: string | undefined
  try {
    confirmacao = (await req.json())?.confirmacao
  } catch {
    return jsonResponse({ erro: 'JSON inválido' }, 400)
  }
  if (confirmacao !== 'EXCLUIR') {
    return jsonResponse({ erro: 'Confirmação ausente' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: userData, error: erroUser } = await admin.auth.getUser(jwt)
  if (erroUser || !userData?.user) return jsonResponse({ erro: 'Não autenticado' }, 401)
  const usuarioId = userData.user.id

  const { data: barracasApagadas, error: erroDados } = await admin.rpc('excluir_dados_conta', {
    p_usuario_id: usuarioId,
  })
  if (erroDados) {
    console.error('[excluir-conta] dados', erroDados)
    return jsonResponse({ erro: 'Não foi possível apagar os dados. Tente de novo.' }, 500)
  }

  // Storage: falha aqui não bloqueia a exclusão do login (arquivo órfão é
  // melhor que conta que não sai), só fica logada.
  for (const barracaId of (barracasApagadas ?? []) as string[]) {
    for (const bucket of BUCKETS) {
      try {
        const { data: arquivos } = await admin.storage.from(bucket).list(barracaId, { limit: 1000 })
        const caminhos = (arquivos ?? []).map((a) => `${barracaId}/${a.name}`)
        if (caminhos.length > 0) await admin.storage.from(bucket).remove(caminhos)
      } catch (e) {
        console.error('[excluir-conta] storage', bucket, barracaId, e)
      }
    }
  }

  // Conversas da IA no CRM: os pedidos já estão na fila (mesma transação dos dados). Falha do CRM não bloqueia a
  // exclusão da conta; o job periódico reenvia.
  await drenarFilaApagarIa(admin).catch(() => undefined)

  const { error: erroAuth } = await admin.auth.admin.deleteUser(usuarioId)
  if (erroAuth) {
    console.error('[excluir-conta] auth', erroAuth)
    return jsonResponse({ erro: 'Dados apagados, mas não foi possível remover o login. Tente de novo.' }, 500)
  }

  return jsonResponse({ ok: true })
})
