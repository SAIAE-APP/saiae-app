import assert from 'node:assert/strict'
import { test } from 'node:test'
import { statusFuncionamento, type HorarioPublico } from '../src/lib/horarioFuncionamento.ts'
import {
  abertoNoDiaEMinuto,
  barracaAbertaAgora,
  diaEMinutoNoFuso,
  foraDoHorarioBloqueado,
  type HorarioDia,
} from '../supabase/functions/_shared/horario.ts'

const dia = (dia_semana: number, abertura: string | null, fechamento: string | null, aberto = true): HorarioDia => ({
  dia_semana,
  aberto,
  hora_abertura: abertura,
  hora_fechamento: fechamento,
})

const CASOS: Record<string, HorarioDia[]> = {
  comercial: [1, 2, 3, 4, 5].map((d) => dia(d, '09:00:00', '18:00:00')).concat([0, 6].map((d) => dia(d, null, null, false))),
  viradaDaMeiaNoite: [5, 6].map((d) => dia(d, '18:00:00', '02:00:00')).concat([0, 1, 2, 3, 4].map((d) => dia(d, null, null, false))),
  vinteEQuatroHoras: [0, 1, 2, 3, 4, 5, 6].map((d) => dia(d, '00:00:00', '00:00:00')),
  abertoSemHoras: [dia(1, null, null, true)],
  umDiaSo: [dia(3, '11:30:00', '14:00:00')],
}

test('o servidor decide igual ao cardápio em todos os dias e minutos', () => {
  for (const [nome, horarios] of Object.entries(CASOS)) {
    const publico = horarios as HorarioPublico[]
    // 2026-10-04 é domingo: dia d = 4 + d, hora/minuto locais (statusFuncionamento usa getDay/getHours locais)
    for (let d = 0; d < 7; d++) {
      for (let minutos = 0; minutos < 24 * 60; minutos += 7) {
        const agora = new Date(2026, 9, 4 + d, Math.floor(minutos / 60), minutos % 60)
        const front = statusFuncionamento(publico, agora)
        // sem horário útil o front devolve null e o servidor não restringe (true)
        const esperado = front === null ? true : front.aberto
        assert.equal(abertoNoDiaEMinuto(horarios, d, minutos), esperado, `${nome} dia ${d} minuto ${minutos}`)
      }
    }
  }
})

test('sem horário cadastrado ou sem nenhum dia aberto não restringe', () => {
  assert.equal(abertoNoDiaEMinuto([], 2, 600), true)
  assert.equal(abertoNoDiaEMinuto([dia(1, null, null, false)], 2, 600), true)
})

test('janela que vira a meia-noite vale de madrugada no dia seguinte', () => {
  const h = CASOS.viradaDaMeiaNoite
  assert.equal(abertoNoDiaEMinuto(h, 6, 60), true) // sábado 01:00 (janela de sexta)
  assert.equal(abertoNoDiaEMinuto(h, 6, 3 * 60), false) // sábado 03:00
  assert.equal(abertoNoDiaEMinuto(h, 0, 60), true) // domingo 01:00 (janela de sábado)
  assert.equal(abertoNoDiaEMinuto(h, 1, 60), false) // segunda 01:00
})

test('fuso da barraca: o mesmo instante dá dia e hora diferentes', () => {
  const instante = new Date('2026-10-07T02:30:00Z') // quarta 02:30 UTC
  assert.deepEqual(diaEMinutoNoFuso(instante, 'America/Sao_Paulo'), { dia: 2, minutos: 23 * 60 + 30 }) // terça 23:30
  assert.deepEqual(diaEMinutoNoFuso(instante, 'America/Manaus'), { dia: 2, minutos: 22 * 60 + 30 }) // terça 22:30
  assert.deepEqual(diaEMinutoNoFuso(instante, 'Asia/Tokyo'), { dia: 3, minutos: 11 * 60 + 30 }) // quarta 11:30
  // fuso inválido ou ausente cai em America/Sao_Paulo
  assert.deepEqual(diaEMinutoNoFuso(instante, 'Nao/Existe'), { dia: 2, minutos: 23 * 60 + 30 })
  assert.deepEqual(diaEMinutoNoFuso(instante, null), { dia: 2, minutos: 23 * 60 + 30 })
})

test('barracaAbertaAgora usa o fuso da barraca', () => {
  const quarta = [dia(2, '09:00:00', '23:45:00')] // terça 09:00–23:45
  const instante = new Date('2026-10-07T02:30:00Z') // terça 23:30 em São Paulo, 22:30 em Manaus
  assert.equal(barracaAbertaAgora(quarta, 'America/Sao_Paulo', instante), true)
  assert.equal(barracaAbertaAgora(quarta, 'America/Manaus', instante), true)
  assert.equal(barracaAbertaAgora(quarta, 'Asia/Tokyo', instante), false) // quarta 11:30 lá: terça fechada
})

test('foraDoHorarioBloqueado: só bloqueia com o interruptor ligado e a barraca fechada', async () => {
  const clienteCom = (data: HorarioDia[] | null, error: { message: string } | null = null) => ({
    from: () => ({ select: () => ({ eq: async () => ({ data, error }) }) }),
  })
  const horarios = [dia(2, '09:00:00', '18:00:00')] // terça 09–18
  const terca10h = new Date('2026-10-06T13:00:00Z') // 10:00 em São Paulo
  const terca20h = new Date('2026-10-06T23:00:00Z') // 20:00 em São Paulo
  const ligada = { id: 'b', bloquear_fora_do_horario: true, fuso: 'America/Sao_Paulo' }

  assert.equal(await foraDoHorarioBloqueado(clienteCom(horarios), ligada, terca10h), false) // aberta
  assert.equal(await foraDoHorarioBloqueado(clienteCom(horarios), ligada, terca20h), true) // fechada
  // desligado (padrão) ou campo ausente: nunca bloqueia, mesmo fechada
  assert.equal(await foraDoHorarioBloqueado(clienteCom(horarios), { ...ligada, bloquear_fora_do_horario: false }, terca20h), false)
  assert.equal(await foraDoHorarioBloqueado(clienteCom(horarios), { id: 'b' }, terca20h), false)
  // sem horário cadastrado, ou falha ao ler: não bloqueia
  assert.equal(await foraDoHorarioBloqueado(clienteCom([]), ligada, terca20h), false)
  assert.equal(await foraDoHorarioBloqueado(clienteCom(null, { message: 'x' }), ligada, terca20h), false)
})
