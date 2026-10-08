import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calcularEsperaMediaFila } from '../src/lib/esperaMedia.ts'

const agora = new Date(2026, 9, 7, 14, 0, 0) // 07/10/2026 14:00 local
const minAtras = (min: number, dias = 0) => new Date(agora.getTime() - min * 60000 - dias * 86400000).toISOString()
const p = (status: string, criado_em: string) => ({ status, criado_em })

test('sem fila de hoje devolve null', () => {
  assert.equal(calcularEsperaMediaFila([], agora), null)
  assert.equal(calcularEsperaMediaFila([p('pronto', minAtras(10))], agora), null)
})

test('média dos pedidos a fazer de hoje', () => {
  assert.equal(calcularEsperaMediaFila([p('a_fazer', minAtras(10)), p('a_fazer', minAtras(20))], agora), 15)
})

test('ignora pedido de dia anterior esquecido em aberto (o 1152 min)', () => {
  const pedidos = [p('a_fazer', minAtras(10)), p('a_fazer', minAtras(20)), p('a_fazer', minAtras(1152, 0)), p('a_fazer', minAtras(5, 1))]
  // 1152 min atrás de 14:00 cai no dia anterior; o de ontem também
  assert.equal(calcularEsperaMediaFila(pedidos, agora), 15)
  assert.equal(calcularEsperaMediaFila([p('a_fazer', minAtras(5, 1))], agora), null)
})

test('pedido atrasado de hoje continua contando', () => {
  // 13 h da manhã de hoje ainda na fila: 5 h de espera entra na média
  const cedo = new Date(2026, 9, 7, 9, 0, 0).toISOString() // 5 h antes de 14:00
  assert.equal(calcularEsperaMediaFila([p('a_fazer', minAtras(10)), p('a_fazer', cedo)], agora), Math.round((10 + 300) / 2))
})

test('não conta cancelado, pronto nem entregue', () => {
  const pedidos = [p('a_fazer', minAtras(10)), p('cancelado', minAtras(50)), p('pronto', minAtras(60)), p('entregue', minAtras(70))]
  assert.equal(calcularEsperaMediaFila(pedidos, agora), 10)
})

test('relógio adiantado não gera espera negativa', () => {
  const futuro = new Date(agora.getTime() + 5 * 60000).toISOString()
  assert.equal(calcularEsperaMediaFila([p('a_fazer', futuro)], agora), 0)
})
