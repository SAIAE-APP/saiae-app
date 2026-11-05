import assert from 'node:assert/strict'
import { test } from 'node:test'
import { montarBarracasDoUsuario } from '../src/lib/barracasDoUsuario.ts'

test('descarta a linha cuja barraca está arquivada (join voltou null) e mantém as outras', () => {
  const lista = montarBarracasDoUsuario([
    { barraca_id: 'a', papel: 'dono', barracas: { id: 'a', nome: 'Ativa', slug: 'ativa' } },
    { barraca_id: 'b', papel: 'dono', barracas: null },
  ])
  assert.equal(lista.length, 1)
  assert.equal(lista[0].barraca.slug, 'ativa')
})

test('conta só com barracas arquivadas gera lista vazia, sem null', () => {
  assert.deepEqual(montarBarracasDoUsuario([{ barraca_id: 'b', papel: 'dono', barracas: null }]), [])
})
