import { formatarDataISO } from './datas.ts'

/**
 * Espera média (minutos, arredondada) dos pedidos ainda NA FILA (`a_fazer`) criados
 * HOJE. "Hoje" é o mesmo dia local do relatório (`hojeISO`/`formatarDataISO`).
 *
 * Pedido de dias anteriores esquecido em aberto NÃO entra (distorcia a média para
 * centenas de minutos, ex.: 1152 min). Pedido atrasado de hoje continua contando:
 * é espera real, e tirá-lo faria a média mentir para melhor.
 * Relógio do aparelho atrás do servidor não gera espera negativa (mínimo 0).
 * Sem pedido da fila de hoje devolve null (a tela mostra "—").
 *
 * É outra métrica que `calcularRitmoDoDia.tempoMedioPreparoMin` (preparo dos pedidos
 * já prontos): esta olha quem está esperando agora.
 */
export function calcularEsperaMediaFila(
  pedidos: { status: string; criado_em: string }[],
  agora: Date = new Date(),
): number | null {
  const hoje = formatarDataISO(agora)
  const naFilaDeHoje = pedidos.filter(
    (p) => p.status === 'a_fazer' && formatarDataISO(new Date(p.criado_em)) === hoje,
  )
  if (naFilaDeHoje.length === 0) return null

  const somaMinutos = naFilaDeHoje.reduce(
    (soma, p) => soma + Math.max(0, (agora.getTime() - new Date(p.criado_em).getTime()) / 60000),
    0,
  )
  return Math.round(somaMinutos / naFilaDeHoje.length)
}
