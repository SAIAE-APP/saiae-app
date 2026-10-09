// Teste de comportamento da troca de endereço do cardápio (apelidos) CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... STAGING_ANON_KEY=... \
//     node tests/slugApelidos.staging.mjs
// As chaves vêm do ambiente (nunca do repositório). Aborta se a URL não for a do staging. Cria 2 usuários e 2 barracas
// FICTÍCIOS (prefixo teste-slug-), cada usuário com uma senha aleatória descartável gerada na hora e nunca exibida;
// apaga tudo no fim. Pré-requisitos: migrations 20261020100000 (onboarding) e 20261020120000 (slug) aplicadas e as
// functions cupom-validar/cliente-sessao publicadas com o resolvedor de apelido.
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const REF = 'qzcqwovbbylqxljcrqhk'
const url = process.env.STAGING_SUPABASE_URL ?? ''
const servico = process.env.STAGING_CHAVE_SERVICO ?? ''
const anon = process.env.STAGING_ANON_KEY ?? ''
if (!url.includes(REF) || !servico || !anon) {
  console.error(`Abortado: defina STAGING_SUPABASE_URL (com ${REF}), STAGING_CHAVE_SERVICO e STAGING_ANON_KEY.`)
  process.exit(2)
}
const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, servico, opcoes)
const publico = createClient(url, anon, opcoes)

let falhas = 0
let total = 0
function confere(nome, ok, detalhe = '') {
  total++
  if (!ok) falhas++
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${ok ? '' : ` -> ${detalhe}`}`)
}
const sufixo = randomUUID().slice(0, 8)
const slug = (nome) => `teste-slug-${nome}-${sufixo}`

const usuarios = []
const barracas = []

async function novoUsuario(rotulo) {
  const email = `teste-slug-${rotulo}-${sufixo}@example.com`
  const senha = randomBytes(18).toString('base64url') // descartável, nunca exibida
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  usuarios.push(data.user.id)
  const cliente = createClient(url, anon, opcoes)
  const { error: erroLogin } = await cliente.auth.signInWithPassword({ email, password: senha })
  if (erroLogin) throw new Error(`login do usuário de teste: ${erroLogin.message}`)
  return { id: data.user.id, db: cliente }
}

async function novaBarraca(dono, nome, slugInicial) {
  const { data, error } = await dono.db.rpc('criar_barraca', { p_nome: nome, p_slug: slugInicial })
  if (error) throw new Error(`criar_barraca: ${error.message}`)
  barracas.push(data.id)
  return data
}
const trocar = async (usuario, barracaId, novo) => {
  const { data, error } = await usuario.db.rpc('barraca_trocar_slug', { p_barraca_id: barracaId, p_novo: novo })
  return error ? { estado: `erro:${error.message}` } : data
}
const slugAtual = async (s) => (await publico.rpc('barraca_slug_atual', { p_slug: s })).data
const liberarTroca = (id) => admin.from('barracas').update({ slug_trocado_em: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }).eq('id', id)

try {
  const A = await novoUsuario('a')
  const B = await novoUsuario('b')
  const lojaA = await novaBarraca(A, 'Teste Slug A', slug('a'))
  const lojaB = await novaBarraca(B, 'Teste Slug B', slug('b'))
  const antigoA = lojaA.slug

  // 1) troca
  const novoA = slug('a-novo')
  let r = await trocar(A, lojaA.id, novoA)
  confere('dono troca o endereço', r.estado === 'ok' && r.slug === novoA, JSON.stringify(r))

  // 2) apelido redireciona (função pública, sem login)
  confere('endereço antigo resolve para o novo', (await slugAtual(antigoA)) === novoA)
  confere('endereço novo resolve para ele mesmo', (await slugAtual(novoA)) === novoA)
  confere('endereço que não existe devolve nulo', (await slugAtual(slug('nunca'))) === null)

  // 3) 2ª troca em menos de 24 h
  r = await trocar(A, lojaA.id, slug('a-outro'))
  confere('segunda troca em menos de 24 h é recusada', r.estado === 'muito_cedo', JSON.stringify(r))

  // 4) apelido e slug de OUTRA loja
  await liberarTroca(lojaA.id)
  r = await trocar(B, lojaB.id, antigoA)
  confere('apelido de outra loja é recusado (em uso)', r.estado === 'em_uso', JSON.stringify(r))
  r = await trocar(B, lojaB.id, novoA)
  confere('slug atual de outra loja é recusado (em uso)', r.estado === 'em_uso', JSON.stringify(r))
  const criar = await B.db.rpc('criar_barraca', { p_nome: 'Teste Slug C', p_slug: antigoA })
  confere('criar barraca com apelido de outra loja é recusado', Boolean(criar.error), 'a barraca foi criada')
  if (criar.data?.id) barracas.push(criar.data.id)

  // 5) quem não é dono, reservados, formato, direto na tabela
  r = await trocar(B, lojaA.id, slug('invasor'))
  confere('dono de outra loja não troca o endereço', r.estado === 'sem_acesso', JSON.stringify(r))
  r = await trocar(A, lojaA.id, 'login')
  confere('slug reservado é recusado', r.estado === 'reservado', JSON.stringify(r))
  r = await trocar(A, lojaA.id, 'Com Espaco')
  confere('formato inválido é recusado', r.estado === 'invalido', JSON.stringify(r))
  const direto = await A.db.from('barracas').update({ slug: slug('burlando') }).eq('id', lojaA.id)
  confere('trocar o slug direto na tabela é recusado', Boolean(direto.error) && /slug_use_a_tela/.test(direto.error.message), JSON.stringify(direto.error))
  const semLogin = await publico.rpc('barraca_trocar_slug', { p_barraca_id: lojaA.id, p_novo: slug('anon') })
  confere('sem login não troca', Boolean(semLogin.error), 'chamada anônima funcionou')

  // 6) voltar ao apelido próprio
  r = await trocar(A, lojaA.id, antigoA)
  confere('voltar ao endereço antigo da própria loja é permitido', r.estado === 'ok' && r.slug === antigoA, JSON.stringify(r))
  confere('o novo vira apelido do antigo', (await slugAtual(novoA)) === antigoA)

  // 7) function pública com o endereço ANTIGO (cupom-validar: antes dava 404 "Loja não encontrada")
  await liberarTroca(lojaA.id)
  await trocar(A, lojaA.id, novoA)
  const resp = await fetch(`${url}/functions/v1/cupom-validar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_slug: antigoA, codigo: 'NAOEXISTE', itens: [] }),
  })
  confere('cupom-validar aceita o endereço antigo (não responde 404)', resp.status !== 404, `status ${resp.status}`)
  const respInexistente = await fetch(`${url}/functions/v1/cupom-validar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ barraca_slug: slug('inexistente'), codigo: 'X', itens: [] }),
  })
  confere('cupom-validar com endereço inexistente continua 404', respInexistente.status === 404, `status ${respInexistente.status}`)
} catch (e) {
  falhas++
  console.error(`ERRO inesperado: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  for (const id of barracas) await admin.from('barracas').delete().eq('id', id)
  for (const id of usuarios) await admin.auth.admin.deleteUser(id)
}

console.log(`\n${total - falhas}/${total} verificações OK`)
process.exit(falhas ? 1 : 0)
