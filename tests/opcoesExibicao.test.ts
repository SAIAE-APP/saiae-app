// SAI-010b: exibição, impressão e relatório de variações e adicionais. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nomeComOpcoes, nomesDasOpcoes, textoOpcoes } from '../src/lib/opcoes.ts'
import { calcularOpcoesVendidas } from '../src/lib/opcoesRelatorio.ts'
import type { PedidoComItens } from '../src/types/database.ts'

const OPCOES = [
  { grupo_nome: 'Tamanho', tipo: 'variacao', nome: 'Grande', preco_centavos: 1200 },
  { grupo_nome: 'Extras', tipo: 'adicional', nome: 'Ovo', preco_centavos: 200 },
]

describe('texto das opções', () => {
  test('junta os nomes na ordem; nome composto no parêntese', () => {
    assert.equal(textoOpcoes(OPCOES), 'Grande, Ovo')
    assert.equal(nomeComOpcoes('Pastel', OPCOES), 'Pastel (Grande, Ovo)')
  })
  test('pedido antigo ou lixo no jsonb não quebra', () => {
    for (const v of [undefined, null, [], 'x', 3, {}, [null, 1, { nome: 5 }, { nome: '  ' }]]) {
      assert.equal(textoOpcoes(v), '')
      assert.equal(nomeComOpcoes('Pastel', v), 'Pastel')
    }
  })
  test('nomes individuais (comanda térmica) preservam vírgula no nome', () => {
    assert.deepEqual(nomesDasOpcoes([{ nome: 'Queijo, bacon' }, { nome: 'Ovo' }]), ['Queijo, bacon', 'Ovo'])
  })
})

const item = (over: Record<string, unknown>) =>
  ({ id: 'x', pedido_id: 'p', barraca_id: 'b', item_id: 'i1', nome_item: 'Pastel', quantidade: 1, removido: false,
    removido_em: null, motivo_remocao: null, entregue: false, entregue_em: null, entrega_direta: false,
    preco_centavos_unitario: 1400, observacao: null, opcoes: OPCOES, ...over })
const pedido = (status: string, itens: unknown[]) => ({ status, itens_do_pedido: itens }) as unknown as PedidoComItens

describe('calcularOpcoesVendidas', () => {
  test('soma por opção usando o snapshot; ignora cancelado, removido e item simples', () => {
    const r = calcularOpcoesVendidas([
      pedido('entregue', [item({ quantidade: 2 }), item({ removido: true }), item({ opcoes: [] })]),
      pedido('cancelado', [item({ quantidade: 5 })]),
      pedido('pronto', [item({ quantidade: 1, opcoes: [OPCOES[0]] })]),
    ])
    const grande = r.find((o) => o.nome === 'Grande')!
    const ovo = r.find((o) => o.nome === 'Ovo')!
    assert.deepEqual([grande.quantidade_total, grande.valor_total, grande.tipo], [3, 3600, 'variacao'])
    assert.deepEqual([ovo.quantidade_total, ovo.valor_total, ovo.tipo], [2, 400, 'adicional'])
    assert.equal(r[0].nome, 'Grande')
  })
  test('pedido sem a coluna opcoes (antigo) não conta nem quebra', () => {
    assert.deepEqual(calcularOpcoesVendidas([pedido('entregue', [item({ opcoes: undefined })])]), [])
  })
})
