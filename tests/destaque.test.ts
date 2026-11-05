import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolverDestaque } from '../src/lib/destaque.ts'

const linhas = [
  { item_id: 'a', item_esgotado: false },
  { item_id: 'b', item_esgotado: true },
]

test('sem escolha devolve null', () => {
  assert.equal(resolverDestaque(null, linhas, false), null)
})

test('item ausente das linhas (inativo ou preço aberto) devolve null', () => {
  assert.equal(resolverDestaque('x', linhas, false), null)
})

test('item disponível devolve a própria linha', () => {
  assert.equal(resolverDestaque('a', linhas, false), linhas[0])
})

test('item esgotado (inclusive o derivado das opções) devolve null', () => {
  assert.equal(resolverDestaque('b', linhas, false), null)
})

test('busca ativa esconde o destaque', () => {
  assert.equal(resolverDestaque('a', linhas, true), null)
})
