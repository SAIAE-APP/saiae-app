export type HorarioPublico = {
  dia_semana: number
  aberto: boolean
  hora_abertura: string | null
  hora_fechamento: string | null
}

const DIAS_ABREV = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function paraMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/** Janela que termina no dia seguinte (ex.: 18:00–02:00). Fechamento igual à
 * abertura também conta como virada (24h). */
function cruzaMeiaNoite(abertura: string, fechamento: string): boolean {
  return paraMinutos(fechamento) <= paraMinutos(abertura)
}

/** "Aberto agora"/"Fechado — abre às Xh" a partir da data/hora do visitante.
 * Suporta janela que cruza a meia-noite: de madrugada olha a janela do dia
 * anterior. Função pura (recebe `agora`) pra poder testar. */
export function statusFuncionamento(
  horarios: HorarioPublico[],
  agora: Date = new Date(),
): { aberto: boolean; texto: string } | null {
  if (horarios.length === 0 || horarios.every((h) => !h.aberto)) return null

  const diaAtual = agora.getDay()
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes()

  // Janela de ontem que invade o dia de hoje (ex.: sexta 18h–02h, agora sáb 01h).
  const ontem = horarios.find((h) => h.dia_semana === (diaAtual + 6) % 7)
  if (
    ontem?.aberto &&
    ontem.hora_abertura &&
    ontem.hora_fechamento &&
    cruzaMeiaNoite(ontem.hora_abertura, ontem.hora_fechamento) &&
    minutosAgora < paraMinutos(ontem.hora_fechamento)
  ) {
    return { aberto: true, texto: `Aberto agora · fecha às ${ontem.hora_fechamento.slice(0, 5)}` }
  }

  const hoje = horarios.find((h) => h.dia_semana === diaAtual)
  if (hoje?.aberto && hoje.hora_abertura && hoje.hora_fechamento) {
    const inicio = paraMinutos(hoje.hora_abertura)
    const fim = paraMinutos(hoje.hora_fechamento)
    const cruza = cruzaMeiaNoite(hoje.hora_abertura, hoje.hora_fechamento)
    if (minutosAgora >= inicio && (cruza || minutosAgora < fim)) {
      return { aberto: true, texto: `Aberto agora · fecha às ${hoje.hora_fechamento.slice(0, 5)}` }
    }
    if (minutosAgora < inicio) {
      return { aberto: false, texto: `Fechado · abre hoje às ${hoje.hora_abertura.slice(0, 5)}` }
    }
  }

  for (let i = 1; i <= 7; i++) {
    const dia = (diaAtual + i) % 7
    const h = horarios.find((x) => x.dia_semana === dia)
    if (!h?.aberto || !h.hora_abertura) continue
    const rotuloDia = i === 1 ? 'amanhã' : DIAS_ABREV[dia]
    return { aberto: false, texto: `Fechado · abre ${rotuloDia} às ${h.hora_abertura.slice(0, 5)}` }
  }

  return { aberto: false, texto: 'Fechado' }
}
