// Função consultar-externo (CNPJ/CEP) CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/consultarExterno.staging.mjs
// Precisa da migration 20261020110000 e da função publicada (COM verificação de JWT). Faz 2 consultas reais a
// serviços públicos (BrasilAPI e ViaCEP); o teste do limite é feito direto na RPC, sem insistir nos terceiros.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const REF = 'qzcqwovbbylqxljcrqhk'
const url = process.env.STAGING_SUPABASE_URL ?? ''
const chave = process.env.STAGING_CHAVE_SERVICO ?? ''
const anon = process.env.STAGING_ANON_KEY ?? ''
if (!url.includes(REF) || !chave || !anon) {
  console.error(`Abortado: defina STAGING_SUPABASE_URL (com ${REF}), STAGING_CHAVE_SERVICO e STAGING_ANON_KEY.`)
  process.exit(2)
}
const admin = createClient(url, chave, { auth: { persistSession: false } })

let falhas = 0
let total = 0
const confere = (nome, ok, detalhe = '') => {
  total++
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${nome}${ok ? '' : ` -> ${detalhe}`}`)
}
let usuarioId = null

async function chamar(token, corpo) {
  const r = await fetch(`${url}/functions/v1/consultar-externo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  })
  return { status: r.status, corpo: await r.json().catch(() => ({})) }
}

try {
  const email = `ext-${randomUUID().slice(0, 8)}@staging.saiae.invalid`
  const senha = `Tt1!${randomUUID().slice(0, 12)}`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw new Error(error.message)
  usuarioId = u.user.id
  const cli = createClient(url, anon, { auth: { persistSession: false } })
  const { data: sess, error: e2 } = await cli.auth.signInWithPassword({ email, password: senha })
  if (e2) throw new Error(e2.message)
  const jwt = sess.session.access_token

  confere('sem login => 401', (await chamar(anon, { tipo: 'cnpj', valor: '00000000000191' })).status === 401)
  confere('CNPJ inválido => 422 (sem gastar consulta)', (await chamar(jwt, { tipo: 'cnpj', valor: '11222333000182' })).status === 422)
  confere('CEP inválido => 422', (await chamar(jwt, { tipo: 'cep', valor: '123' })).status === 422)
  confere('tipo desconhecido => 422', (await chamar(jwt, { tipo: 'cpf', valor: '12345678909' })).status === 422)

  const c = await chamar(jwt, { tipo: 'cnpj', valor: '00.000.000/0001-91' }) // Banco do Brasil (público)
  confere('CNPJ real (BrasilAPI) => razão social e endereço', c.corpo.ok === true && /BANCO DO BRASIL/i.test(c.corpo.dados?.razao_social ?? ''), JSON.stringify(c.corpo).slice(0, 200))
  confere('resposta traz só o necessário (sem sócios/capital/telefone)', c.corpo.dados && !('qsa' in c.corpo.dados) && !('capital_social' in c.corpo.dados))

  const p = await chamar(jwt, { tipo: 'cep', valor: '70040-010' })
  confere('CEP real (ViaCEP) => cidade e UF', p.corpo.ok === true && p.corpo.dados?.uf === 'DF', JSON.stringify(p.corpo).slice(0, 200))

  // Limite: 30/h por usuário e tipo, direto na RPC (não insiste nos serviços públicos)
  const outro = randomUUID()
  const { data: o } = await admin.auth.admin.createUser({ email: `lim-${outro.slice(0, 8)}@staging.saiae.invalid`, password: senha, email_confirm: true })
  let ultimo = true
  for (let i = 0; i < 30; i++) ultimo = ultimo && (await admin.rpc('consulta_externa_registrar', { p_usuario_id: o.user.id, p_tipo: 'cep', p_limite: 30 })).data === true
  confere('30 consultas cabem', ultimo === true)
  confere('a 31ª é barrada', (await admin.rpc('consulta_externa_registrar', { p_usuario_id: o.user.id, p_tipo: 'cep', p_limite: 30 })).data === false)
  confere('o limite é por tipo (cnpj ainda livre)', (await admin.rpc('consulta_externa_registrar', { p_usuario_id: o.user.id, p_tipo: 'cnpj', p_limite: 30 })).data === true)
  const { count } = await admin.from('consultas_externas_log').select('id', { count: 'exact', head: true }).eq('usuario_id', o.user.id)
  confere('a tentativa barrada não é gravada (31 linhas)', count === 31, String(count))
  const anonDb = createClient(url, anon, { auth: { persistSession: false } })
  const anonRpc = await anonDb.rpc('consulta_externa_registrar', { p_usuario_id: o.user.id, p_tipo: 'cep', p_limite: 1 })
  confere('anon não executa a RPC de limite', !!anonRpc.error)
  await admin.auth.admin.deleteUser(o.user.id)
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  if (usuarioId) await admin.auth.admin.deleteUser(usuarioId)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
