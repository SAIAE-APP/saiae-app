// A cópia das regras de importação de cardápio no servidor (supabase/functions/_shared/cardapioImportacao.ts) tem de
// continuar IGUAL à do front (src/lib/importarCardapio.ts). Dois testes: o texto das funções e o resultado nos mesmos casos.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import * as front from '../src/lib/importarCardapio.ts'
import * as clientes from '../src/lib/importarClientes.ts'
import * as servidor from '../supabase/functions/_shared/cardapioImportacao.ts'

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8')
const corpo = (fonte: string, nome: string) => {
  const ini = fonte.indexOf(`export function ${nome}`)
  assert.ok(ini >= 0, `função ${nome} não encontrada`)
  return fonte.slice(ini, fonte.indexOf('\n}\n', ini) + 3)
}

describe('cópia das regras de importação de cardápio', () => {
  test('o texto das funções copiadas é idêntico ao do front', () => {
    const srv = ler('../supabase/functions/_shared/cardapioImportacao.ts')
    const cardapio = ler('../src/lib/importarCardapio.ts')
    const cli = ler('../src/lib/importarClientes.ts')
    for (const nome of ['chaveNome', 'interpretarPreco', 'interpretarSimNao', 'validarCardapio']) {
      assert.equal(corpo(srv, nome), corpo(cardapio, nome), nome)
    }
    assert.equal(corpo(srv, 'limparCelula'), corpo(cli, 'limparCelula'))
    for (const [nome, valor] of [['LIMITE_LINHAS_CARDAPIO', '300'], ['SEM_CATEGORIA', "'sem categoria'"], ['CENTAVOS_MAX', '99999999']]) {
      assert.ok(srv.includes(`${nome} = ${valor}`), nome)
    }
    assert.ok(cardapio.includes('MAX_CARDAPIO = { categoria: 60, nome: 80, descricao: 300 }'))
    assert.ok(srv.includes('MAX_CARDAPIO = { categoria: 60, nome: 80, descricao: 300 }'))
    assert.equal(front.LIMITE_LINHAS_CARDAPIO, servidor.LIMITE_LINHAS_CARDAPIO)
    assert.equal(clientes.limparCelula('  a  b ', 10), servidor.limparCelula('  a  b ', 10))
  })

  test('mesmo resultado nos mesmos casos (preço, nomes e validação)', () => {
    const precos = ['12', '12,5', '12,50', 'R$ 12,50', '12.50', '1.234,56', '1,234.56', '1.234', '1,234', '1.234.567', '0', '0,00', '-5', 'abc', '', '12,345', '99999999', '1000000,00', '1.2.3', '1,2,3', ' 8 ']
    for (const p of precos) assert.deepEqual(servidor.interpretarPreco(p), front.interpretarPreco(p), p)
    for (const n of ['  Pastéis  Fritos ', 'ÇÃO', 'Açaí', 'São João', 'x']) assert.equal(servidor.chaveNome(n), front.chaveNome(n))

    const existente = {
      categorias: [{ id: 'c1', nome: 'Pastéis', ordem: 1 }],
      itens: [
        { nome: 'Pastel de carne', categoria_id: 'c1', ordem: 1 },
        { nome: 'Suco', categoria_id: null, ordem: 2 },
      ],
    }
    const linhas = [
      ['Pasteis', 'PASTEL DE CARNE', '8,50', ''],
      ['Pastéis', 'Pastel de queijo', '8,00', 'Queijo'],
      ['Pastéis', 'pastel de queijo ', '9', ''],
      ['Bebidas', 'Caldo de cana', '7', 'Gelado'],
      ['bebidas', 'Água', '1.234', ''],
      ['', 'Suco', '5', ''],
      ['Sem categoria', 'Suco', '5', ''],
      ['Doces', '', '5', ''],
      ['Doces', 'Brigadeiro', '0', ''],
      ['Doces', 'Beijinho', 'grátis', ''],
      ['Doces', 'x'.repeat(81), '5', ''],
      ['C'.repeat(61), 'Ok', '5', ''],
      ['Doces', 'Cocada', '5', 'd'.repeat(301)],
    ].map((celulas, i) => ({ linha: i + 2, celulas }))
    const colunas = { categoria: 0, nome: 1, preco: 2, descricao: 3, ativo: -1, precoAberto: -1 } as const
    assert.deepEqual(servidor.validarCardapio(linhas, { ...colunas }, existente), front.validarCardapio(linhas, { ...colunas }, existente))
    assert.deepEqual(servidor.COLUNAS_IA, colunas)
    const r = servidor.validarCardapio(linhas, { ...colunas }, existente)
    assert.equal(r.jaExistiam, 2)
    assert.equal(r.invalidas.length, 7)
  })
})
