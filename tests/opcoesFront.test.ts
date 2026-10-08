// SAI-010a etapa 4b: lógica pura de opções no cardápio público (src/lib/opcoes.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  agruparOpcoes,
  alternarOpcao,
  chaveDaLinha,
  itemPedivel,
  precoAPartirDe,
  precoUnitario,
  resumoEscolhas,
  temVariacao,
  validarEscolhas,
  type GrupoItem,
  type LinhaOpcaoPublica,
} from '../src/lib/opcoes.ts'

const ITEM = 'i1'
const row = (over: Partial<LinhaOpcaoPublica>): LinhaOpcaoPublica => ({
  item_id: ITEM,
  grupo_id: 'g-tam',
  grupo_nome: 'Tamanho',
  grupo_tipo: 'variacao',
  min_escolhas: 1,
  max_escolhas: 1,
  opcao_id: 'o-peq',
  opcao_nome: 'Pequeno',
  opcao_preco_centavos: 2200,
  opcao_esgotado: false,
  ...over,
})

const LINHAS: LinhaOpcaoPublica[] = [
  row({}),
  row({ opcao_id: 'o-gra', opcao_nome: 'Grande', opcao_preco_centavos: 3200 }),
  row({ grupo_id: 'g-ad', grupo_nome: 'Adicionais', grupo_tipo: 'adicional', min_escolhas: 0, max_escolhas: 2, opcao_id: 'o-ovo', opcao_nome: 'Ovo', opcao_preco_centavos: 300 }),
  row({ grupo_id: 'g-ad', grupo_nome: 'Adicionais', grupo_tipo: 'adicional', min_escolhas: 0, max_escolhas: 2, opcao_id: 'o-bac', opcao_nome: 'Bacon', opcao_preco_centavos: 500 }),
  row({ grupo_id: 'g-ad', grupo_nome: 'Adicionais', grupo_tipo: 'adicional', min_escolhas: 0, max_escolhas: 2, opcao_id: 'o-que', opcao_nome: 'Queijo', opcao_preco_centavos: 400, opcao_esgotado: true }),
]

const grupos = (): GrupoItem[] => agruparOpcoes(LINHAS).get(ITEM)!

describe('agruparOpcoes', () => {
  test('agrupa por item e grupo, preservando a ordem recebida', () => {
    const g = grupos()
    assert.deepEqual(g.map((x) => [x.id, x.tipo, x.min, x.max, x.opcoes.length]), [['g-tam', 'variacao', 1, 1, 2], ['g-ad', 'adicional', 0, 2, 3]])
    assert.deepEqual(g[0].opcoes.map((o) => o.nome), ['Pequeno', 'Grande'])
    assert.equal(g[1].opcoes[2].esgotado, true)
  })

  test('linha sem opção cria o grupo vazio; itens diferentes ficam separados', () => {
    const m = agruparOpcoes([
      row({ opcao_id: null, opcao_nome: null, opcao_preco_centavos: null, opcao_esgotado: null }),
      row({ item_id: 'i2', grupo_id: 'g-x', grupo_tipo: 'adicional', min_escolhas: 0, max_escolhas: null }),
    ])
    assert.equal(m.get(ITEM)![0].opcoes.length, 0)
    assert.equal(m.get('i2')![0].max, null)
    assert.equal(m.size, 2)
  })
})

describe('itemPedivel', () => {
  test('item com grupos disponíveis é pedível', () => assert.equal(itemPedivel(grupos()), true))

  test('grupo obrigatório sem opção disponível => não pedível (esgotadas ou inexistentes)', () => {
    const g = grupos()
    g[0].opcoes.forEach((o) => (o.esgotado = true))
    assert.equal(itemPedivel(g), false)
    assert.equal(itemPedivel([{ id: 'v', nome: 'V', tipo: 'adicional', min: 1, max: 1, opcoes: [] }]), false)
  })

  test('grupo OPCIONAL sem opção disponível não impede; sem grupos é pedível', () => {
    const g = grupos()
    g[1].opcoes.forEach((o) => (o.esgotado = true))
    assert.equal(itemPedivel(g), true)
    assert.equal(itemPedivel([]), true)
  })
})

describe('preço', () => {
  test('"a partir de" usa a menor variação disponível; sem variação, o base', () => {
    assert.equal(precoAPartirDe(9999, grupos()), 2200)
    const g = grupos()
    g[0].opcoes[0].esgotado = true
    assert.equal(precoAPartirDe(9999, g), 3200)
    assert.equal(precoAPartirDe(600, []), 600)
    assert.equal(temVariacao(grupos()), true)
    assert.equal(temVariacao([]), false)
  })

  test('variação é ABSOLUTA e adicionais somam', () => {
    assert.equal(precoUnitario(9999, grupos(), ['o-gra']), 3200)
    assert.equal(precoUnitario(9999, grupos(), ['o-gra', 'o-ovo', 'o-bac']), 3200 + 300 + 500)
  })

  test('sem variação escolhida cai no preço base; item simples = base', () => {
    assert.equal(precoUnitario(2200, grupos(), ['o-ovo']), 2200 + 300)
    assert.equal(precoUnitario(600, [], []), 600)
  })

  test('ids desconhecidos não alteram o preço', () => {
    assert.equal(precoUnitario(2200, grupos(), ['o-gra', 'nao-existe']), 3200)
  })
})

