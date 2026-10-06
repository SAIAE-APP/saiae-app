import { useEffect, useState } from 'react'
import { bairrosDaTabela, listarTaxasBairro, type BairroTaxa } from '../lib/bairros'

const chaveCache = (barracaId: string) => `saiae-bairros-entrega:${barracaId}`

function lerCache(barracaId: string): BairroTaxa[] {
  try {
    const bruto = localStorage.getItem(chaveCache(barracaId))
    if (!bruto) return []
    const lista = JSON.parse(bruto) as BairroTaxa[]
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

/**
 * Bairros com taxa da barraca, pro app do operador. Mostra na hora o último
 * cache do aparelho e atualiza pela rede; sem rede (ou erro) fica o cache, e
 * sem cache nenhum a lista é vazia = a taxa padrão de sempre. Nunca bloqueia
 * nem lança erro: a operação não espera rede.
 */
export function useBairrosEntrega(barracaId: string): BairroTaxa[] {
  const [lido, setLido] = useState<{ barracaId: string; lista: BairroTaxa[] }>(() => ({
    barracaId,
    lista: lerCache(barracaId),
  }))

  useEffect(() => {
    let cancelado = false
    listarTaxasBairro(barracaId)
      .then((linhas) => {
        if (cancelado) return
        const lista = bairrosDaTabela(linhas)
        setLido({ barracaId, lista })
        try {
          localStorage.setItem(chaveCache(barracaId), JSON.stringify(lista))
        } catch {
          // sem storage: só não guarda cache.
        }
      })
      .catch(() => {
        if (!cancelado) setLido({ barracaId, lista: lerCache(barracaId) })
      })
    return () => {
      cancelado = true
    }
  }, [barracaId])

  return lido.barracaId === barracaId ? lido.lista : lerCache(barracaId)
}
