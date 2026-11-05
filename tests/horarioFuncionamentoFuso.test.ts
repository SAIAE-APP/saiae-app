import assert from 'node:assert/strict'
import { test } from 'node:test'
import { statusFuncionamento, type HorarioPublico } from '../src/lib/horarioFuncionamento.ts'

// Sexta e sábado 18:00–02:00 (cruza a meia-noite); o resto fechado.
const virada: HorarioPublico[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  dia_semana: d,
  aberto: d === 5 || d === 6,
  hora_abertura: d === 5 || d === 6 ? '18:00:00' : null,
  hora_fechamento: d === 5 || d === 6 ? '02:00:00' : null,
}))

// 2026-10-31 é sábado. São Paulo = UTC-3, Manaus = UTC-4, Rio Branco = UTC-5.
const aberto = (iso: string, fuso: string) => statusFuncionamento(virada, new Date(iso), fuso)?.aberto

test('janela que cruza a meia-noite no fuso de Brasília', () => {
  assert.equal(aberto('2026-10-31T04:00:00Z', 'America/Sao_Paulo'), true) // sáb 01:00 (janela de sexta)
  assert.equal(aberto('2026-10-31T05:30:00Z', 'America/Sao_Paulo'), false) // sáb 02:30
  assert.equal(aberto('2026-10-31T20:00:00Z', 'America/Sao_Paulo'), false) // sáb 17:00, antes de abrir
  assert.equal(aberto('2026-10-31T21:30:00Z', 'America/Sao_Paulo'), true) // sáb 18:30
})

test('mesmo instante, fusos diferentes, resultados diferentes', () => {
  const instante = '2026-10-31T05:30:00Z'
  assert.equal(aberto(instante, 'America/Sao_Paulo'), false) // 02:30 de sábado
  assert.equal(aberto(instante, 'America/Manaus'), true) // 01:30 de sábado
  assert.equal(aberto(instante, 'America/Rio_Branco'), true) // 00:30 de sábado
})

test('fuso atrasado ainda está no dia anterior (Rio Branco, sexta 23:00)', () => {
  assert.equal(aberto('2026-10-31T04:00:00Z', 'America/Rio_Branco'), true)
  assert.match(statusFuncionamento(virada, new Date('2026-10-31T04:00:00Z'), 'America/Rio_Branco')?.texto ?? '', /fecha às 02:00/)
})

test('o relógio/fuso do visitante não muda o resultado quando há fuso da barraca', () => {
  const original = process.env.TZ
  try {
    const resultados = ['Asia/Tokyo', 'America/Los_Angeles', 'UTC'].map((tz) => {
      process.env.TZ = tz
      return JSON.stringify(statusFuncionamento(virada, new Date('2026-10-31T05:30:00Z'), 'America/Manaus'))
    })
    assert.equal(new Set(resultados).size, 1)
    assert.equal(JSON.parse(resultados[0]).aberto, true)
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
})

test('meia-noite exata no fuso da barraca é hora 0, não 24', () => {
  // sábado 00:00 em Manaus (04:00Z): ainda dentro da janela de sexta.
  assert.equal(aberto('2026-10-31T04:00:00Z', 'America/Manaus'), true)
})
