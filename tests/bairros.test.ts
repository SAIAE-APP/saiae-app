// Testes da lógica pura de bairros/taxa (Node >= 22.18: roda TS direto). Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bairroCanonico,
  normalizarBairro,
  parsearListaBairros,
  taxaDoBairro,
  type ConfigBairros,
} from '../src/lib/bairrosTaxa.ts'

const config: ConfigBairros = { naoListado: 'taxa_padrao', taxaPadraoCentavos: 1000, taxaHabilitada: true }
const lista = [{ bairro: 'taguatinga centro', valorCentavos: 500 }]

test('normalizarBairro: caixa, acento e espaços', () => {
  assert.equal(normalizarBairro('  São   JOÃO '), 'sao joao')
  assert.equal(normalizarBairro('Taguatinga Centro'), 'taguatinga centro')
  assert.equal(normalizarBairro(''), '')
})

test('bairro digitado igual ao cadastrado cobra o valor do bairro, não a taxa padrão', () => {
  // Caso do bug reportado: "taguatinga centro" (R$ 5,00) com taxa padrão R$ 10,00.
  const r = taxaDoBairro(config, lista, 'taguatinga centro')
  assert.deepEqual(r, { permitido: true, taxaCentavos: 500, origem: 'bairro' })
  assert.equal(taxaDoBairro(config, lista, ' Taguatinga   CENTRO ').taxaCentavos, 500)
})

test('lista ainda não carregada (vazia) cai na taxa padrão: é por isso que a lista precisa ser atualizada', () => {
  assert.equal(taxaDoBairro(config, [], 'taguatinga centro').taxaCentavos, 1000)
  assert.equal(taxaDoBairro(config, lista, 'taguatinga centro').taxaCentavos, 500)
})

test('bairro fora da lista: taxa padrão, bloqueio ou sem taxa', () => {
  assert.equal(taxaDoBairro(config, lista, 'outro').origem, 'padrao')
  assert.deepEqual(taxaDoBairro({ ...config, naoListado: 'bloquear' }, lista, 'outro'), {
    permitido: false,
    taxaCentavos: 0,
    origem: 'bloqueado',
  })
  assert.equal(taxaDoBairro({ ...config, taxaHabilitada: false }, lista, 'outro').origem, 'sem_taxa')
  assert.equal(taxaDoBairro(config, lista, '').origem, 'padrao')
})

test('bairro inativo não conta', () => {
  assert.equal(taxaDoBairro(config, [{ ...lista[0], ativo: false }], 'taguatinga centro').origem, 'padrao')
})

test('bairroCanonico devolve o nome cadastrado', () => {
  assert.equal(bairroCanonico('TAGUATINGA centro', lista), 'taguatinga centro')
  assert.equal(bairroCanonico('outro', lista), null)
  assert.equal(bairroCanonico('', lista), null)
  assert.equal(bairroCanonico('Centro', [{ bairro: 'Centro', valorCentavos: 1, ativo: false }]), null)
})

test('parsearListaBairros: válidas, inválidas, vazias e repetidas', () => {
  const r = parsearListaBairros('Centro; 5,00\n\nSão João;5.5\nruim\nX;abc\nCentro ; 6,00\n;3')
  assert.deepEqual(r.validos, [
    { bairro: 'Centro', valorCentavos: 600 },
    { bairro: 'São João', valorCentavos: 550 },
  ])
  assert.deepEqual(
    r.invalidas.map((l) => [l.numero, l.motivo]),
    [
      [4, 'use "Bairro; valor"'],
      [5, 'valor inválido'],
      [7, 'bairro vazio'],
    ],
  )
})
