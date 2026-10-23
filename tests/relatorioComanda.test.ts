// Taxa de serviço nos relatórios/Caixa e classificação de pedido de comanda aberta. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularDivisaoPorMetodo, pedidosDinheiroDoCaixa, somarTaxasServico } from '../src/lib/relatorio.ts'
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

const dCaixa = new Date('2026-10-23T12:00:00.000Z')
const aCaixa = new Date('2026-10-23T20:00:00.000Z')
const ped = (id: string, criado: string, comanda: string | null, metodo = 'dinheiro') =>
  ({
    id,
    status: 'a_fazer',
    metodo_pagamento: metodo,
    comanda_id: comanda,
    criado_em: criado,
    itens_do_pedido: [],
  }) as unknown as PedidoComItens

test('caixa: rodada antes da janela + comanda fechada na janela conta uma vez', () => {
  const r = pedidosDinheiroDoCaixa(
    [ped('p1', '2026-10-23T10:00:00.000Z', 'c1')],
    [{ id: 'c1', fechada_em: '2026-10-23T15:00:00.000Z' }],
    dCaixa,
    aCaixa,
  )
  assert.deepEqual(r.map((p) => p.id), ['p1'])
})

test('caixa: rodada na janela + comanda fechada na janela conta uma vez (sem duplicar)', () => {
  const p = ped('p2', '2026-10-23T13:00:00.000Z', 'c1')
  const r = pedidosDinheiroDoCaixa([p, p], [{ id: 'c1', fechada_em: '2026-10-23T15:00:00.000Z' }], dCaixa, aCaixa)
  assert.equal(r.length, 1)
})

test('caixa: comanda fechada depois da janela, rodada antes dela, não conta', () => {
  const r = pedidosDinheiroDoCaixa(
    [ped('p3', '2026-10-23T10:00:00.000Z', 'c1', 'na_entrega')],
    [{ id: 'c1', fechada_em: '2026-10-23T22:00:00.000Z' }],
    dCaixa,
    aCaixa,
  )
  assert.equal(r.length, 0)
})

test('caixa: débito, crédito e pix nunca contam como dinheiro', () => {
  const r = pedidosDinheiroDoCaixa(
    ['debito', 'credito', 'pix'].map((m, i) => ped(`q${i}`, '2026-10-23T13:00:00.000Z', 'c1', m)),
    [{ id: 'c1', fechada_em: '2026-10-23T15:00:00.000Z' }],
    dCaixa,
    aCaixa,
  )
  assert.equal(r.length, 0)
})
