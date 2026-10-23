// Taxa de serviço nos relatórios/Caixa e classificação de pedido de comanda aberta. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularDivisaoPorMetodo, somarTaxasServico } from '../src/lib/relatorio.ts'
import type { PedidoComItens } from '../src/types/database.ts'

const de = new Date('2026-10-23T03:00:00.000Z')
const ate = new Date('2026-10-24T02:59:59.999Z')
const c = (fechada_em: string, taxa: number, metodo: string | null) => ({
  fechada_em,
  taxa_servico_centavos: taxa,
  metodo_pagamento: metodo,
})

test('somarTaxasServico: soma só dentro do período e separa por método', () => {
  const r = somarTaxasServico(
    [
      c('2026-10-23T15:00:00.000Z', 1000, 'dinheiro'),
      c('2026-10-23T16:00:00.000Z', 500, 'dinheiro'),
      c('2026-10-23T17:00:00.000Z', 300, 'pix'),
      c('2026-10-22T20:00:00.000Z', 999, 'dinheiro'), // antes
      c('2026-10-24T10:00:00.000Z', 999, 'credito'), // depois
    ],
    de,
    ate,
  )
  assert.equal(r.totalCentavos, 1800)
  assert.deepEqual(r.porMetodo, { dinheiro: 1500, pix: 300 })
})

test('somarTaxasServico: limites inclusivos nas duas pontas', () => {
  const r = somarTaxasServico(
    [c(de.toISOString(), 100, 'debito'), c(ate.toISOString(), 200, 'debito')],
    de,
    ate,
  )
  assert.equal(r.totalCentavos, 300)
})

test('somarTaxasServico: taxa 0 não vira linha; método nulo vira nao_informado', () => {
  const r = somarTaxasServico(
    [c('2026-10-23T15:00:00.000Z', 0, 'dinheiro'), c('2026-10-23T15:00:00.000Z', 250, null)],
    de,
    ate,
  )
  assert.deepEqual(r.porMetodo, { nao_informado: 250 })
  assert.equal(somarTaxasServico([], de, ate).totalCentavos, 0)
})

test('relatório: pedido na_entrega de Mesa em comanda aberta não entra em forma de pagamento', () => {
  const pedido = {
    status: 'a_fazer',
    metodo_pagamento: 'na_entrega',
    comanda_id: 'c1',
    mesa: '5',
    itens_do_pedido: [{ removido: false, preco_centavos_unitario: 1000, quantidade: 2 }],
  } as unknown as PedidoComItens
  const d = calcularDivisaoPorMetodo([pedido])
  assert.equal(d.na_entrega.total, 2000)
  for (const m of ['dinheiro', 'debito', 'credito', 'pix', 'gratis', 'nao_informado'] as const) {
    assert.equal(d[m].total, 0, m)
    assert.equal(d[m].quantidade, 0, m)
  }
})
