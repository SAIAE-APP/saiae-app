import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  calcularCashbackUsado,
  recebidoNosItensCentavos,
  textoCashbackGeradoDoPedido,
  textoCashbackUsadoDoPedido,
} from '../src/lib/descontosCashback.ts'

const ler = (c: string) => readFileSync(new URL(`../src/${c}`, import.meta.url), 'utf8')
const nbsp = /\s/g

describe('textos do pedido', () => {
  test('usado e gerado formatados, vazios quando zero ou ausente', () => {
    assert.equal(textoCashbackUsadoDoPedido({ cashback_usado_centavos: 500 }).replace(nbsp, ' '), 'Cashback usado: −R$ 5,00')
    assert.equal(textoCashbackGeradoDoPedido({ cashback_gerado_centavos: 200 }).replace(nbsp, ' '), 'Cashback gerado: R$ 2,00')
    assert.equal(textoCashbackUsadoDoPedido({ cashback_usado_centavos: 0 }), '')
    assert.equal(textoCashbackUsadoDoPedido({}), '')
    assert.equal(textoCashbackGeradoDoPedido({}), '')
  })
})

describe('calcularCashbackUsado', () => {
  test('pedido cancelado não conta', () => {
    const r = calcularCashbackUsado([
      { status: 'entregue', cashback_usado_centavos: 300 },
      { status: 'cancelado', cashback_usado_centavos: 900 },
      { status: 'pronto', cashback_usado_centavos: 0 },
      { status: 'pronto' },
      { status: 'a_fazer', cashback_usado_centavos: 200 },
    ])
    assert.deepEqual(r, { quantidade: 2, valor: 500 })
  })
})

describe('recebidoNosItensCentavos', () => {
  test('desconta cupom e saldo, nunca negativo', () => {
    assert.equal(recebidoNosItensCentavos(10000, 500, 0), 9500)
    assert.equal(recebidoNosItensCentavos(10000, 0, 700), 9300)
    assert.equal(recebidoNosItensCentavos(100, 500, 0), 0)
  })
})

describe('telas', () => {
  test('o relatório mostra o saldo em aberto e as cinco linhas', () => {
    const painel = ler('components/PainelRelatorio.tsx')
    assert.match(painel, /Saldo em aberto/)
    for (const t of ['Concedido', 'Usado', 'Vencido', 'Estornado']) assert.match(painel, new RegExp(t))
  })
  test('Recebido nos itens desconta cupom E saldo', () => {
    assert.match(ler('components/PainelRelatorio.tsx'), /recebidoNosItensCentavos\(/)
  })
  test('Histórico e DetalheComanda mostram as linhas; a planilha ganha as colunas', () => {
    for (const a of ['pages/Historico.tsx', 'components/DetalheComanda.tsx']) {
      const s = ler(a)
      assert.match(s, /textoCashbackUsadoDoPedido/)
      assert.match(s, /textoCashbackGeradoDoPedido/)
    }
    const h = ler('pages/Historico.tsx')
    assert.match(h, /header: 'Cashback usado'/)
    assert.match(h, /header: 'Cashback gerado'/)
  })
  test('o resumo do cashback é best-effort e não derruba o relatório', () => {
    assert.match(ler('hooks/useRelatorio.ts'), /carregarResumoCashback\([^)]*\)\s*\.catch\(\(\) => null\)/)
  })
  test('PedidoComItens ganhou os dois campos opcionais', () => {
    const t = ler('types/database.ts')
    assert.match(t, /cashback_usado_centavos\?: number/)
    assert.match(t, /cashback_gerado_centavos\?: number/)
  })
})
