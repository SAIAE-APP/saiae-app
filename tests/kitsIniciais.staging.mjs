// Kits iniciais (banco) CONTRA O STAGING (não roda no `npm test`).
//   STAGING_SUPABASE_URL=https://qzcqwovbbylqxljcrqhk.supabase.co STAGING_CHAVE_SERVICO=... \
//   STAGING_ANON_KEY=... node tests/kitsIniciais.staging.mjs
// Cria usuários fictícios (e-mail .invalid) e barracas, chama as RPCs COMO esses usuários (JWT real) e apaga tudo
// no fim. Aborta fora do staging. Pré-requisito: migration 20261021110000 aplicada.
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
  const email = `kit-${rotulo}-${randomUUID().slice(0, 8)}@staging.saiae.invalid`
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
async function novaBarraca(u, rotulo) {
  const r = await chamar(u.db, 'criar_barraca', { p_nome: `Kit ${rotulo}`, p_slug: slugNovo('kit') })
  if (r.erro) throw new Error(`criar_barraca: ${r.erro}`)
  criados.barracas.push(r.data.id)
  return r.data
}
const contagens = async (barracaId) => {
  const n = async (tabela) => (await admin.from(tabela).select('id', { count: 'exact', head: true }).eq('barraca_id', barracaId)).count
  return { categorias: await n('categorias'), itens: await n('itens'), grupos: await n('grupos_opcoes'), opcoes: await n('opcoes') }
}

// Conteúdo no formato que o app envia (espelha a hamburgueria da spec, em pequeno).
const KIT = () => ({
  categorias: [
    { chave: 'burgers', nome: 'Hambúrgueres' },
    { chave: 'bebidas', nome: 'Bebidas' },
  ],
  grupos: [
    { chave: 'carnes', nome: 'Carnes', tipo: 'variacao', opcoes: [{ nome: 'Simples', precisaPreco: true }, { nome: 'Duplo', precisaPreco: true }] },
    { chave: 'ponto', nome: 'Ponto da carne', tipo: 'adicional', obrigatorio: true, maximo: 1, opcoes: [{ nome: 'Ao ponto' }, { nome: 'Bem passado' }] },
    { chave: 'extras', nome: 'Adicionais', tipo: 'adicional', obrigatorio: false, opcoes: [{ nome: 'Bacon', precisaPreco: true }, { nome: 'Ovo', precisaPreco: true }] },
  ],
  itens: [
    { nome: 'Burger clássico', categoria: 'burgers', grupos: ['carnes', 'ponto', 'extras'] },
    { nome: 'Refrigerante', categoria: 'bebidas', grupos: [] },
  ],
  opcoes_habilitado: true,
})
const KIT_SEM_GRUPOS = () => ({
  categorias: [{ chave: 'sal', nome: 'Salgados' }],
  grupos: [],
  itens: [{ nome: 'Pastel de carne', categoria: 'sal', grupos: [] }],
  opcoes_habilitado: false,
})

