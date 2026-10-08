// "Pedir de novo": nunca monta carrinho errado em silêncio. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { classificarItensPedirDeNovo } from '../supabase/functions/_shared/pedirDeNovo.ts'

const antigo = (o: object) => ({ item_id: 'a', nome_item: 'X-Teste', quantidade: 2, preco_centavos_unitario: 1800, opcoes: [], ...o })
const atual = (o: object) => ({ id: 'a', nome: 'X-Teste', ativo: true, esgotado: false, preco_centavos: 1800, ...o })

describe('classificarItensPedirDeNovo', () => {
  test('igual: ok com a quantidade original', () => {
    const [l] = classificarItensPedirDeNovo([antigo({})], [atual({})])
    assert.deepEqual(l, { item_id: 'a', nome: 'X-Teste', quantidade: 2, status: 'ok', preco_atual_centavos: 1800, preco_antigo_centavos: 1800 })
  })
  test('preço mudou', () => {
    const [l] = classificarItensPedirDeNovo([antigo({})], [atual({ preco_centavos: 2000 })])
    assert.equal(l.status, 'preco_mudou')
    assert.equal(l.preco_atual_centavos, 2000)
  })
  test('esgotado, inativo e removido do cardápio', () => {
    assert.equal(classificarItensPedirDeNovo([antigo({})], [atual({ esgotado: true })])[0].status, 'esgotado')
    assert.equal(classificarItensPedirDeNovo([antigo({})], [atual({ ativo: false })])[0].status, 'indisponivel')
    assert.equal(classificarItensPedirDeNovo([antigo({})], [])[0].status, 'indisponivel')
  })
  test('item que tinha adicionais precisa ser escolhido de novo', () => {
    const [l] = classificarItensPedirDeNovo([antigo({ opcoes: [{ nome: 'Bacon' }] })], [atual({})])
    assert.equal(l.status, 'refazer_opcoes')
  })
  test('linha sem item_id (item apagado) é indisponível', () => {
    assert.equal(classificarItensPedirDeNovo([antigo({ item_id: null })], [atual({})])[0].status, 'indisponivel')
  })
})

import { decidirPerfil } from '../supabase/functions/_shared/perfilNoPedido.ts'

describe('decidirPerfil', () => {
  test('flag desligada: segue com ou sem sessão', () => {
    assert.deepEqual(decidirPerfil(false, null), { clienteId: null, bloqueado: false })
    assert.deepEqual(decidirPerfil(false, 'c1'), { clienteId: 'c1', bloqueado: false })
  })
  test('flag ligada: sem sessão válida bloqueia; com sessão segue', () => {
    assert.deepEqual(decidirPerfil(true, null), { clienteId: null, bloqueado: true })
    assert.deepEqual(decidirPerfil(true, 'c1'), { clienteId: 'c1', bloqueado: false })
  })
})
