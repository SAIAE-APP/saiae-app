// Laço do worker de eventos (SAI-013), sem Deno/Supabase para poder ser testado no Node.
//
// Cada rodada reserva os eventos DEVIDOS cujos antecessores do mesmo pedido já saíram (o banco exclui
// quem tem evento anterior pendente). Enviando e concluindo uma rodada inteira, a seguinte já enxerga
// os sucessores: um pedido com 3 eventos sai em UMA execução, em ordem de sequence. O evento que
// falha volta com retry futuro e continua "pendente", então trava os sucessores dele (a ordem e o
// retry 1m/5m/30m/2h/12h ficam preservados). O teto de eventos por execução evita laço longo.

export type EventoReservado = { evento_id: string }
export type ResultadoEnvio = { ok: boolean; erro: string }

export type DependenciasFila<E extends EventoReservado> = {
  reservar: (limite: number) => Promise<{ erro: string | null; lote: E[] }>
  enviar: (ev: E) => Promise<ResultadoEnvio>
  concluir: (ev: E, r: ResultadoEnvio) => Promise<void>
}

export const LIMITE_POR_RODADA = 20
export const MAX_EVENTOS_POR_EXECUCAO = 100
export const RODADAS_MAX = 15

export async function processarFila<E extends EventoReservado>(
  dep: DependenciasFila<E>,
  opcoes: { limitePorRodada?: number; maxEventos?: number; rodadasMax?: number } = {},
): Promise<{ enviados: number; falhas: number; erroReservar: string | null }> {
  const porRodada = opcoes.limitePorRodada ?? LIMITE_POR_RODADA
  const maxEventos = opcoes.maxEventos ?? MAX_EVENTOS_POR_EXECUCAO
  const rodadasMax = opcoes.rodadasMax ?? RODADAS_MAX
  let enviados = 0
  let falhas = 0

  for (let rodada = 0; rodada < rodadasMax && enviados + falhas < maxEventos; rodada++) {
    const limite = Math.min(porRodada, maxEventos - enviados - falhas)
    const { erro, lote } = await dep.reservar(limite)
    if (erro) return { enviados, falhas, erroReservar: erro }
    if (lote.length === 0) break

    for (const ev of lote) {
      const r = await dep.enviar(ev)
      await dep.concluir(ev, r)
      if (r.ok) enviados++
      else falhas++
    }
    // Sem `break` por lote curto: lote pequeno é justamente o caso de pedido com eventos em cadeia
    // (o 2º só fica elegível depois que o 1º é concluído).
  }
  return { enviados, falhas, erroReservar: null }
}
