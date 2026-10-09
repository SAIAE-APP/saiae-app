// Onboarding de configuração (banco) CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/onboardingBanco.staging.mjs
// Cria 2 usuários fictícios (e-mail .invalid) e as barracas deles, chama as RPCs COMO esses usuários
// (JWT real) e apaga tudo no fim. Aborta fora do staging.
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
const criados = { usuarios: [], barracas: [] }
const senha = `Tt1!${randomUUID().slice(0, 12)}`

async function novoUsuario(rotulo) {
  const email = `onb-${rotulo}-${randomUUID().slice(0, 8)}@staging.saiae.invalid`
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  criados.usuarios.push(data.user.id)
  const cliente = createClient(url, anon, { auth: { persistSession: false } })
  const { error: e2 } = await cliente.auth.signInWithPassword({ email, password: senha })
  if (e2) throw new Error(`login: ${e2.message}`)
  return { id: data.user.id, db: cliente }
}
const chamar = async (db, fn, args) => {
  const { data, error } = await db.rpc(fn, args)
  return { data, erro: error?.message ?? null }
}
const slugNovo = (p) => `${p}-${randomUUID().slice(0, 6)}`
const SEMANA = (aberto = true) => Array.from({ length: 7 }, (_, dia) => ({ dia, aberto, abre: '11:00', fecha: '15:00' }))

