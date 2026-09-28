import { useEffect, useState } from 'react'
import { buscarPedidosDoPeriodo } from './useRelatorio'
import { calcularSeriePorDia } from '../lib/relatorio'
import type { PontoSerie } from '../lib/relatorio'
import { deslocarDias, hojeISO } from '../lib/datas'

const DIAS_EVOLUCAO = 14

/** Gráfico "Evolução do faturamento" do painel de Faturamento — sempre os
 * últimos 14 dias corridos, independente do filtro de período que o resto
 * do painel usa (esse é o objetivo: dar uma visão de tendência fixa,
 * enquanto o resto do painel responde ao filtro escolhido). */
export function useEvolucao14Dias(barracaId: string): { pontos: PontoSerie[]; carregando: boolean } {
  const [pontos, setPontos] = useState<PontoSerie[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)

    const fim = hojeISO()
    const inicio = deslocarDias(fim, -(DIAS_EVOLUCAO - 1))

    buscarPedidosDoPeriodo(barracaId, inicio, fim)
      .then((pedidos) => {
        if (cancelado) return
        setPontos(calcularSeriePorDia(pedidos, inicio, fim))
        setCarregando(false)
      })
      .catch(() => {
        if (cancelado) return
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  return { pontos, carregando }
}
