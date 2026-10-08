// SAI-010a etapa 4c: validações e apoio do cadastro de grupos de opções (src/lib/opcoesCadastro.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  avisosDoRascunho,
  diffLigacoes,
  duplicarRascunho,
  itensBloqueadosPorVariacao,
  itensIndisponiveis,
  limitesDoGrupo,
  MODELOS_DE_GRUPO,
  opcaoVazia,
  precoCentavosDaOpcao,
  rascunhoDoGrupo,
  rascunhoVazio,
  resumoDoGrupo,
  validarRascunho,
  type GrupoCadastro,
  type OpcaoCadastro,
  type RascunhoGrupo,
} from '../src/lib/opcoesCadastro.ts'

const op = (nome: string, precoTexto = '', extra: object = {}) => ({ ...opcaoVazia(), nome, precoTexto, ...extra })
const adicional = (over: Partial<RascunhoGrupo> = {}): RascunhoGrupo => ({
  ...rascunhoVazio('adicional'),
  nome: 'Extras',
  opcoes: [op('Ovo', '3,00')],
  ...over,
})
const variacao = (over: Partial<RascunhoGrupo> = {}): RascunhoGrupo => ({
  ...rascunhoVazio('variacao'),
  nome: 'Tamanho',
  opcoes: [op('Pequeno', '22,00'), op('Grande', '32,00')],
  ...over,
})

describe('limitesDoGrupo', () => {
  test('variação é sempre 1/1, não importa o que o formulário tenha', () => {
    assert.deepEqual(limitesDoGrupo({ tipo: 'variacao', obrigatorio: false, maximoTexto: '5' }), { min: 1, max: 1 })
  })

  test('adicional: obrigatório => min 1; limite vazio => sem limite', () => {
    assert.deepEqual(limitesDoGrupo({ tipo: 'adicional', obrigatorio: false, maximoTexto: '' }), { min: 0, max: null })
    assert.deepEqual(limitesDoGrupo({ tipo: 'adicional', obrigatorio: true, maximoTexto: ' 3 ' }), { min: 1, max: 3 })
  })
})

describe('validarRascunho', () => {
  test('grupos válidos não têm erro', () => {
    assert.deepEqual(validarRascunho(variacao()), [])
    assert.deepEqual(validarRascunho(adicional()), [])
    assert.deepEqual(validarRascunho(adicional({ maximoTexto: '20' })), [])
  })

  test('nome obrigatório e até 60 letras', () => {
    assert.match(validarRascunho(adicional({ nome: '  ' }))[0], /nome ao grupo/)
    assert.match(validarRascunho(adicional({ nome: 'x'.repeat(61) }))[0], /até 60/)
  })

  test('limite de escolhas: 1 a 20 ou vazio', () => {
    for (const ruim of ['0', '21', '-1', '2,5', 'abc']) {
      assert.match(validarRascunho(adicional({ maximoTexto: ruim }))[0], /1 a 20/, ruim)
    }
  })

  test('precisa de ao menos uma opção ATIVA', () => {
    assert.match(validarRascunho(adicional({ opcoes: [] }))[0], /pelo menos uma opção/)
    assert.match(validarRascunho(adicional({ opcoes: [op('Ovo', '1', { ativo: false })] }))[0], /pelo menos uma opção/)
  })

  test('opção sem nome, nome repetido (sem olhar caixa) e nome longo', () => {
    assert.ok(validarRascunho(adicional({ opcoes: [op('')] })).some((e) => /precisa de um nome/.test(e)))
    assert.ok(validarRascunho(adicional({ opcoes: [op('Ovo'), op(' ovo ')] })).some((e) => /duas vezes/.test(e)))
    assert.ok(validarRascunho(adicional({ opcoes: [op('x'.repeat(61))] })).some((e) => /passa de 60/.test(e)))
  })

  test('opção inativa repetida não conta como duplicata', () => {
    assert.deepEqual(validarRascunho(adicional({ opcoes: [op('Ovo', '1'), op('Ovo', '1', { ativo: false })] })), [])
  })

  test('variação exige preço > 0 em cada opção ativa; adicional aceita grátis (vazio ou 0)', () => {
    assert.ok(validarRascunho(variacao({ opcoes: [op('Pequeno', ''), op('Grande', '32')] })).some((e) => /Informe o preço de "Pequeno"/.test(e)))
    assert.ok(validarRascunho(variacao({ opcoes: [op('Pequeno', '0')] })).some((e) => /Informe o preço/.test(e)))
    assert.deepEqual(validarRascunho(variacao({ opcoes: [op('Pequeno', '10'), op('Antigo', '', { ativo: false })] })), [])
    assert.deepEqual(validarRascunho(adicional({ opcoes: [op('Molho', ''), op('Sal', '0')] })), [])
  })

  test('preço inválido ou acima do teto é recusado, não cortado', () => {
    for (const ruim of ['abc', '1,234', '1.2.3', '-5', '1000000,00']) {
      assert.ok(validarRascunho(adicional({ opcoes: [op('Ovo', ruim)] })).some((e) => /Preço inválido/.test(e)), ruim)
    }
    assert.deepEqual(validarRascunho(adicional({ opcoes: [op('Ovo', '999999,99')] })), [])
  })

  test('preço aceita vírgula ou ponto', () => {
    assert.equal(precoCentavosDaOpcao({ precoTexto: '3,5' }), 350)
    assert.equal(precoCentavosDaOpcao({ precoTexto: '3.50' }), 350)
    assert.equal(precoCentavosDaOpcao({ precoTexto: '' }), 0)
  })
})

