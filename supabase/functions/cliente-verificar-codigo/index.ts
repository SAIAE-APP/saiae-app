// Confere o código, cria/atualiza o perfil e abre a sessão. Endpoint PÚBLICO.
//   supabase functions deploy cliente-verificar-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  MAX_TENTATIVAS,
  VALIDADE_SESSAO_MS,
  avaliarCodigo,
  gerarTokenSessao,
  hashSegredo,
  limparCodigo,
} from '../_shared/clienteCodigo.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const INVALIDO = 'Código inválido ou expirado. Peça um novo.'

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405)

  let body: { barraca_slug?: string; telefone?: string; codigo?: string; nome?: string; aceita_promocoes?: boolean; aparelho?: string }
  try {
    body = await req.json()
  } catch {
    return json({ erro: 'JSON inválido' }, 400)
  }

  const slug = String(body.barraca_slug ?? '').trim().toLowerCase().slice(0, 80)
  const nome = String(body.nome ?? '').trim().slice(0, 80)
  const codigo = limparCodigo(body.codigo)
  if (!slug || nome.length < 2 || !telefoneValido(String(body.telefone ?? ''))) return json({ erro: INVALIDO }, 400)
  if (!codigo) return json({ erro: 'Digite os 6 números do código.' }, 400)
  const telefone = normalizarTelefone(String(body.telefone))

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  if (!pimenta) return json({ erro: 'Tente de novo em instantes.' }, 503)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: barraca } = await supabase.from('barracas').select('id').eq('slug', slug).maybeSingle()
  if (!barraca) return json({ erro: INVALIDO }, 400)

  const { data: reg } = await supabase
    .from('cliente_codigos')
    .select('id, codigo_hash, usado_em, tentativas, expira_em')
    .eq('barraca_id', barraca.id)
    .eq('telefone', telefone)
    .is('usado_em', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!reg) return json({ erro: INVALIDO }, 400)

  const hashInformado = await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo)
  const decisao = avaliarCodigo(reg, hashInformado, Date.now())

  if (decisao === 'incorreto') {
    await supabase.from('cliente_codigos').update({ tentativas: reg.tentativas + 1 }).eq('id', reg.id)
    const restantes = Math.max(0, MAX_TENTATIVAS - (reg.tentativas + 1))
    return json({ erro: restantes > 0 ? 'Código incorreto.' : INVALIDO, tentativas_restantes: restantes }, 400)
  }
  if (decisao !== 'ok') {
    if (decisao === 'excedido') await supabase.from('cliente_codigos').update({ usado_em: new Date().toISOString() }).eq('id', reg.id)
    return json({ erro: INVALIDO }, 400)
  }

  // Uso único mesmo com dois cliques simultâneos: só quem marcar `usado_em` primeiro segue.
  const { data: consumido } = await supabase
    .from('cliente_codigos')
    .update({ usado_em: new Date().toISOString() })
    .eq('id', reg.id)
    .is('usado_em', null)
    .select('id')
    .maybeSingle()
  if (!consumido) return json({ erro: INVALIDO }, 400)

  const { data: clienteId, error: erroPerfil } = await supabase.rpc('cliente_registrar_verificado', {
    p_barraca_id: barraca.id,
    p_telefone: telefone,
    p_nome: nome,
    p_aceita_promocoes: body.aceita_promocoes === true,
  })
  if (erroPerfil || !clienteId) {
    console.error('cliente-verificar-codigo: falha ao registrar perfil', erroPerfil?.message)
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500)
  }

  const token = gerarTokenSessao()
  const expiraEm = new Date(Date.now() + VALIDADE_SESSAO_MS).toISOString()
  const { error: erroSessao } = await supabase.from('cliente_sessoes').insert({
    cliente_id: clienteId,
    barraca_id: barraca.id,
    token_hash: await hashSegredo(pimenta, 'sessao', token),
    aparelho: String(body.aparelho ?? '').slice(0, 80) || null,
    expira_em: expiraEm,
  })
  if (erroSessao) {
    console.error('cliente-verificar-codigo: falha ao criar sessão')
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500)
  }
  return json({ token, expira_em: expiraEm, cliente: { id: clienteId, nome, telefone } })
})