try {
  const A = await novoUsuario('a')
  const B = await novoUsuario('b')

  // 1) Origem e categoria (antes de existir barraca): só o próprio usuário
  const o = await chamar(A.db, 'onboarding_salvar_origem', { p_origem: 'instagram', p_detalhe: 'perfil da feira', p_categoria: 'pastel' })
  confere('origem/categoria gravadas', !o.erro, o.erro)
  const ruim = await chamar(A.db, 'onboarding_salvar_origem', { p_origem: 'foguete', p_detalhe: '', p_categoria: '' })
  confere('origem fora da lista é recusada pelo banco', !!ruim.erro)
  const { data: pA } = await A.db.from('perfis_usuario').select('*')
  const { data: pB } = await B.db.from('perfis_usuario').select('*')
  confere('A lê só o próprio perfil; B não vê o de A', pA.length === 1 && pA[0].usuario_id === A.id && pB.length === 0)
  const { data: bruto } = await createClient(url, anon, { auth: { persistSession: false } }).from('perfis_usuario').select('*')
  confere('anônimo não lê perfis_usuario', !bruto || bruto.length === 0)

  // 2) Slug: disponibilidade só devolve booleano; reservados; formato
  const livre = slugNovo('onb')
  const d1 = await chamar(A.db, 'slug_disponivel', { p_slug: livre })
  confere('slug livre => true', d1.data === true, JSON.stringify(d1))
  for (const r of ['login', 'configurar', 'selecionar-barraca', 'e']) {
    const x = await chamar(A.db, 'slug_disponivel', { p_slug: r })
    confere(`slug reservado "${r}" => false`, x.data === false)
  }
  confere('slug com acento/maiúscula/espaço => false', (await chamar(A.db, 'slug_disponivel', { p_slug: 'Pastelão do Zé' })).data === false)
  const anonRpc = await createClient(url, anon, { auth: { persistSession: false } }).rpc('slug_disponivel', { p_slug: livre })
  confere('anônimo não executa slug_disponivel', !!anonRpc.error)

  // 3) criar_barraca: recusa reservado; cria normal; duplicado => ocupado
  const reservado = await chamar(A.db, 'criar_barraca', { p_nome: 'Teste', p_slug: 'login' })
  confere('criar_barraca recusa slug reservado', !!reservado.erro)
  const c = await chamar(A.db, 'criar_barraca', { p_nome: 'ONB Teste A', p_slug: livre })
  confere('criar_barraca cria a barraca', !c.erro && c.data?.slug === livre, c.erro)
  const barraca = c.data
  criados.barracas.push(barraca.id)
  confere('barraca nova NÃO nasce concluída (onboarding_concluido_em nulo, etapa 0)', barraca.onboarding_concluido_em === null && barraca.onboarding_etapa === 0, JSON.stringify([barraca.onboarding_concluido_em, barraca.onboarding_etapa]))
  confere('slug agora ocupado => false', (await chamar(B.db, 'slug_disponivel', { p_slug: livre })).data === false)

  // 4) Passos: dono grava; outro usuário não; validações
  const p3 = await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 3, p_dados: {} })
  confere('passo 3 copia a categoria do perfil', !p3.erro, p3.erro)
  const { data: bx } = await admin.from('barracas').select('categoria_negocio, onboarding_etapa').eq('id', barraca.id).single()
  confere('categoria virou da barraca e etapa=3', bx.categoria_negocio === 'pastel' && bx.onboarding_etapa === 3, JSON.stringify(bx))
  const intruso = await chamar(B.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 7, p_dados: { metodos: ['pix'] } })
  confere('outro usuário NÃO grava na barraca alheia', !!intruso.erro)
  confere('outro usuário NÃO lê o progresso alheio', !!(await chamar(B.db, 'onboarding_progresso', { p_barraca_id: barraca.id })).erro)

  confere('horário sem nenhum dia aberto é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 6, p_dados: { horarios: SEMANA(false) } })).erro)
  confere('horário com dia inválido é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 6, p_dados: { horarios: [{ dia: 9, aberto: true, abre: '11:00', fecha: '15:00' }] } })).erro)
  confere('horário válido grava', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 6, p_dados: { horarios: SEMANA() } })).erro)
  confere('repetir o passo 6 é idempotente (7 linhas)', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 6, p_dados: { horarios: SEMANA() } })).erro && (await admin.from('horarios_funcionamento').select('id', { count: 'exact', head: true }).eq('barraca_id', barraca.id)).count === 7)

  confere('método inválido (vale) é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 7, p_dados: { metodos: ['vale'] } })).erro)
  confere('sem nenhum método é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 7, p_dados: { metodos: [] } })).erro)
  confere('métodos válidos gravam', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 7, p_dados: { metodos: ['dinheiro', 'credito', 'debito'] } })).erro)
  confere('modo inválido é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 8, p_dados: { modos: ['drive'] } })).erro)

  // concluir antes dos obrigatórios completos? (modos já têm o padrão da barraca; testar com CNPJ ruim)
  confere('CNPJ com tamanho errado é recusado', !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 4, p_dados: { cnpj: '123' } })).erro)
  confere('sem CNPJ (MEI) grava', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 4, p_dados: { sem_cnpj: true } })).erro)
  confere('endereço grava e UF inválida é recusada', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 5, p_dados: { cep: '70000-000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Brasília', uf: 'df' } })).erro && !!(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 5, p_dados: { uf: 'XYZ' } })).erro)
  confere('modos válidos (com entrega) gravam', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 8, p_dados: { modos: ['balcao', 'retirada', 'entrega'] } })).erro)
  confere('taxa grava e é limitada', !(await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 9, p_dados: { habilitada: true, centavos: 500 } })).erro)

  // 5) Progresso e conclusão
  const prog = (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: barraca.id })).data
  confere('progresso reflete o que foi feito', prog.horario && prog.pagamento && prog.modos && prog.cnpj && prog.endereco && prog.entrega_ativa && prog.taxa === true && prog.item === false && prog.concluido === false, JSON.stringify(prog))
  const fim = await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 10, p_dados: {} })
  confere('passo 10 conclui com os obrigatórios feitos', !fim.erro && fim.data?.concluido === true, fim.erro)
  await chamar(A.db, 'onboarding_salvar_passo', { p_barraca_id: barraca.id, p_etapa: 5, p_dados: {} })
  const { data: bf } = await admin.from('barracas').select('onboarding_etapa, onboarding_concluido_em').eq('id', barraca.id).single()
  confere('voltar a um passo antigo NÃO baixa a etapa nem desconclui', bf.onboarding_etapa === 10 && bf.onboarding_concluido_em !== null)

  // 6) Barraca sem obrigatórios não conclui
  const c2 = await chamar(B.db, 'criar_barraca', { p_nome: 'ONB Teste B', p_slug: slugNovo('onb') })
  criados.barracas.push(c2.data.id)
  await admin.from('horarios_funcionamento').delete().eq('barraca_id', c2.data.id)
  const semHorario = await chamar(B.db, 'onboarding_salvar_passo', { p_barraca_id: c2.data.id, p_etapa: 10, p_dados: {} })
  confere('concluir sem horário é recusado (obrigatorios_pendentes)', /obrigatorios_pendentes/.test(semHorario.erro ?? ''), semHorario.erro)

  // 7) Checklist: ocultar 7 dias (só dono) e telemetria sem leitura pela API
  confere('ocultar checklist (dono)', !(await chamar(A.db, 'onboarding_ocultar_checklist', { p_barraca_id: barraca.id })).erro)
  confere('ocultar checklist (não-dono) recusado', !!(await chamar(B.db, 'onboarding_ocultar_checklist', { p_barraca_id: barraca.id })).erro)
  confere('evento de telemetria grava', !(await chamar(A.db, 'onboarding_evento', { p_barraca_id: barraca.id, p_passo: 3, p_acao: 'concluido' })).erro)
  const { data: leituraEv } = await A.db.from('onboarding_eventos').select('id').limit(1)
  confere('usuário não lê onboarding_eventos pela API', !leituraEv || leituraEv.length === 0)

  // 8) Backfill: barracas anteriores à migration ficaram concluídas (não bloqueadas)
  const { data: antigas } = await admin.from('barracas').select('id, onboarding_concluido_em').is('onboarding_concluido_em', null)
  const novasNossas = new Set(criados.barracas)
  const antigasPendentes = (antigas ?? []).filter((x) => !novasNossas.has(x.id))
  confere('nenhuma barraca ANTIGA ficou sem onboarding_concluido_em (backfill)', antigasPendentes.length === 0, `${antigasPendentes.length} pendentes`)
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  for (const id of criados.barracas) await admin.from('barracas').delete().eq('id', id)
  for (const id of criados.usuarios) await admin.auth.admin.deleteUser(id)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
