// Horário de funcionamento validado NO SERVIDOR (edge functions públicas do
// cardápio). Espelha a regra de `statusFuncionamento` em src/lib/horarioFuncionamento.ts
// (o deploy da function não alcança `src/`); tests/horarioServidor.test.ts garante
// que as duas dão o mesmo "aberto/fechado" em todos os dias e minutos.

export type HorarioDia = {
  dia_semana: number
  aberto: boolean
  hora_abertura: string | null
  hora_fechamento: string | null
}

export const FUSO_PADRAO = 'America/Sao_Paulo'

function paraMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/** Janela que termina no dia seguinte (18:00–02:00). Fechamento igual à abertura = 24h. */
function cruzaMeiaNoite(abertura: string, fechamento: string): boolean {
  return paraMinutos(fechamento) <= paraMinutos(abertura)
}

/**
 * Aberto no dia da semana (0=domingo) e minuto do dia informados. Sem nenhum dia
 * aberto cadastrado a barraca não restringe nada (retorna true), igual ao cardápio
 * hoje, que só mostra o selo quando há horário.
 */
export function abertoNoDiaEMinuto(horarios: HorarioDia[], diaAtual: number, minutosAgora: number): boolean {
  if (horarios.length === 0 || horarios.every((h) => !h.aberto)) return true

  // Janela de ontem que invade o dia de hoje (sexta 18h–02h, agora sábado 01h).
  const ontem = horarios.find((h) => h.dia_semana === (diaAtual + 6) % 7)
  if (
    ontem?.aberto &&
    ontem.hora_abertura &&
    ontem.hora_fechamento &&
    cruzaMeiaNoite(ontem.hora_abertura, ontem.hora_fechamento) &&
    minutosAgora < paraMinutos(ontem.hora_fechamento)
  ) {
    return true
  }

  const hoje = horarios.find((h) => h.dia_semana === diaAtual)
  if (hoje?.aberto && hoje.hora_abertura && hoje.hora_fechamento) {
    const inicio = paraMinutos(hoje.hora_abertura)
    const fim = paraMinutos(hoje.hora_fechamento)
    const cruza = cruzaMeiaNoite(hoje.hora_abertura, hoje.hora_fechamento)
    if (minutosAgora >= inicio && (cruza || minutosAgora < fim)) return true
  }
  return false
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Dia da semana e minuto do dia de `agora` no fuso da barraca. Fuso inválido cai no padrão. */
export function diaEMinutoNoFuso(agora: Date, fuso: string | null | undefined): { dia: number; minutos: number } {
  const calcular = (tz: string) => {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(agora)
    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
    return { dia: DIAS[get('weekday')], minutos: Number(get('hour')) * 60 + Number(get('minute')) }
  }
  try {
    return calcular(fuso || FUSO_PADRAO)
  } catch {
    return calcular(FUSO_PADRAO)
  }
}

export function barracaAbertaAgora(horarios: HorarioDia[], fuso: string | null | undefined, agora: Date = new Date()): boolean {
  const { dia, minutos } = diaEMinutoNoFuso(agora, fuso)
  return abertoNoDiaEMinuto(horarios, dia, minutos)
}

export const MENSAGEM_FECHADO = 'Estamos fechados no momento. Confira o horário de funcionamento e volte mais tarde.'

type ClienteHorarios = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ data: HorarioDia[] | null; error: { message: string } | null }>
    }
  }
}

/**
 * true = a barraca ligou "não aceitar pedidos do cardápio fora do horário" E está
 * fechada agora (no fuso dela). Desligado (padrão) ou sem horário cadastrado = false.
 * Falha ao ler o horário = false: erro nosso nunca barra venda.
 */
export async function foraDoHorarioBloqueado(
  supabase: unknown,
  barraca: { id: string; bloquear_fora_do_horario?: boolean | null; fuso?: string | null },
  agora: Date = new Date(),
): Promise<boolean> {
  if (!barraca.bloquear_fora_do_horario) return false
  const { data, error } = await (supabase as ClienteHorarios)
    .from('horarios_funcionamento')
    .select('dia_semana, aberto, hora_abertura, hora_fechamento')
    .eq('barraca_id', barraca.id)
  if (error || !data) return false
  return !barracaAbertaAgora(data, barraca.fuso, agora)
}
