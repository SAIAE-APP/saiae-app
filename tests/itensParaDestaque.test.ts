import assert from 'node:assert/strict'
import { test } from 'node:test'
import { itensElegiveisParaDestaque } from '../src/lib/itensParaDestaque.ts'

const item = (id: string, nome: string, extra: object = {}) => ({
  id,
  nome,
  ativo: true,
  esgotado: false,
  preco_aberto: false,
  ...extra,
})

test('filtra inativo, esgotado e preço aberto, e ordena por nome', () => {
  const r = itensElegiveisParaDestaque([
    item('1', 'Zebra'),
    item('2', 'Água', { ativo: false }),
    item('3', 'Bolo', { esgotado: true }),
    item('4', 'Café', { preco_aberto: true }),
    item('5', 'Éclair'),
    item('6', 'Açaí'),
  ])
  assert.deepEqual(r.map((i) => i.id), ['6', '5', '1'])
})

test('lista vazia devolve vazio', () => {
  assert.deepEqual(itensElegiveisParaDestaque([]), [])
})