describe('validarEscolhas', () => {
  test('variação obrigatória: sem escolha erra, com uma passa, duas erram', () => {
    assert.deepEqual(validarEscolhas(grupos(), []).erros, { 'g-tam': 'Escolha uma opção' })
    assert.equal(validarEscolhas(grupos(), ['o-peq']).ok, true)
    assert.equal(validarEscolhas(grupos(), ['o-peq', 'o-gra']).erros['g-tam'], 'Escolha no máximo 1')
  })

  test('adicional com máximo 2: três erram', () => {
    const g = grupos()
    g[1].opcoes[2].esgotado = false
    assert.equal(validarEscolhas(g, ['o-peq', 'o-ovo', 'o-bac']).ok, true)
    assert.equal(validarEscolhas(g, ['o-peq', 'o-ovo', 'o-bac', 'o-que']).erros['g-ad'], 'Escolha no máximo 2')
  })

  test('mínimo maior que 1 usa o plural; opção esgotada e desconhecida são recusadas', () => {
    const g: GrupoItem[] = [{ id: 'g', nome: 'G', tipo: 'adicional', min: 2, max: null, opcoes: [{ id: 'a', nome: 'A', precoCentavos: 0, esgotado: false }, { id: 'b', nome: 'B', precoCentavos: 0, esgotado: true }] }]
    assert.equal(validarEscolhas(g, ['a']).erros['g'], 'Escolha pelo menos 2')
    assert.match(validarEscolhas(g, ['a', 'b']).erros['g'], /acabou/)
    assert.equal(validarEscolhas(g, ['a', 'zzz']).erros[''], 'Opção inválida.')
  })

  test('item sem grupos valida sempre', () => assert.equal(validarEscolhas([], []).ok, true))
})

describe('alternarOpcao', () => {
  test('escolha única: trocar substitui; tocar na marcada mantém quando obrigatório', () => {
    const g = grupos()
    assert.deepEqual(alternarOpcao(g, [], 'g-tam', 'o-peq'), ['o-peq'])
    assert.deepEqual(alternarOpcao(g, ['o-peq'], 'g-tam', 'o-gra'), ['o-gra'])
    assert.deepEqual(alternarOpcao(g, ['o-gra'], 'g-tam', 'o-gra'), ['o-gra'])
  })

  test('escolha única opcional desmarca ao tocar de novo', () => {
    const g: GrupoItem[] = [{ id: 'g', nome: 'G', tipo: 'adicional', min: 0, max: 1, opcoes: [{ id: 'a', nome: 'A', precoCentavos: 0, esgotado: false }] }]
    assert.deepEqual(alternarOpcao(g, ['a'], 'g', 'a'), [])
  })

  test('adicionais: marca, desmarca e respeita o máximo; esgotada e desconhecida são ignoradas', () => {
    const g = grupos()
    let ids = alternarOpcao(g, ['o-peq'], 'g-ad', 'o-ovo')
    ids = alternarOpcao(g, ids, 'g-ad', 'o-bac')
    assert.deepEqual(ids, ['o-peq', 'o-ovo', 'o-bac'])
    assert.deepEqual(alternarOpcao(g, ids, 'g-ad', 'o-que'), ids) // esgotada
    g[1].opcoes[2].esgotado = false
    assert.deepEqual(alternarOpcao(g, ids, 'g-ad', 'o-que'), ids) // passaria do máximo (2)
    assert.deepEqual(alternarOpcao(g, ids, 'g-ad', 'o-ovo'), ['o-peq', 'o-bac'])
    assert.deepEqual(alternarOpcao(g, ids, 'g-ad', 'zzz'), ids)
    assert.deepEqual(alternarOpcao(g, ids, 'g-zzz', 'o-ovo'), ids)
  })

  test('o máximo é por grupo: escolhas de outro grupo não contam', () => {
    const g = grupos()
    assert.deepEqual(alternarOpcao(g, ['o-peq', 'o-ovo'], 'g-ad', 'o-bac'), ['o-peq', 'o-ovo', 'o-bac'])
  })
})

describe('resumo e chave', () => {
  test('resumo segue a ordem dos grupos, não a do toque', () => {
    assert.equal(resumoEscolhas(grupos(), ['o-bac', 'o-ovo', 'o-gra']), 'Grande, Ovo, Bacon')
    assert.equal(resumoEscolhas(grupos(), []), '')
  })

  test('a chave ignora a ordem das opções e espaços da observação', () => {
    assert.equal(chaveDaLinha(ITEM, ['b', 'a'], ' sem cebola '), chaveDaLinha(ITEM, ['a', 'b'], 'sem cebola'))
    assert.notEqual(chaveDaLinha(ITEM, ['a'], ''), chaveDaLinha(ITEM, ['a', 'b'], ''))
    assert.notEqual(chaveDaLinha(ITEM, ['a'], ''), chaveDaLinha('i2', ['a'], ''))
    assert.notEqual(chaveDaLinha(ITEM, ['a'], ''), chaveDaLinha(ITEM, ['a'], 'x'))
  })
})
