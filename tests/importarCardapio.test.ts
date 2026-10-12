// Importação do cardápio: cabeçalho, preço em vários formatos, validação por linha, dedupe e planilha modelo. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  LIMITE_LINHAS_CARDAPIO,
  chaveNome,
  gerarCsvModeloCardapio,
  interpretarPreco,
  interpretarSimNao,
  lerTabelaCardapio,
  mapearColunasCardapio,
  parsearCsv,
  validarCardapio,
  type CardapioExistente,
} from '../src/lib/importarCardapio.ts'

const VAZIO: CardapioExistente = { categorias: [], itens: [] }
const CABECALHO = ['Categoria', 'Nome', 'Preço', 'Descrição', 'Ativo']

function validar(linhas: string[][], existente: CardapioExistente = VAZIO, cabecalho: string[] = CABECALHO) {
  const lida = lerTabelaCardapio([cabecalho, ...linhas])
  if (!lida.ok) throw new Error(lida.mensagem)
  return validarCardapio(lida.linhas, lida.colunas, existente)
}

describe('interpretarPreco', () => {
  const centavos = (t: string) => {
    const r = interpretarPreco(t)
    return r.ok ? r.centavos : `erro: ${r.motivo}`
  }
  test('formatos aceitos', () => {
    assert.equal(centavos('12'), 1200)
    assert.equal(centavos('12,5'), 1250)
    assert.equal(centavos('12,50'), 1250)
    assert.equal(centavos('R$ 12,50'), 1250)
    assert.equal(centavos('R$12,50'), 1250)
    assert.equal(centavos('r$ 12'), 1200)
    assert.equal(centavos('12.50'), 1250)
    assert.equal(centavos('12.5'), 1250)
    assert.equal(centavos('0,99'), 99)
    assert.equal(centavos('1.234,56'), 123456)
    assert.equal(centavos('1,234.56'), 123456)
    assert.equal(centavos('9.999,99'), 999999)
    assert.equal(centavos('999.999,99'), 99999999) // o máximo
    assert.equal(centavos('  8 , 5 '), 850)
    assert.equal(centavos('0'), 0)
  })
  test('recusa o que não dá para interpretar com segurança', () => {
    assert.match(String(centavos('')), /preço vazio/)
    assert.match(String(centavos('abc')), /preço inválido/)
    assert.match(String(centavos('12,3x')), /preço inválido/)
    assert.match(String(centavos('-5')), /negativo/)
    assert.match(String(centavos('1.234')), /ambíguo/)
    assert.match(String(centavos('1,234')), /ambíguo/)
    assert.match(String(centavos('12,345')), /ambíguo/)
    assert.match(String(centavos('12,3456')), /casas decimais/)
    assert.match(String(centavos('1,2,3')), /inválido/)
    assert.match(String(centavos('12,')), /inválido/)
    assert.match(String(centavos(',5')), /inválido/)
    assert.match(String(centavos('1.234,')), /inválido/)
    assert.match(String(centavos('1234567890')), /acima do máximo/)
    assert.match(String(centavos('1.000.000,00')), /acima do máximo/)
    assert.match(String(centavos('1.234.567')), /acima do máximo/)
  })
  test('valor numérico vindo do Excel ("12.5", "1234.5") é decimal', () => {
    assert.equal(centavos('12.5'), 1250)
    assert.equal(centavos('1234.5'), 123450)
  })
})

describe('interpretarSimNao', () => {
  test('sim/não, 1/0, vazio usa o padrão, lixo vira null', () => {
    for (const v of ['sim', 'Sim', 'SIM', ' s ', '1', 'true', 'x']) assert.equal(interpretarSimNao(v, false), true, v)
    for (const v of ['não', 'Não', 'nao', 'n', '0', 'false', 'inativo']) assert.equal(interpretarSimNao(v, true), false, v)
    assert.equal(interpretarSimNao('', true), true)
    assert.equal(interpretarSimNao('  ', false), false)
    assert.equal(interpretarSimNao('talvez', true), null)
  })
})

