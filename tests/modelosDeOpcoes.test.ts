// Biblioteca de modelos de opções (kits iniciais, PR 2): lógica pura. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MODELOS_DE_GRUPO, validarRascunho, limitesDoGrupo, type RascunhoGrupo } from '../src/lib/opcoesCadastro.ts'
import {
  MODELOS_DE_OPCOES,
  TODOS_OS_NEGOCIOS,
  buscarModelos,
  conteudoDoGrupo,
  modeloDeOpcoes,
  modelosParaNegocio,
  rascunhoDoModelo,
} from '../src/lib/modelosDeOpcoes.ts'

/** Preenche o preço de toda opção (o dono faz isso antes de salvar). */
const comPrecos = (r: RascunhoGrupo): RascunhoGrupo => ({ ...r, opcoes: r.opcoes.map((o) => ({ ...o, precoTexto: '5,00' })) })

describe('a biblioteca', () => {
  test('tem 30 modelos: 8 variações e 22 adicionais, ids únicos', () => {
    assert.equal(MODELOS_DE_OPCOES.length, 30)
    assert.equal(MODELOS_DE_OPCOES.filter((m) => m.tipo === 'variacao').length, 8)
    assert.equal(MODELOS_DE_OPCOES.filter((m) => m.tipo === 'adicional').length, 22)
    assert.equal(new Set(MODELOS_DE_OPCOES.map((m) => m.id)).size, 30)
  })
  test('os ids que já existiam (tamanho, adicionais) mantêm nome e opções dos modelos antigos', () => {
    for (const antigo of MODELOS_DE_GRUPO) {
      const velho = antigo.criar()
      const novo = rascunhoDoModelo(modeloDeOpcoes(antigo.id)!)
      assert.equal(novo.nome, velho.nome, antigo.id)
      assert.equal(novo.tipo, velho.tipo, antigo.id)
      assert.deepEqual(novo.opcoes.map((o) => o.nome), velho.opcoes.map((o) => o.nome), antigo.id)
    }
  })
  test('todo modelo: nomes até 60 letras, opções 1 a 12, sem opção repetida', () => {
    for (const m of MODELOS_DE_OPCOES) {
      assert.ok(m.titulo.trim() && m.descricao.trim() && m.nomeGrupo.trim(), m.id)
      assert.ok(m.nomeGrupo.length <= 60, m.id)
      assert.ok(m.opcoes.length >= 1 && m.opcoes.length <= 12, m.id)
      const nomes = m.opcoes.map((o) => o.nome.toLocaleLowerCase('pt-BR'))
      assert.equal(new Set(nomes).size, nomes.length, `${m.id}: opção repetida`)
      assert.ok(m.opcoes.every((o) => o.nome.trim() && o.nome.length <= 60), m.id)
      assert.ok(m.negocios.length >= 1, m.id)
    }
  })
  test('variação: obrigatória, escolha única, toda opção precisa de preço', () => {
    for (const m of MODELOS_DE_OPCOES.filter((x) => x.tipo === 'variacao')) {
      assert.equal(m.obrigatorio, true, m.id)
      assert.equal(m.maximo, 1, m.id)
      assert.ok(m.opcoes.every((o) => o.precisaPreco === true), `${m.id}: variação sem preço não pode nascer ativa`)
    }
  })
  test('adicional obrigatório é escolha única; limite entre 1 e 20 ou sem limite', () => {
    for (const m of MODELOS_DE_OPCOES.filter((x) => x.tipo === 'adicional')) {
      if (m.obrigatorio) assert.equal(m.maximo, 1, m.id)
      assert.ok(m.maximo === null || (m.maximo >= 1 && m.maximo <= 20), m.id)
    }
  })
  test('cada modelo vira um rascunho que passa em validarRascunho depois de pôr os preços', () => {
    for (const m of MODELOS_DE_OPCOES) {
      assert.deepEqual(validarRascunho(comPrecos(rascunhoDoModelo(m))), [], m.id)
    }
  })
  test('o rascunho reproduz min e max do modelo', () => {
    for (const m of MODELOS_DE_OPCOES) {
      const l = limitesDoGrupo(rascunhoDoModelo(m))
      assert.equal(l.min, m.obrigatorio ? 1 : 0, m.id)
      assert.equal(l.max, m.tipo === 'variacao' ? 1 : m.maximo, m.id)
    }
  })
  test('precisaPreco só em opção que custa dinheiro', () => {
    for (const id of ['ponto_carne', 'mistura_pf', 'acompanhamentos_acai', 'coberturas_acai', 'molhos', 'temperatura', 'acompanhamentos_pf']) {
      assert.ok(modeloDeOpcoes(id)!.opcoes.every((o) => !o.precisaPreco), id)
    }
    for (const id of ['extras_acai', 'borda', 'adicionais', 'adicionais_lanche', 'embalagem_presente']) {
      assert.ok(modeloDeOpcoes(id)!.opcoes.every((o) => o.precisaPreco), id)
    }
  })
})

