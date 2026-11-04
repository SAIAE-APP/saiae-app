// Soma e seleção de vários produtos/categorias (Faturamento e Histórico). Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agregarProdutosIsolados,
  calcularSerieItemPorDia,
  pedidoTemItemSelecionado,
} from '../src/lib/relatorio.ts'
import {
  alternarCategoria,
  alternarProduto,
  estadoDaCategoria,
  rotuloDaSelecao,
} from '../src/lib/selecaoProdutos.ts'
import type { PedidoComItens } from '../src/types/database.ts'

type ItemFake = { item_id: string; q: number; preco: number; removido?: boolean }

function pedido(status: string, itens: ItemFake[], dia = '2026-11-04'): PedidoComItens {
  return {
    id: `p-${Math.random()}`,
    status,
    data_operacao: dia,
    criado_em: `${dia}T15:00:00.000Z`,
    itens_do_pedido: itens.map((i) => ({
      item_id: i.item_id,
      quantidade: i.q,
      preco_centavos_unitario: i.preco,
      removido: i.removido ?? false,
    })),
  } as unknown as PedidoComItens
}

const INTERVALO = { inicio: '2026-11-04', fim: '2026-11-04' }

test('agregarProdutosIsolados soma só os ids marcados e ignora cancelado e item removido', () => {
  const pedidos = [
    pedido('entregue', [
      { item_id: 'a', q: 2, preco: 500 },
      { item_id: 'b', q: 1, preco: 1200 },
      { item_id: 'c', q: 9, preco: 100 },
    ]),
    pedido('cancelado', [{ item_id: 'a', q: 5, preco: 500 }]),
    pedido('entregue', [{ item_id: 'b', q: 3, preco: 1200, removido: true }]),
  ]
  const r = agregarProdutosIsolados(pedidos, new Set(['a', 'b']), INTERVALO)
  assert.equal(r.totalIsolado, 2 * 500 + 1200)
  assert.equal(r.unidadesVendidas, 3)
})

test('comanda com dois itens marcados soma os dois itens na série do dia', () => {
  const pedidos = [
    pedido('entregue', [
      { item_id: 'a', q: 2, preco: 500 },
      { item_id: 'b', q: 1, preco: 1200 },
    ]),
  ]
  const pontos = calcularSerieItemPorDia(pedidos, new Set(['a', 'b']), '2026-11-04', '2026-11-04')
  assert.equal(pontos.length, 1)
  assert.equal(pontos[0].valor, 2200)
  assert.equal(pontos[0].quantidade, 3)
})

test('pedidoTemItemSelecionado: verdadeiro com item marcado, falso se ele está removido', () => {
  const ok = pedido('entregue', [{ item_id: 'a', q: 1, preco: 100 }])
  const removido = pedido('entregue', [{ item_id: 'a', q: 1, preco: 100, removido: true }])
  assert.equal(pedidoTemItemSelecionado(ok, new Set(['a'])), true)
  assert.equal(pedidoTemItemSelecionado(ok, new Set(['z'])), false)
  assert.equal(pedidoTemItemSelecionado(removido, new Set(['a'])), false)
})

test('estadoDaCategoria cobre nenhum, alguns e todos', () => {
  const cat = ['a', 'b']
  assert.equal(estadoDaCategoria(new Set(), cat), 'nenhum')
  assert.equal(estadoDaCategoria(new Set(['a']), cat), 'alguns')
  assert.equal(estadoDaCategoria(new Set(['a', 'b', 'x']), cat), 'todos')
})

test('alternarCategoria marca tudo (nenhum/alguns) e desmarca tudo (todos) sem tocar em outras categorias', () => {
  const cat = ['a', 'b']
  assert.deepEqual([...alternarCategoria(new Set(['x']), cat)].sort(), ['a', 'b', 'x'])
  assert.deepEqual([...alternarCategoria(new Set(['a']), cat)].sort(), ['a', 'b'])
  assert.deepEqual([...alternarCategoria(new Set(['a', 'b', 'x']), cat)], ['x'])
})

test('alternarProduto não muta o conjunto recebido', () => {
  const original = new Set(['a'])
  const novo = alternarProduto(original, 'b')
  assert.deepEqual([...original], ['a'])
  assert.deepEqual([...novo].sort(), ['a', 'b'])
  assert.deepEqual([...alternarProduto(novo, 'a')], ['b'])
})

test('rotuloDaSelecao: null sem seleção, nome com um, "N produtos" com vários', () => {
  const nomes = new Map([
    ['a', 'Coca 350ml'],
    ['b', 'PF Frango'],
    ['c', 'PF Carne'],
  ])
  assert.equal(rotuloDaSelecao(new Set(), nomes), null)
  assert.equal(rotuloDaSelecao(new Set(['b']), nomes), 'PF Frango')
  assert.equal(rotuloDaSelecao(new Set(['a', 'b', 'c']), nomes), '3 produtos')
})
