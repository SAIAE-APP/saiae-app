// Testes das regras puras da comanda aberta e da taxa de serviço. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agruparComandas,
  comandaAbertaLigada,
  criarDebounce,
  modoUsaComanda,
  normalizarMesa,
  subtotalDaComanda,
  taxaPadraoMarcada,
  taxaServicoCentavos,
  textoBotaoEnviar,
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

test('textoBotaoEnviar: não repete "Mesa" quando o operador já digitou', () => {
  assert.equal(textoBotaoEnviar(true, 'Mesa 5', false), 'Abrir comanda da Mesa 5')
  assert.equal(textoBotaoEnviar(true, 'mesa-5', true), 'Adicionar à comanda da Mesa 5')
  assert.equal(textoBotaoEnviar(true, 'MESA: 5', true), 'Adicionar à comanda da Mesa 5')
  assert.equal(textoBotaoEnviar(true, ' 5 ', false), 'Abrir comanda da Mesa 5')
  assert.equal(textoBotaoEnviar(true, 'Mesanino', false), 'Abrir comanda da Mesa Mesanino')
})

test('agruparComandas: duas rodadas viram uma comanda com subtotal somado, da mais antiga à mais nova', () => {
  const item = (q: number, p: number, removido = false) => ({ nome_item: 'X', quantidade: q, preco_centavos_unitario: p, removido })
  const linhas = [
    { comanda_id: 'b', mesa: '7', aberta_em: '2026-10-23T12:00:00Z', pedido_id: 'p3', senha: 3, criado_em: '2026-10-23T12:00:00Z', status: 'a_fazer', itens: [item(1, 500)] },
    { comanda_id: 'a', mesa: '5', aberta_em: '2026-10-23T11:00:00Z', pedido_id: 'p2', senha: 2, criado_em: '2026-10-23T11:30:00Z', status: 'pronto', itens: [item(2, 1000), item(1, 300, true)] },
    { comanda_id: 'a', mesa: '5', aberta_em: '2026-10-23T11:00:00Z', pedido_id: 'p1', senha: 1, criado_em: '2026-10-23T11:00:00Z', status: 'a_fazer', itens: [item(1, 250)] },
    { comanda_id: 'a', mesa: '5', aberta_em: '2026-10-23T11:00:00Z', pedido_id: 'p9', senha: 9, criado_em: '2026-10-23T11:40:00Z', status: 'cancelado', itens: [item(9, 9999)] },
  ]
  const r = agruparComandas(linhas)
  assert.deepEqual(r.map((c) => c.id), ['a', 'b'])
  assert.equal(r[0].subtotalCentavos, 2250)
  assert.deepEqual(r[0].rodadas.map((x) => x.pedidoId), ['p1', 'p2'])
  assert.equal(r[0].rodadas[1].itens.length, 1)
  assert.equal(r[1].subtotalCentavos, 500)
})

test('agruparComandas: comanda só com rodada cancelada continua listada, com total zero', () => {
  const r = agruparComandas([
    { comanda_id: 'c', mesa: '1', aberta_em: '2026-10-23T10:00:00Z', pedido_id: 'p', senha: 1, criado_em: '2026-10-23T10:00:00Z', status: 'cancelado', itens: [{ nome_item: 'X', quantidade: 1, preco_centavos_unitario: 100, removido: false }] },
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].subtotalCentavos, 0)
  assert.equal(r[0].rodadas.length, 0)
})

test('criarDebounce: rajada vira uma chamada só; cancelar impede', async () => {
  let n = 0
  const d = criarDebounce(() => n++, 20)
  d(); d(); d()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(n, 1)
  d(); d.cancelar()
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(n, 1)
})

test('humanizarMetodoDoPedido: rodada de comanda aberta não é "A definir na entrega"', async () => {
  const { humanizarMetodoDoPedido } = await import('../src/lib/metodoPagamento.ts')
  assert.equal(humanizarMetodoDoPedido('na_entrega', true), 'Comanda aberta')
  assert.equal(humanizarMetodoDoPedido('na_entrega', false), 'A definir na entrega')
  assert.equal(humanizarMetodoDoPedido('pix', true), 'Pix')
  assert.equal(humanizarMetodoDoPedido(null, true), 'Método não informado')
})

test('useComandasAbertas: tópico do Realtime é único por execução do efeito (StrictMode monta duas vezes)', async () => {
  const { readFileSync } = await import('node:fs')
  const s = readFileSync(new URL('../src/hooks/useComandas.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(s, /useId/)
  const efeito = s.slice(s.indexOf('supabase.channel('), s.indexOf('supabase.channel(') + 80)
  assert.match(efeito, /\+\+sequenciaCanal/)
})