describe('avisos', () => {
  test('grupo obrigatório sem opção disponível e com itens ligados avisa que os itens ficam indisponíveis', () => {
    const r = adicional({ obrigatorio: true, itemIds: ['i1'], opcoes: [op('Ovo', '1', { esgotado: true })] })
    assert.ok(avisosDoRascunho(r).some((a) => /ficam indisponíveis/.test(a)))
  })

  test('opcional esgotado não avisa isso; grupo sem itens avisa que ninguém usa', () => {
    const r = adicional({ obrigatorio: false, itemIds: ['i1'], opcoes: [op('Ovo', '1', { esgotado: true })] })
    assert.ok(!avisosDoRascunho(r).some((a) => /indisponíveis/.test(a)))
    assert.ok(avisosDoRascunho(adicional()).some((a) => /Nenhum item/.test(a)))
  })
})

describe('variação única por item', () => {
  const grupos = [
    { id: 'v1', tipo: 'variacao' as const },
    { id: 'v2', tipo: 'variacao' as const },
    { id: 'a1', tipo: 'adicional' as const },
  ]
  const ligacoes = [
    { item_id: 'i1', grupo_id: 'v1' },
    { item_id: 'i2', grupo_id: 'a1' },
    { item_id: 'i3', grupo_id: 'v2' },
  ]

  test('bloqueia itens que já têm OUTRA variação; o próprio grupo não bloqueia seus itens', () => {
    assert.deepEqual([...itensBloqueadosPorVariacao('v1', grupos, ligacoes)].sort(), ['i3'])
    assert.deepEqual([...itensBloqueadosPorVariacao('v2', grupos, ligacoes)].sort(), ['i1'])
  })

  test('grupo novo (sem id) bloqueia todo item que já tem variação; adicional não bloqueia ninguém', () => {
    assert.deepEqual([...itensBloqueadosPorVariacao(null, grupos, ligacoes)].sort(), ['i1', 'i3'])
  })
})

test('diffLigacoes separa o que inserir e o que remover', () => {
  assert.deepEqual(diffLigacoes(['a', 'b'], ['b', 'c']), { inserir: ['c'], remover: ['a'] })
  assert.deepEqual(diffLigacoes([], []), { inserir: [], remover: [] })
  assert.deepEqual(diffLigacoes(['a'], ['a']), { inserir: [], remover: [] })
})

describe('itensIndisponiveis', () => {
  const g = (id: string, over: Partial<GrupoCadastro> = {}): GrupoCadastro => ({ id, nome: id, tipo: 'adicional', min_escolhas: 1, max_escolhas: 1, ordem: 0, ativo: true, ...over })
  const o = (grupo_id: string, over: Partial<OpcaoCadastro> = {}): OpcaoCadastro => ({ id: grupo_id + Math.random(), grupo_id, nome: 'x', preco_centavos: 0, ordem: 0, ativo: true, esgotado: false, ...over })

  test('grupo obrigatório ativo sem opção disponível derruba os itens ligados', () => {
    const r = itensIndisponiveis([g('G')], [o('G', { esgotado: true }), o('G', { ativo: false })], [{ item_id: 'i1', grupo_id: 'G', ordem: 0 }])
    assert.deepEqual([...r], [['i1', 'G']])
  })

  test('com opção disponível, grupo opcional ou grupo inativo: ninguém cai', () => {
    const lig = [{ item_id: 'i1', grupo_id: 'G', ordem: 0 }]
    assert.equal(itensIndisponiveis([g('G')], [o('G')], lig).size, 0)
    assert.equal(itensIndisponiveis([g('G', { min_escolhas: 0 })], [], lig).size, 0)
    assert.equal(itensIndisponiveis([g('G', { ativo: false })], [], lig).size, 0)
  })
})

