// Regras puras da leitura de barraca e do painel (src/lib/adminBarracaLeitura.ts e adminBarracas.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { agruparFaturamento } from '../src/lib/adminBarracaLeitura.ts'
import { quedaDePedidos, rotuloDia, temAlerta, textoDiasRestantes, versaoMaisUsada, type AdminSaude } from '../src/lib/adminBarracas.ts'

describe('agruparFaturamento', () => {
  test('soma por dia, mais recente primeiro, com as formas de pagamento', () => {
    const dias = agruparFaturamento([
      { dia: '2026-10-16', metodo_pagamento: 'pix', pedidos: '2', total_centavos: '2500' },
      { dia: '2026-10-17', metodo_pagamento: 'dinheiro', pedidos: 1, total_centavos: 700 },
      { dia: '2026-10-17', metodo_pagamento: 'pix', pedidos: 3, total_centavos: 4000 },
    ])
    assert.deepEqual(dias.map((d) => d.dia), ['2026-10-17', '2026-10-16'])
    assert.equal(dias[0].total, 4700)
    assert.equal(dias[0].pedidos, 4)
    assert.deepEqual(dias[0].metodos.map((m) => m.metodo), ['dinheiro', 'pix'])
  })
  test('vazio', () => assert.deepEqual(agruparFaturamento([]), []))
})

const saude = (p: Partial<AdminSaude>): AdminSaude => ({
  barraca_id: 'b', nome: 'B', slug: 'b', versao_app: null, plataforma: null, versao_vista_em: null,
  pedidos_7d: 0, pedidos_semana_anterior: 0, erros_24h: 0, ...p,
})

describe('painel', () => {
  test('queda de pedidos: menos da metade da semana anterior, com base mínima de 5', () => {
    assert.equal(quedaDePedidos(saude({ pedidos_7d: 4, pedidos_semana_anterior: 10 })), true)
    assert.equal(quedaDePedidos(saude({ pedidos_7d: 5, pedidos_semana_anterior: 10 })), false)
    assert.equal(quedaDePedidos(saude({ pedidos_7d: 0, pedidos_semana_anterior: 4 })), false)
  })
  test('versão mais usada ignora quem não reportou', () => {
    assert.equal(versaoMaisUsada([saude({ versao_app: 'a' }), saude({ versao_app: 'b' }), saude({ versao_app: 'b' }), saude({})]), 'b')
    assert.equal(versaoMaisUsada([saude({})]), null)
  })
  test('temAlerta', () => {
    assert.equal(temAlerta({ parou: [], pico_erros: [], webhook_falhas: 0 }), false)
    assert.equal(temAlerta({ parou: [], pico_erros: [], webhook_falhas: 1 }), true)
  })
  test('rótulos', () => {
    assert.equal(rotuloDia('2026-10-17'), '17/10')
    assert.equal(textoDiasRestantes(null), 'sem prazo')
    assert.equal(textoDiasRestantes(-3), 'venceu há 3 d')
    assert.equal(textoDiasRestantes(0), 'vence hoje')
    assert.equal(textoDiasRestantes(5), '5 d')
  })
})