describe('por tipo de negócio', () => {
  test('todo tipo de negócio tem pelo menos 3 modelos', () => {
    for (const n of TODOS_OS_NEGOCIOS) {
      assert.ok(modelosParaNegocio(n).doNegocio.length >= 3, n)
    }
  })
  test('os modelos do negócio vêm primeiro e os outros em seguida, sem repetir', () => {
    const { doNegocio, outros } = modelosParaNegocio('pizzaria')
    assert.ok(doNegocio.some((m) => m.id === 'tamanho_pizza') && doNegocio.some((m) => m.id === 'borda'))
    assert.ok(outros.every((m) => !doNegocio.includes(m)))
    assert.equal(doNegocio.length + outros.length, 30)
  })
  test('sem negócio escolhido, tudo vem em "outros"', () => {
    const r = modelosParaNegocio(null)
    assert.equal(r.doNegocio.length, 0)
    assert.equal(r.outros.length, 30)
  })
  test('busca por nome ignora acento e maiúscula', () => {
    assert.ok(buscarModelos('PORCAO').some((m) => m.id === 'porcao'))
    assert.ok(buscarModelos('catupiry').some((m) => m.id === 'borda'))
    assert.equal(buscarModelos('').length, 30)
    assert.equal(buscarModelos('zzzz').length, 0)
  })
})

describe('conteudoDoGrupo (formato da RPC)', () => {
  test('mantém regra e marca as opções que precisam de preço', () => {
    const g = conteudoDoGrupo('ponto', modeloDeOpcoes('ponto_carne')!)
    assert.deepEqual(g, {
      chave: 'ponto', nome: 'Ponto da carne', tipo: 'adicional', obrigatorio: true, maximo: 1,
      opcoes: [
        { nome: 'Mal passado', precisaPreco: false },
        { nome: 'Ao ponto', precisaPreco: false },
        { nome: 'Bem passado', precisaPreco: false },
      ],
    })
  })
  test('ajuste: ficar só com algumas opções, outro limite e outro nome', () => {
    const a = conteudoDoGrupo('c', modeloDeOpcoes('carnes')!, { somente: ['Simples', 'Duplo'] })
    assert.deepEqual(a.opcoes.map((o) => o.nome), ['Simples', 'Duplo'])
    const b = conteudoDoGrupo('a', modeloDeOpcoes('acompanhamentos_pf')!, { maximo: 3, nome: 'Guarnições' })
    assert.equal(b.maximo, 3)
    assert.equal(b.nome, 'Guarnições')
  })
  test('variação ignora ajuste de máximo (é sempre 1)', () => {
    assert.equal(conteudoDoGrupo('t', modeloDeOpcoes('tamanho')!, { maximo: 5 }).maximo, 1)
  })
})
