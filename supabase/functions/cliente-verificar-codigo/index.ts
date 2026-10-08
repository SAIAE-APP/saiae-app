// Confere o código, cria/atualiza o perfil e abre a sessão. Endpoint PÚBLICO.
//   supabase functions deploy cliente-verificar-codigo --no-verify-jwt --project-ref <ref>
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  MAX_TENTATIVAS,
  MENSAGEM_CODIGO_INVALIDO,
  VALIDADE_SESSAO_MS,
  avaliarCodigo,
  decidirLimiteVerificar,
  gerarTokenSessao,
  hashSegredo,
  limparCodigo,
} from '../_shared/clienteCodigo.ts'
import { hashIp, ipDoCliente } from '../_shared/antiabuso.ts'
import { normalizarTelefone, telefoneValido } from '../_shared/telefone.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
// Uma só mensagem para código errado, expirado, usado ou inexistente (não revela qual).
const invalido = (restantes = 0) => ({ erro: MENSAGEM_CODIGO_INVALIDO, tentativas_restantes: restantes })

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
  if (!slug || nome.length < 2 || !telefoneValido(String(body.telefone ?? ''))) return json(invalido(), 400)
  if (!codigo) return json({ erro: 'Digite os 6 números do código.' }, 400)
  const telefone = normalizarTelefone(String(body.telefone))

  const pimenta = Deno.env.get('CLIENTE_HASH_PEPPER') ?? ''
  if (!pimenta) return json({ erro: 'Tente de novo em instantes.' }, 503)
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const { data: barraca } = await supabase.from('barracas').select('id').eq('slug', slug).maybeSingle()
  if (!barraca) return json(invalido(), 400)

  // Limite próprio da verificação (por telefone+loja e por IP). Não usa o limite de PEDIR código: o dono
  // do telefone sempre pode usar o código que já recebeu.
  const umaHora = new Date(Date.now() - 3600_000).toISOString()
  const ipHash = await hashIp('cliente-verificar', ipDoCliente(req), barraca.id)
  const [{ count: porTelefone }, { count: porIp }] = await Promise.all([
    supabase.from('cliente_verificacoes_log').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id).eq('telefone', telefone).gte('criado_em', umaHora),
    supabase.from('cliente_verificacoes_log').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('criado_em', umaHora),
  ])
  if (decidirLimiteVerificar({ verificacoesTelefoneHora: porTelefone ?? 0, verificacoesIpHora: porIp ?? 0 }) === 'limite') {
    return json({ erro: 'Muitas tentativas. Tente de novo em alguns minutos.' }, 429)
  }
  await supabase.from('cliente_verificacoes_log').insert({ barraca_id: barraca.id, telefone, ip_hash: ipHash })

  const { data: ultimo } = await supabase
    .from('cliente_codigos')
    .select('id')
    .eq('barraca_id', barraca.id)
    .eq('telefone', telefone)
    .is('usado_em', null)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ultimo) return json(invalido(), 400)

  // Conta a tentativa ANTES de comparar, de forma atômica no banco: rajada paralela não burla o limite.
  const { data: tentativa } = await supabase.rpc('cliente_tentar_codigo', { p_id: ultimo.id })
  const reg = (Array.isArray(tentativa) ? tentativa[0] : tentativa) as
    | { tentativas: number; codigo_hash: string; expira_em: string }
    | undefined
  if (!reg) return json(invalido(), 400)

  const hashInformado = await hashSegredo(pimenta, `codigo:${barraca.id}:${telefone}`, codigo)
  // `tentativas - 1`: a tentativa atual já foi contada pelo banco e não deve se auto-excluir.
  const decisao = avaliarCodigo(
    { codigo_hash: reg.codigo_hash, usado_em: null, tentativas: reg.tentativas - 1, expira_em: reg.expira_em },
    hashInformado,
    Date.now(),
  )
  if (decisao !== 'ok') return json(invalido(Math.max(0, MAX_TENTATIVAS - reg.tentativas)), 400)

  // Uso único mesmo com dois cliques simultâneos: só quem marcar `usado_em` primeiro segue.
  const { data: consumido } = await supabase
    .from('cliente_codigos')
    .update({ usado_em: new Date().toISOString() })
    .eq('id', ultimo.id)
    .is('usado_em', null)
    .select('id')
    .maybeSingle()
  if (!consumido) return json(invalido(), 400)

  const { data: clienteId, error: erroPerfil } = await supabase.rpc('cliente_registrar_verificado', {
    p_barraca_id: barraca.id,
    p_telefone: telefone,
    p_nome: nome,
    // null = não mexe no consentimento de promoções (só muda quando o corpo traz um boolean).
    p_aceita_promocoes: typeof body.aceita_promocoes === 'boolean' ? body.aceita_promocoes : null,
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
