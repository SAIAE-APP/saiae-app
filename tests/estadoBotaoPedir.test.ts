import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoBotaoPedir, lojaAberta, podeFinalizarPedido } from '../src/lib/estadoBotaoPedir.ts'
import { statusFuncionamento, type HorarioPublico } from '../src/lib/horarioFuncionamento.ts'

const base = { esgotado: false, lojaAberta: true, podeAdicionar: true, comOpcoes: false, quantidade: 0 }

describe('lojaAberta', () => {
  test('null é sempre aberta', () => assert.equal(lojaAberta(null), true))
  test('respeita o status', () => {
    assert.equal(lojaAberta({ aberto: true }), true)
    assert.equal(lojaAberta({ aberto: false }), false)
  })
})

describe('podeFinalizarPedido (loja fechada nunca prende o cliente)', () => {
  test('aberta finaliza; fechada não finaliza, mas o item com opções segue removível pelo pedido', () => {
    assert.equal(podeFinalizarPedido(true), true)
    assert.equal(podeFinalizarPedido(false), false)
  })

  test('fechada com item simples no carrinho: stepper visível e só diminui', () => {
    const e = estadoBotaoPedir({ ...base, lojaAberta: false, quantidade: 3 })
    assert.equal(e.tipo, 'contador')
    assert.equal(e.podeDiminuir, true)
    assert.equal(e.podeAumentar, false)
  })
})

describe('estadoBotaoPedir', () => {
  test('esgotado vence tudo', () => {
    for (const extra of [{}, { quantidade: 2 }, { lojaAberta: false }]) {
      const e = estadoBotaoPedir({ ...base, esgotado: true, ...extra })
      assert.equal(e.tipo, 'esgotado')
      assert.equal(e.desabilitado, true)
    }
  })

  test('item simples e item com opções', () => {
    assert.deepEqual(
      [estadoBotaoPedir(base).tipo, estadoBotaoPedir(base).desabilitado],
      ['adicionar', false],
    )
    assert.equal(estadoBotaoPedir({ ...base, comOpcoes: true }).tipo, 'escolher')
  })

  test('com quantidade vira contador e aumenta/diminui', () => {
    const e = estadoBotaoPedir({ ...base, quantidade: 2 })
    assert.equal(e.tipo, 'contador')
    assert.equal(e.podeAumentar, true)
    assert.equal(e.podeDiminuir, true)
  })

  test('loja fechada com item no carrinho: diminui, não aumenta', () => {
    const e = estadoBotaoPedir({ ...base, quantidade: 2, lojaAberta: false })
    assert.equal(e.tipo, 'contador')
    assert.equal(e.podeAumentar, false)
    assert.equal(e.podeDiminuir, true)
  })

  test('loja fechada sem quantidade: fechado desabilitado', () => {
    const e = estadoBotaoPedir({ ...base, lojaAberta: false })
    assert.equal(e.tipo, 'fechado')
    assert.equal(e.desabilitado, true)
  })

  test('preço zero com pagamento online: desabilitado, também com opções', () => {
    for (const comOpcoes of [false, true]) {
      const e = estadoBotaoPedir({ ...base, podeAdicionar: false, comOpcoes })
      assert.equal(e.tipo, comOpcoes ? 'escolher' : 'adicionar')
      assert.equal(e.desabilitado, true)
    }
  })

  test('preço zero com quantidade: não aumenta', () => {
    assert.equal(estadoBotaoPedir({ ...base, podeAdicionar: false, quantidade: 1 }).podeAumentar, false)
  })
})

describe('loja aberta com janela que cruza a meia-noite', () => {
  const horarios: HorarioPublico[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dia_semana: d,
    aberto: d === 5 || d === 6,
    hora_abertura: d === 5 || d === 6 ? '18:00' : null,
    hora_fechamento: d === 5 || d === 6 ? '02:00' : null,
  }))
  // 2026-10-31 é sábado.
  const sabado = (h: number) => new Date(2026, 9, 31, h, 0)

  test('sábado 01:00 vale a janela de sexta: aberta', () => {
    assert.equal(lojaAberta(statusFuncionamento(horarios, sabado(1))), true)
  })
  test('sábado 03:00: fechada', () => {
    assert.equal(lojaAberta(statusFuncionamento(horarios, sabado(3))), false)
  })
  test('sem horários cadastrados: aberta', () => {
    assert.equal(lojaAberta(statusFuncionamento([], sabado(3))), true)
  })
})
