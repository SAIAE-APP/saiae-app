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
  test('tem 31 modelos: 8 variações e 23 adicionais, ids únicos', () => {
    assert.equal(MODELOS_DE_OPCOES.length, 31)
    assert.equal(MODELOS_DE_OPCOES.filter((m) => m.tipo === 'variacao').length, 8)
    assert.equal(MODELOS_DE_OPCOES.filter((m) => m.tipo === 'adicional').length, 23)
    assert.equal(new Set(MODELOS_DE_OPCOES.map((m) => m.id)).size, 31)
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
      if (m.obrigatorio && (m.minimo ?? 1) === 1) assert.equal(m.maximo, 1, m.id)
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
      assert.equal(l.min, m.obrigatorio ? (m.minimo ?? 1) : 0, m.id)
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
    assert.equal(doNegocio.length + outros.length, 31)
  })
  test('sem negócio escolhido, tudo vem em "outros"', () => {
    const r = modelosParaNegocio(null)
    assert.equal(r.doNegocio.length, 0)
    assert.equal(r.outros.length, 31)
  })
  test('busca por nome ignora acento e maiúscula', () => {
    assert.ok(buscarModelos('PORCAO').some((m) => m.id === 'porcao'))
    assert.ok(buscarModelos('catupiry').some((m) => m.id === 'borda'))
    assert.equal(buscarModelos('').length, 31)
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

describe('mínimo de escolhas (combo de sabores)', () => {
  const m = modeloDeOpcoes('sabores_combo')!
  test('o modelo exige 3 sabores: mínimo 3, máximo 3', () => {
    const r = rascunhoDoModelo(m)
    assert.equal(r.minimoTexto, '3')
    assert.equal(r.maximoTexto, '3')
    assert.deepEqual(limitesDoGrupo(r), { min: 3, max: 3 })
    assert.deepEqual(validarRascunho(r), [])
  })
  test('mínimo maior que o limite, fora de 1 a 20 ou maior que as opções ativas é recusado', () => {
    const r = rascunhoDoModelo(m)
    assert.ok(validarRascunho({ ...r, minimoTexto: '4' }).some((e) => /passar do limite/.test(e)))
    assert.ok(validarRascunho({ ...r, minimoTexto: '0' }).some((e) => /1 a 20/.test(e)))
    assert.ok(validarRascunho({ ...r, minimoTexto: '21', maximoTexto: '' }).some((e) => /1 a 20/.test(e)))
    assert.ok(validarRascunho({ ...r, minimoTexto: '3', maximoTexto: '', opcoes: r.opcoes.slice(0, 2) }).some((e) => /maior que o número de opções ativas/.test(e)))
  })
  test('sem "obrigatório" o mínimo é ignorado; sem minimoTexto continua 1 (rascunho antigo)', () => {
    const r = rascunhoDoModelo(m)
    assert.equal(limitesDoGrupo({ ...r, obrigatorio: false }).min, 0)
    const { minimoTexto: _ignorado, ...antigo } = r
    assert.equal(limitesDoGrupo(antigo).min, 1)
  })
  test('um modelo com mínimo maior que 1 não entra num kit', () => {
    assert.throws(() => conteudoDoGrupo('s', m))
  })
  test('nenhum dos 8 kits usa modelo com mínimo maior que 1', () => {
    for (const x of MODELOS_DE_OPCOES) if ((x.minimo ?? 1) > 1) assert.equal(x.id, 'sabores_combo')
  })
})
