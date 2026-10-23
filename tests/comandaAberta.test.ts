// Testes das regras puras da comanda aberta e da taxa de serviço. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  comandaAbertaLigada,
  modoUsaComanda,
  normalizarMesa,
  subtotalDaComanda,
  taxaPadraoMarcada,
  taxaServicoCentavos,
  totalDoFechamento,
} from '../src/lib/comandaAberta.ts'

test('normalizarMesa: formas diferentes da mesma mesa', () => {
  for (const t of ['5', '05', 'Mesa 5', 'Mesa 05', ' mesa  5 ', 'MESA5', 'mesa-5', 'Mesa: 5']) {
    assert.equal(normalizarMesa(t), '5', t)
  }
})

test('normalizarMesa: mesas diferentes e nomes', () => {
  assert.equal(normalizarMesa('15'), '15')
  assert.equal(normalizarMesa('Varanda 2'), 'varanda 2')
  assert.equal(normalizarMesa('Mesanino'), 'mesanino')
  assert.equal(normalizarMesa('Mesa Âmbar'), 'ambar')
  assert.equal(normalizarMesa('0'), '0')
  assert.equal(normalizarMesa('00'), '0')
  assert.equal(normalizarMesa(''), '')
  assert.equal(normalizarMesa('Mesa'), '')
  assert.equal(normalizarMesa(null as unknown as string), '')
})

test('taxaServicoCentavos: arredonda ao centavo, metade para cima', () => {
  assert.equal(taxaServicoCentavos(8750, 1000), 875)
  assert.equal(taxaServicoCentavos(1005, 1000), 101)
  assert.equal(taxaServicoCentavos(1004, 1000), 100)
  assert.equal(taxaServicoCentavos(8750, 0), 0)
  assert.equal(taxaServicoCentavos(8750, -5), 0)
  assert.equal(taxaServicoCentavos(0, 1000), 0)
})

test('subtotalDaComanda: ignora pedido cancelado e item removido', () => {
  const it = (quantidade: number, preco: number, removido?: boolean) => ({
    quantidade,
    preco_centavos_unitario: preco,
    removido,
  })
  assert.equal(subtotalDaComanda([]), 0)
  assert.equal(
    subtotalDaComanda([
      { status: 'pronto', itens: [it(2, 1000), it(1, 500, true)] },
      { status: 'cancelado', itens: [it(1, 9999)] },
      { status: 'novo', itens: [it(1, 250)] },
    ]),
    2250,
  )
})

test('totalDoFechamento: taxa à parte, desmarcada = 0', () => {
  assert.deepEqual(totalDoFechamento(10000, false, 1000), { taxaCentavos: 0, totalCentavos: 10000 })
  assert.deepEqual(totalDoFechamento(10000, true, 1000), { taxaCentavos: 1000, totalCentavos: 11000 })
  assert.deepEqual(totalDoFechamento(10000, true, 0), { taxaCentavos: 0, totalCentavos: 10000 })
})

test('interruptor da comanda', () => {
  assert.equal(comandaAbertaLigada(null), false)
  assert.equal(comandaAbertaLigada(undefined), false)
  assert.equal(comandaAbertaLigada({}), false)
  assert.equal(comandaAbertaLigada({ comanda_aberta_habilitada: true }), true)
  assert.equal(modoUsaComanda({ comanda_aberta_habilitada: true }, 'mesa'), true)
  assert.equal(modoUsaComanda({ comanda_aberta_habilitada: true }, 'balcao'), false)
  assert.equal(modoUsaComanda({ comanda_aberta_habilitada: false }, 'mesa'), false)
  assert.equal(modoUsaComanda(null, 'mesa'), false)
  assert.equal(modoUsaComanda({ comanda_aberta_habilitada: true }, null), false)
})

test('taxaPadraoMarcada: só true literal', () => {
  assert.equal(taxaPadraoMarcada({ taxa_servico_habilitada: true }), true)
  assert.equal(taxaPadraoMarcada({ taxa_servico_habilitada: false }), false)
  assert.equal(taxaPadraoMarcada({}), false)
})