try {
  const A = await novoUsuario('a')
  const B = await novoUsuario('b')

  // 1) Escolha do kit no passo 2 (usuário) e retrocompatibilidade da chamada antiga de 3 argumentos
  const antiga = await chamar(A.db, 'onboarding_salvar_origem', { p_origem: 'instagram', p_detalhe: '', p_categoria: 'lanches' })
  confere('chamada de 3 argumentos (antiga) continua valendo', !antiga.erro, antiga.erro)
  const comKit = await chamar(A.db, 'onboarding_salvar_origem', { p_origem: '', p_detalhe: '', p_categoria: '', p_kit: 'hamburgueria' })
  confere('p_kit grava sem apagar origem e categoria', !comKit.erro, comKit.erro)
  const { data: perfil } = await A.db.from('perfis_usuario').select('origem_aquisicao, categoria_negocio, kit_inicial').single()
  confere('perfil guarda origem, categoria e kit', perfil?.origem_aquisicao === 'instagram' && perfil?.categoria_negocio === 'lanches' && perfil?.kit_inicial === 'hamburgueria', JSON.stringify(perfil))
  confere('kit fora da lista é recusado pelo banco', !!(await chamar(A.db, 'onboarding_salvar_origem', { p_origem: '', p_detalhe: '', p_categoria: '', p_kit: 'foguete' })).erro)
  const semKit = await chamar(A.db, 'onboarding_salvar_origem', { p_origem: '', p_detalhe: '', p_categoria: 'pizza' })
  const { data: perfil2 } = await A.db.from('perfis_usuario').select('kit_inicial').single()
  confere('chamar sem p_kit não apaga o kit escolhido', !semKit.erro && perfil2?.kit_inicial === 'hamburgueria')

  // 2) Barraca nova nasce elegível; oferta ligada; nada criado ainda
  const barraca = await novaBarraca(A, 'A')
  const { data: bx } = await admin.from('barracas').select('kit_elegivel, kit_aplicado, kit_aplicado_em, opcoes_habilitado').eq('id', barraca.id).single()
  confere('barraca nova nasce elegível, sem kit e com Opções desligadas', bx.kit_elegivel === true && bx.kit_aplicado === null && bx.kit_aplicado_em === null && bx.opcoes_habilitado === false, JSON.stringify(bx))
  const prog0 = (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: barraca.id })).data
  confere('progresso: oferta de kit ligada, 0 preços pendentes', prog0.kit_oferta === true && prog0.kit_precos_pendentes === 0, JSON.stringify(prog0))

  // 3) Quem não é o dono não aplica
  const intruso = await chamar(B.db, 'onboarding_aplicar_kit', { p_barraca_id: barraca.id, p_kit: 'hamburgueria', p_conteudo: KIT() })
  confere('outro usuário NÃO aplica na barraca alheia (sem_acesso)', intruso.data?.estado === 'sem_acesso', JSON.stringify(intruso))
  const anonimo = await createClient(url, anon, { auth: { persistSession: false } }).rpc('onboarding_aplicar_kit', { p_barraca_id: barraca.id, p_kit: 'pf', p_conteudo: KIT() })
  confere('anônimo não executa a RPC', !!anonimo.error)
  confere('nada foi criado pelas tentativas recusadas', JSON.stringify(await contagens(barraca.id)) === JSON.stringify({ categorias: 0, itens: 0, grupos: 0, opcoes: 0 }))

  // 4) Validações: dados inválidos não gravam NADA (atomicidade)
  const ruins = {
    'kit desconhecido': ['nenhum', KIT()],
    'nome de 61 letras': ['hamburgueria', { ...KIT(), categorias: [{ chave: 'burgers', nome: 'x'.repeat(61) }, { chave: 'bebidas', nome: 'Bebidas' }] }],
    '9 categorias': ['hamburgueria', { ...KIT(), categorias: Array.from({ length: 9 }, (_, i) => ({ chave: `c${i}`, nome: `C${i}` })) }],
    'item sem categoria existente': ['hamburgueria', { ...KIT(), itens: [{ nome: 'X', categoria: 'nao_existe', grupos: [] }] }],
    'item com grupo inexistente': ['hamburgueria', { ...KIT(), itens: [{ nome: 'X', categoria: 'burgers', grupos: ['fantasma'] }] }],
    'duas variações no mesmo item': ['hamburgueria', { ...KIT(), grupos: [...KIT().grupos, { chave: 'tam', nome: 'Tamanho', tipo: 'variacao', opcoes: [{ nome: 'P', precisaPreco: true }] }], itens: [{ nome: 'X', categoria: 'burgers', grupos: ['carnes', 'tam'] }] }],
    'grupo sem opções': ['hamburgueria', { ...KIT(), grupos: [{ chave: 'g', nome: 'G', tipo: 'adicional', opcoes: [] }] }],
    'máximo 21': ['hamburgueria', { ...KIT(), grupos: [{ chave: 'g', nome: 'G', tipo: 'adicional', maximo: 21, opcoes: [{ nome: 'a' }] }] }],
    'chave duplicada': ['hamburgueria', { ...KIT(), categorias: [{ chave: 'a', nome: 'A' }, { chave: 'a', nome: 'B' }] }],
    'sem itens': ['hamburgueria', { ...KIT(), itens: [] }],
    '31 itens': ['hamburgueria', { ...KIT(), itens: Array.from({ length: 31 }, (_, i) => ({ nome: `I${i}`, categoria: 'burgers', grupos: [] })) }],
    'conteúdo que não é objeto': ['hamburgueria', []],
  }
  for (const [nome, [kit, conteudo]] of Object.entries(ruins)) {
    const r = await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: barraca.id, p_kit: kit, p_conteudo: conteudo })
    confere(`inválido (${nome}) => dados_invalidos`, r.data?.estado === 'dados_invalidos', JSON.stringify(r))
  }
  confere('depois de todos os inválidos NADA foi gravado', JSON.stringify(await contagens(barraca.id)) === JSON.stringify({ categorias: 0, itens: 0, grupos: 0, opcoes: 0 }))

  // 5) Aplicação válida
  const ok = await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: barraca.id, p_kit: 'hamburgueria', p_conteudo: KIT() })
  confere('dono aplica o kit (ok, 2 itens, 3 grupos, Opções ligadas)', ok.data?.estado === 'ok' && ok.data.itens === 2 && ok.data.grupos === 3 && ok.data.opcoes_habilitado === true, JSON.stringify(ok))
  const c1 = await contagens(barraca.id)
  confere('contagens: 2 categorias, 2 itens, 3 grupos, 6 opções', c1.categorias === 2 && c1.itens === 2 && c1.grupos === 3 && c1.opcoes === 6, JSON.stringify(c1))
  const { data: bk } = await admin.from('barracas').select('kit_aplicado, kit_aplicado_em, opcoes_habilitado').eq('id', barraca.id).single()
  confere('barraca marcada (kit_aplicado, data) e Opções ligadas', bk.kit_aplicado === 'hamburgueria' && !!bk.kit_aplicado_em && bk.opcoes_habilitado === true, JSON.stringify(bk))

  // 6) Nada vendável: itens inativos, preço 0, marcados; variação e opções "precisam de preço" inativas
  const { data: itens } = await admin.from('itens').select('id, nome, ativo, preco_centavos, kit_exemplo, categoria_id').eq('barraca_id', barraca.id).order('ordem')
  confere('todo item nasce inativo, com preço 0 e marcado kit_exemplo', itens.length === 2 && itens.every((i) => i.ativo === false && i.preco_centavos === 0 && i.kit_exemplo === true && i.categoria_id), JSON.stringify(itens))
  const { data: grupos } = await admin.from('grupos_opcoes').select('id, nome, tipo, min_escolhas, max_escolhas, ativo').eq('barraca_id', barraca.id).order('ordem')
  const g = Object.fromEntries(grupos.map((x) => [x.nome, x]))
  confere('variação nasce 1/1; obrigatório máx 1 = 1/1; opcional sem limite = 0/null', g.Carnes.min_escolhas === 1 && g.Carnes.max_escolhas === 1 && g['Ponto da carne'].min_escolhas === 1 && g['Ponto da carne'].max_escolhas === 1 && g.Adicionais.min_escolhas === 0 && g.Adicionais.max_escolhas === null, JSON.stringify(grupos))
  const { data: opcoes } = await admin.from('opcoes').select('nome, preco_centavos, ativo, grupo_id').eq('barraca_id', barraca.id)
  const porGrupo = (nome) => opcoes.filter((o) => o.grupo_id === g[nome].id)
  confere('opções de variação e as "precisa de preço" nascem inativas e com preço 0', porGrupo('Carnes').every((o) => !o.ativo && o.preco_centavos === 0) && porGrupo('Adicionais').every((o) => !o.ativo && o.preco_centavos === 0))
  confere('opções grátis por natureza (ponto da carne) nascem ativas', porGrupo('Ponto da carne').every((o) => o.ativo && o.preco_centavos === 0))
  const { data: lig } = await admin.from('itens_grupos').select('item_id, grupo_id').eq('barraca_id', barraca.id)
  confere('ligações: o burger tem 3 grupos e a bebida nenhum', lig.length === 3 && lig.every((l) => l.item_id === itens[0].id))

  // 7) Segurança de venda: o cardápio e o resolver recusam tudo
  const { data: pub } = await createClient(url, anon, { auth: { persistSession: false } }).rpc('cardapio_publico', { p_slug: barraca.slug })
  confere('cardápio público não devolve nenhum item do kit', !pub || pub.length === 0 || pub.every((l) => !l.item_id), JSON.stringify(pub)?.slice(0, 200))
  for (const it of itens) {
    const r = await admin.rpc('resolver_carrinho', { p_barraca_id: barraca.id, p_linhas: [{ item_id: it.id, quantidade: 1 }] })
    confere(`resolver_carrinho recusa "${it.nome}" recém-aplicado`, r.data?.ok === false, JSON.stringify(r.data ?? r.error?.message))
  }

  // 8) Progresso depois do kit
  const prog1 = (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: barraca.id })).data
  confere('progresso: sem oferta, 2 preços pendentes e "item" ainda falso', prog1.kit_oferta === false && prog1.kit_precos_pendentes === 2 && prog1.item === false, JSON.stringify(prog1))

  // 9) Dono completa um item pelo caminho normal: ativa, preço > 0 => deixa de ser pendente e passa a valer como item
  const { error: eAtiva } = await A.db.from('itens').update({ preco_centavos: 1800, ativo: true }).eq('id', itens[1].id)
  confere('dono edita e ativa um item do kit', !eAtiva, eAtiva?.message)
  const prog2 = (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: barraca.id })).data
  confere('progresso: 1 pendente e "item" verdadeiro', prog2.kit_precos_pendentes === 1 && prog2.item === true, JSON.stringify(prog2))
  const r2 = await admin.rpc('resolver_carrinho', { p_barraca_id: barraca.id, p_linhas: [{ item_id: itens[1].id, quantidade: 2 }] })
  confere('o item completo passa a ser pedível com o preço certo', r2.data?.ok === true && r2.data.total_centavos === 3600, JSON.stringify(r2.data))

  // 10) Idempotência e catálogo
  const outra = await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: barraca.id, p_kit: 'hamburgueria', p_conteudo: KIT() })
  confere('segunda chamada => ja_aplicado', outra.data?.estado === 'ja_aplicado', JSON.stringify(outra))
  const c2 = await contagens(barraca.id)
  confere('segunda chamada não duplicou nada', JSON.stringify(c1) === JSON.stringify(c2), JSON.stringify(c2))

  // 11) Catálogo não vazio: nada é sobrescrito nem misturado
  const bC = await novaBarraca(A, 'C')
  await admin.from('categorias').insert({ barraca_id: bC.id, nome: 'Minha categoria', ordem: 1 })
  const naoVazio = await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bC.id, p_kit: 'pf', p_conteudo: KIT_SEM_GRUPOS() })
  confere('barraca com 1 categoria => catalogo_nao_vazio', naoVazio.data?.estado === 'catalogo_nao_vazio', JSON.stringify(naoVazio))
  confere('e a categoria do dono segue intacta, sem itens novos', JSON.stringify(await contagens(bC.id)) === JSON.stringify({ categorias: 1, itens: 0, grupos: 0, opcoes: 0 }))
  const bD = await novaBarraca(A, 'D')
  await admin.from('itens').insert({ barraca_id: bD.id, nome: 'Item do dono', preco_centavos: 500, ativo: true, ordem: 1 })
  confere('barraca com 1 item => catalogo_nao_vazio', (await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bD.id, p_kit: 'pf', p_conteudo: KIT_SEM_GRUPOS() })).data?.estado === 'catalogo_nao_vazio')
  const progD = (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: bD.id })).data
  confere('e a oferta de kit some do progresso', progD.kit_oferta === false)

  // 12) Barraca antiga (não elegível) nunca recebe
  const bE = await novaBarraca(A, 'E')
  await admin.from('barracas').update({ kit_elegivel: false }).eq('id', bE.id)
  confere('barraca não elegível (simula antiga) => nao_elegivel', (await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bE.id, p_kit: 'pf', p_conteudo: KIT_SEM_GRUPOS() })).data?.estado === 'nao_elegivel')
  confere('e a oferta não aparece para ela', (await chamar(A.db, 'onboarding_progresso', { p_barraca_id: bE.id })).data.kit_oferta === false)
  const { data: antigas } = await admin.from('barracas').select('id').eq('kit_elegivel', true)
  const nossas = new Set(criados.barracas)
  confere('nenhuma barraca ANTERIOR à migration ficou elegível (backfill)', (antigas ?? []).every((x) => nossas.has(x.id)), `${(antigas ?? []).filter((x) => !nossas.has(x.id)).length} elegíveis fora do teste`)

  // 13) Kit sem grupos não liga Opções
  const bF = await novaBarraca(A, 'F')
  const f = await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bF.id, p_kit: 'feira', p_conteudo: KIT_SEM_GRUPOS() })
  const { data: bf } = await admin.from('barracas').select('opcoes_habilitado').eq('id', bF.id).single()
  confere('kit sem grupos aplica e NÃO liga Opções', f.data?.estado === 'ok' && f.data.opcoes_habilitado === false && bf.opcoes_habilitado === false, JSON.stringify([f, bf]))
  // Opções já ligadas pelo dono não são desligadas
  const bG = await novaBarraca(A, 'G')
  await admin.from('barracas').update({ opcoes_habilitado: true }).eq('id', bG.id)
  await chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bG.id, p_kit: 'feira', p_conteudo: KIT_SEM_GRUPOS() })
  confere('Opções já ligadas continuam ligadas', (await admin.from('barracas').select('opcoes_habilitado').eq('id', bG.id).single()).data.opcoes_habilitado === true)

  // 14) Corrida: duas chamadas ao mesmo tempo gravam uma vez
  const bH = await novaBarraca(A, 'H')
  const [r1, r3] = await Promise.all([
    chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bH.id, p_kit: 'hamburgueria', p_conteudo: KIT() }),
    chamar(A.db, 'onboarding_aplicar_kit', { p_barraca_id: bH.id, p_kit: 'hamburgueria', p_conteudo: KIT() }),
  ])
  const estados = [r1.data?.estado, r3.data?.estado].sort().join(',')
  confere('duas chamadas simultâneas: uma ok e uma ja_aplicado', estados === 'ja_aplicado,ok', estados)
  confere('e o catálogo tem uma cópia só', (await contagens(bH.id)).itens === 2)

  // 15) Funcionário não aplica
  const bI = await novaBarraca(A, 'I')
  await admin.from('usuarios_barracas').insert({ usuario_id: B.id, barraca_id: bI.id, papel: 'funcionario' })
  const func = await chamar(B.db, 'onboarding_aplicar_kit', { p_barraca_id: bI.id, p_kit: 'feira', p_conteudo: KIT_SEM_GRUPOS() })
  confere('funcionário da barraca não aplica (sem_acesso)', func.data?.estado === 'sem_acesso', JSON.stringify(func))

  // 16) Excluir a barraca leva o kit junto (cascata)
  await admin.from('barracas').delete().eq('id', barraca.id)
  const c3 = await contagens(barraca.id)
  confere('apagar a barraca apaga categorias, itens, grupos e opções do kit', c3.categorias === 0 && c3.itens === 0 && c3.grupos === 0 && c3.opcoes === 0, JSON.stringify(c3))
} catch (e) {
  falhas++
  console.error('ERRO NO TESTE:', e.message)
} finally {
  for (const id of criados.barracas) await admin.from('barracas').delete().eq('id', id)
  for (const id of criados.usuarios) await admin.auth.admin.deleteUser(id)
}
console.log(`\n${total - falhas}/${total} verificações ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
