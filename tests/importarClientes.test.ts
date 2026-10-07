// Importação de clientes: parse, normalização, validação, dedupe e lotes. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emLotes,
  lerTabela,
  mapearColunas,
  normalizarTelefoneImportado,
  parsearCsv,
  validarClientes,
} from '../src/lib/importarClientes.ts'

test('normalizarTelefoneImportado: dígitos, 55 só com 12/13 dígitos', () => {
  assert.equal(normalizarTelefoneImportado('(11) 91234-5678'), '11912345678')
  assert.equal(normalizarTelefoneImportado('+55 11 91234-5678'), '11912345678')
  assert.equal(normalizarTelefoneImportado('5511912345678'), '11912345678')
  assert.equal(normalizarTelefoneImportado('551112345678'), '1112345678')
  // 55 = DDD de Santa Maria/RS: com 10/11 dígitos fica
  assert.equal(normalizarTelefoneImportado('55 99123-4567'), '55991234567')
  assert.equal(normalizarTelefoneImportado(''), '')
})

test('parsearCsv: delimitador ; , tab, BOM, aspas e quebra de linha', () => {
  assert.deepEqual(parsearCsv('﻿a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parsearCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parsearCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parsearCsv('"a;1";"diz ""oi""";"x\ny"\n'), [['a;1', 'diz "oi"', 'x\ny']])
  assert.deepEqual(parsearCsv(''), [])
})

test('mapearColunas: formato do export e sinônimos', () => {
  const c = mapearColunas(['Nome', 'Telefone', 'Telefone (só dígitos)', 'Rua', 'Número', 'Bairro', 'Referência', 'Origem'])
  assert.deepEqual(c, { nome: 0, telefone: 1, telefoneDigitos: 2, rua: 3, numero: 4, bairro: 5, referencia: 6 })
  const d = mapearColunas(['Cliente', 'WhatsApp', 'Endereço', 'Complemento'])
  assert.equal(d.nome, 0)
  assert.equal(d.telefone, 1)
  assert.equal(d.rua, 2)
  assert.equal(d.referencia, 3)
  assert.equal(d.bairro, -1)
})

test('lerTabela: cabeçalho obrigatório, vazio e limite de linhas', () => {
  assert.equal(lerTabela([]).ok, false)
  assert.equal(lerTabela([['', ''], ['', '']]).ok, false)
  const semCab = lerTabela([['foo', 'bar'], ['a', 'b']])
  assert.ok(!semCab.ok && semCab.erro === 'sem_cabecalho')
  const soCab = lerTabela([['Nome', 'Telefone']])
  assert.ok(!soCab.ok && soCab.erro === 'vazio')
  const muitas = lerTabela([['Nome', 'Telefone'], ...Array.from({ length: 6 }, (_, i) => ['A', String(i)])], 5)
  assert.ok(!muitas.ok && muitas.erro === 'muitas_linhas')
  const ok = lerTabela([['Nome', 'Telefone'], ['', ''], ['Ana', '11912345678']])
  assert.ok(ok.ok && ok.linhas.length === 1 && ok.linhas[0].linha === 3)
})

function validar(tabela: string[][], existentes: string[] = []) {
  const t = lerTabela(tabela)
  assert.ok(t.ok)
  return validarClientes(t.linhas, t.colunas, new Set(existentes))
}

test('validarClientes: erros por linha (nome, telefone vazio/curto/longo)', () => {
  const r = validar([
    ['Nome', 'Telefone'],
    ['', '11912345678'],
    ['Ana', ''],
    ['Bia', '123456789'],
    ['Caio', '1234567890123456'],
    ['Dani', '(11) 91234-5678'],
  ])
  assert.deepEqual(
    r.invalidas.map((l) => [l.linha, l.motivo]),
    [
      [2, 'nome vazio'],
      [3, 'telefone vazio'],
      [4, 'telefone com menos de 10 dígitos'],
      [5, 'telefone com mais de 15 dígitos'],
    ],
  )
  assert.equal(r.validos.length, 1)
  assert.equal(r.validos[0].telefone, '11912345678')
})

test('validarClientes: dedupe no arquivo (vale a primeira) e já existentes', () => {
  const r = validar(
    [
      ['Nome', 'Telefone'],
      ['Ana', '11912345678'],
      ['Ana de novo', '+55 11 91234-5678'],
      ['Bia', '21987654321'],
      ['Caio', '31911112222'],
    ],
    ['21987654321'],
  )
  assert.equal(r.validos.length, 3)
  assert.deepEqual(r.duplicadasNoArquivo, [{ linha: 3, telefone: '11912345678' }])
  assert.equal(r.validos[0].nome, 'Ana')
  assert.equal(r.jaExistentes, 1)
  assert.equal(r.novos, 2)
})

test('validarClientes: round-trip do export (apóstrofo anti-fórmula, 2 colunas de telefone)', () => {
  const r = validar([
    ['Nome', 'Telefone', 'Telefone (só dígitos)', 'Rua', 'Número', 'Bairro', 'Referência'],
    ["'=Ana", "'+55 11 91234-5678", '11912345678', 'Rua A', '10', 'Centro', ''],
    ['Bia', 'abc', '21987654321', 'Rua B', '', '', 'perto da praça'],
  ])
  assert.equal(r.invalidas.length, 0)
  assert.equal(r.validos[0].nome, '=Ana')
  assert.equal(r.validos[0].telefone, '11912345678')
  assert.equal(r.validos[1].telefone, '21987654321')
  assert.equal(r.validos[1].referencia, 'perto da praça')
})

test('validarClientes: limpa espaços e limita tamanho', () => {
  const r = validar([['Nome', 'Telefone', 'Bairro'], ['  Ana   Maria ', '11912345678', 'x'.repeat(200)]])
  assert.equal(r.validos[0].nome, 'Ana Maria')
  assert.equal(r.validos[0].bairro.length, 80)
})

test('emLotes', () => {
  assert.deepEqual(emLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(emLotes([], 2), [])
  assert.equal(emLotes(Array.from({ length: 2000 }), 200).length, 10)
})