describe('cabeçalho', () => {
  test('sem acento, sem maiúscula, qualquer ordem, com sinônimos', () => {
    const c = mapearColunasCardapio(['PREÇO (R$)', 'nome', 'CATEGORIA', 'Descrição', 'ATIVO', 'Preço aberto'])
    assert.deepEqual(c, { categoria: 2, nome: 1, preco: 0, descricao: 3, ativo: 4, precoAberto: 5 })
    const d = mapearColunasCardapio(['Produto', 'Valor', 'Grupo'])
    assert.equal(d.nome, 0)
    assert.equal(d.preco, 1)
    assert.equal(d.categoria, 2)
    assert.equal(d.ativo, -1)
  })
  test('"Preço aberto" não é confundido com "Preço"', () => {
    const c = mapearColunasCardapio(['Nome', 'Preço aberto'])
    assert.equal(c.preco, -1)
    assert.equal(c.precoAberto, 1)
  })
  test('lerTabelaCardapio: vazio, só cabeçalho, sem Nome/Preço, limite de linhas', () => {
    assert.equal(lerTabelaCardapio([]).ok, false)
    assert.equal(lerTabelaCardapio([['', ''], ['', '']]).ok, false)
    const so = lerTabelaCardapio([['Nome', 'Preço']])
    assert.ok(!so.ok && /só tem o cabeçalho/.test(so.mensagem))
    const sem = lerTabelaCardapio([['Item', 'Quantidade'], ['a', '1']])
    assert.ok(!sem.ok && sem.erro === 'sem_cabecalho' && /Nome.*Preço/.test(sem.mensagem))
    const nPreco = lerTabelaCardapio([['Nome'], ['a']])
    assert.ok(!nPreco.ok && nPreco.erro === 'sem_cabecalho')
    const dados = Array.from({ length: LIMITE_LINHAS_CARDAPIO }, (_, i) => [`Item ${i}`, '5'])
    assert.ok(lerTabelaCardapio([['Nome', 'Preço'], ...dados]).ok)
    const muitos = lerTabelaCardapio([['Nome', 'Preço'], ...dados, ['Item extra', '5']])
    assert.ok(!muitos.ok && muitos.erro === 'muitas_linhas' && muitos.mensagem.includes(String(LIMITE_LINHAS_CARDAPIO)))
  })
  test('linhas em branco no meio não contam, e o número da linha é o da planilha', () => {
    const lida = lerTabelaCardapio([['Nome', 'Preço'], ['', ''], ['A', '1'], ['', ''], ['B', '2']])
    assert.ok(lida.ok)
    assert.deepEqual(lida.ok && lida.linhas.map((l) => l.linha), [3, 5])
  })
})