test('resumoDoGrupo', () => {
  assert.equal(resumoDoGrupo({ tipo: 'variacao', min_escolhas: 1, max_escolhas: 1 }), 'Variação · escolha 1')
  assert.equal(resumoDoGrupo({ tipo: 'adicional', min_escolhas: 0, max_escolhas: null }), 'Adicional · opcional')
  assert.equal(resumoDoGrupo({ tipo: 'adicional', min_escolhas: 1, max_escolhas: 3 }), 'Adicional · obrigatório · até 3')
})

describe('modelos prontos e duplicar', () => {
  test('modelos abrem preenchidos, mas só validam depois de o dono informar os preços da variação', () => {
    const tam = MODELOS_DE_GRUPO.find((m) => m.id === 'tamanho')!.criar()
    assert.equal(tam.tipo, 'variacao')
    assert.deepEqual(tam.opcoes.map((x) => x.nome), ['Pequeno', 'Médio', 'Grande'])
    assert.ok(validarRascunho(tam).length > 0)
    tam.opcoes.forEach((x, i) => (x.precoTexto = String(20 + i)))
    assert.deepEqual(validarRascunho(tam), [])
  })

  test('modelo de adicionais já é válido (extras grátis até o dono precificar)', () => {
    const ad = MODELOS_DE_GRUPO.find((m) => m.id === 'adicionais')!.criar()
    assert.equal(ad.tipo, 'adicional')
    assert.deepEqual(validarRascunho(ad), [])
  })

  test('duplicar zera ids e itens e marca o nome como cópia (respeitando 60 letras)', () => {
    const r = variacao({ itemIds: ['i1'], opcoes: [op('Pequeno', '22', { id: 'o1' })] })
    const c = duplicarRascunho(r)
    assert.equal(c.nome, 'Tamanho (cópia)')
    assert.deepEqual(c.itemIds, [])
    assert.deepEqual(c.opcoes.map((x) => x.id), [null])
    assert.equal(duplicarRascunho(variacao({ nome: 'x'.repeat(60) })).nome.length, 60)
    assert.equal(r.opcoes[0].id, 'o1') // original intacto
  })
})

describe('rascunhoDoGrupo', () => {
  const grupo: GrupoCadastro = { id: 'g', nome: 'Extras', tipo: 'adicional', min_escolhas: 1, max_escolhas: 3, ordem: 0, ativo: true }
  const opcoes: OpcaoCadastro[] = [
    { id: 'o2', grupo_id: 'g', nome: 'Bacon', preco_centavos: 500, ordem: 1, ativo: true, esgotado: true },
    { id: 'o1', grupo_id: 'g', nome: 'Ovo', preco_centavos: 300, ordem: 0, ativo: true, esgotado: false },
    { id: 'x', grupo_id: 'outro', nome: 'Alheia', preco_centavos: 1, ordem: 0, ativo: true, esgotado: false },
  ]

  test('traz só as opções do grupo, na ordem, com o preço em texto brasileiro', () => {
    const r = rascunhoDoGrupo(grupo, opcoes, [{ item_id: 'i1', grupo_id: 'g' }, { item_id: 'i2', grupo_id: 'outro' }])
    assert.deepEqual(r.opcoes.map((o) => [o.id, o.nome, o.precoTexto, o.esgotado]), [['o1', 'Ovo', '3,00', false], ['o2', 'Bacon', '5,00', true]])
    assert.deepEqual(r.itemIds, ['i1'])
    assert.equal(r.obrigatorio, true)
    assert.equal(r.maximoTexto, '3')
  })

  test('o que sai do banco volta a validar e gera os mesmos limites', () => {
    const r = rascunhoDoGrupo(grupo, opcoes, [])
    assert.deepEqual(validarRascunho(r), [])
    assert.deepEqual(limitesDoGrupo(r), { min: 1, max: 3 })
    const v = rascunhoDoGrupo({ ...grupo, tipo: 'variacao', max_escolhas: 1 }, opcoes, [])
    assert.equal(v.maximoTexto, '')
    assert.deepEqual(limitesDoGrupo(v), { min: 1, max: 1 })
  })
})
