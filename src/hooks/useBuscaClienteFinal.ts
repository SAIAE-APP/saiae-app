import { useEffect, useState } from 'react'
import { buscarClientesFinais } from '../lib/clientesFinais'
import type { ClienteFinal } from '../types/database'

const ATRASO_MS = 300

/**
 * Sugestões de clientes da barraca enquanto o caixa digita telefone ou nome
 * (debounce de 300ms, ignora resposta velha). Offline ou com erro: lista
 * vazia — o caixa só digita os dados na mão, nada trava.
 */
export function useBuscaClienteFinal(barracaId: string | undefined, termo: string) {
  const [resultado, setResultado] = useState<{ termo: string; clientes: ClienteFinal[] }>({
    termo: '',
    clientes: [],
  })

  useEffect(() => {
    if (!barracaId || !termo.trim()) return
    let cancelado = false
    const timer = window.setTimeout(() => {
      buscarClientesFinais(barracaId, termo)
        .then((clientes) => {
          if (!cancelado) setResultado({ termo, clientes })
        })
        .catch(() => {
          if (!cancelado) setResultado({ termo, clientes: [] })
        })
    }, ATRASO_MS)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [barracaId, termo])

  // Resultado de outro termo (ou termo vazio) não aparece: evita sugestão velha.
  const clientes = termo.trim() && resultado.termo === termo ? resultado.clientes : []
  return { clientes }
}