describe('validação das linhas', () => {
  test('linha boa; descrição vazia vira null; Ativo vazio = sim; categoria nova', () => {
    const r = validar([['Pastéis', 'Pastel de carne', '8,50', 'Carne moída', ''], ['Pastéis', 'Pastel de queijo', '8', '', 'não']])
    assert.equal(r.paraCriar.length, 2)
    assert.deepEqual(r.categoriasNovas, ['Pastéis'])
    assert.equal(r.paraCriar[0].precoCentavos, 850)
    assert.equal(r.paraCriar[0].ativo, true)
    assert.equal(r.paraCriar[1].descricao, null)
    assert.equal(r.paraCriar[1].ativo, false)
    assert.equal(r.invalidas.length, 0)
  })

  test('erros por linha em português, com o número da linha da planilha; as boas entram', () => {
    const nomeLongo = 'x'.repeat(81)
    const r = validar([
      ['A', 'Ok', '5', '', ''], // linha 2
      ['A', '', '5', '', ''], // 3 nome vazio
      ['A', 'Sem preço', '', '', ''], // 4
      ['A', 'Preço zero', '0', '', ''], // 5
      ['A', 'Preço ruim', 'doze', '', ''], // 6
      ['A', 'Ativo ruim', '5', '', 'talvez'], // 7
      ['A', nomeLongo, '5', '', ''], // 8
    ])
    assert.equal(r.paraCriar.length, 1)
    const por = Object.fromEntries(r.invalidas.map((l) => [l.linha, l.motivo]))
    assert.match(por[3], /nome vazio/)
    assert.match(por[4], /preço vazio/)
    assert.match(por[5], /preço zerado/)
    assert.match(por[6], /preço inválido/)
    assert.match(por[7], /Ativo/)
    assert.match(por[8], /mais de 80/)
    assert.deepEqual(r.invalidas.map((l) => l.linha), [3, 4, 5, 6, 7, 8])
  })

  test('uma linha com vários problemas lista todos', () => {
    const r = validar([['', '', 'abc', '', 'talvez']])
    assert.match(r.invalidas[0].motivo, /nome vazio/)
    assert.match(r.invalidas[0].motivo, /preço inválido/)
    assert.match(r.invalidas[0].motivo, /Ativo/)
  })

  test('Preço aberto = sim: preço 0 permitido, coluna Preço ignorada', () => {
    const r = validar(
      [['Extras', 'Valor livre', '', 'sim'], ['Extras', 'Outro livre', '99', 'sim'], ['Extras', 'Normal', '5', 'não']],
      VAZIO,
      ['Categoria', 'Nome', 'Preço', 'Preço aberto'],
    )
    assert.equal(r.invalidas.length, 0)
    assert.deepEqual(r.paraCriar.map((i) => [i.precoAberto, i.precoCentavos]), [[true, 0], [true, 0], [false, 500]])
  })

  test('categoria vazia ou "Sem categoria" = sem categoria (sem criar categoria)', () => {
    const r = validar([['', 'A', '1', '', ''], ['Sem categoria', 'B', '1', '', ''], ['  SEM  CATEGORIA ', 'C', '1', '', '']])
    assert.deepEqual(r.categoriasNovas, [])
    assert.ok(r.paraCriar.every((i) => i.categoria === null && i.categoriaChave === null))
  })

  test('categoria compara sem acento/maiúscula: reaproveita a existente e junta as grafias do arquivo', () => {
    const existente: CardapioExistente = { categorias: [{ id: 'c1', nome: 'Bebidas', ordem: 1 }], itens: [] }
    const r = validar(
      [['BEBIDAS', 'Suco', '5', '', ''], ['bebidás', 'Água', '3', '', ''], ['Pastéis', 'P1', '8', '', ''], ['PASTEIS', 'P2', '8', '', '']],
      existente,
    )
    assert.deepEqual(r.categoriasNovas, ['Pastéis'])
    assert.equal(r.paraCriar[3].categoria, 'Pastéis', 'a 1ª grafia vale')
  })

  test('item que já existe (mesma categoria + nome, sem acento/maiúscula) é pulado; outra categoria não', () => {
    const existente: CardapioExistente = {
      categorias: [{ id: 'c1', nome: 'Pastéis', ordem: 1 }],
      itens: [
        { nome: 'Pastel de Carne', categoria_id: 'c1', ordem: 1 },
        { nome: 'Combo', categoria_id: null, ordem: 2 },
      ],
    }
    const r = validar(
      [
        ['pasteis', 'pastel de carne', '9', '', ''], // já existe
        ['Bebidas', 'Pastel de carne', '9', '', ''], // outra categoria: entra
        ['', 'combo', '20', '', ''], // já existe sem categoria
        ['Pastéis', 'Pastel novo', '9', '', ''],
      ],
      existente,
    )
    assert.equal(r.jaExistiam, 2)
    assert.deepEqual(r.paraCriar.map((i) => i.nome), ['Pastel de carne', 'Pastel novo'])
  })

  test('repetido no arquivo: vale a 1ª linha', () => {
    const r = validar([['A', 'Pastel', '5', '', ''], ['a', 'PASTEL', '6', '', ''], ['B', 'Pastel', '7', '', '']])
    assert.equal(r.paraCriar.length, 2)
    assert.deepEqual(r.duplicadasNoArquivo, [{ linha: 3, nome: 'PASTEL' }])
    assert.equal(r.paraCriar[0].precoCentavos, 500)
  })

  test('caracteres de controle e espaços extras são limpos', () => {
    const r = validar([['A', '  Pastel\u0007   de   carne ', '5', 'x\u0000y', '']])
    assert.equal(r.paraCriar[0].nome, 'Pastel de carne')
    assert.equal(r.paraCriar[0].descricao, 'xy')
  })
})

describe('planilha modelo', () => {
  test('o modelo gerado é lido sem erro: 3 itens, 2 categorias novas', () => {
    const csv = gerarCsvModeloCardapio()
    assert.ok(csv.startsWith('﻿'), 'BOM para o Excel brasileiro')
    const tabela = parsearCsv(csv)
    const r = validar(tabela.slice(1), VAZIO, tabela[0])
    assert.equal(r.invalidas.length, 0)
    assert.equal(r.paraCriar.length, 3)
    assert.deepEqual(r.categoriasNovas, ['Pastéis', 'Bebidas'])
    assert.equal(r.paraCriar[0].precoCentavos, 850)
    assert.equal(r.paraCriar[2].precoCentavos, 700)
  })
  test('chaveNome', () => {
    assert.equal(chaveNome('  Pastéis   Fritos '), 'pasteis fritos')
  })
})
