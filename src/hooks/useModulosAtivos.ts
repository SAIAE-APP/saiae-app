import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function chaveCache(barracaId: string): string {
  return `mesaagil:modulos:${barracaId}`
}

function lerCache(barracaId: string): string[] | null {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(chaveCache(barracaId)) ?? 'null')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

function salvarCache(barracaId: string, modulos: string[]): void {
  try {
    window.localStorage.setItem(chaveCache(barracaId), JSON.stringify(modulos))
  } catch {
    // localStorage indisponível: só não cacheia
  }
}

/**
 * Módulos pagos ativos da loja (RPC `modulos_ativos`). Cache-first por loja: mostra o último resultado na hora e
 * atualiza ao abrir e quando a rede volta. `modulos` fica `null` enquanto não há resposta nem cache (fechado por
 * padrão). Nunca lança e nunca bloqueia a operação.
 */
export function useModulosAtivos(barracaId: string | undefined): { modulos: string[] | null; carregando: boolean } {
  const [estado, setEstado] = useState<{ id: string | undefined; modulos: string[] | null; carregando: boolean }>({
    id: undefined,
    modulos: null,
    carregando: true,
  })

  useEffect(() => {
    if (!barracaId) return
    let cancelado = false
    const cache = lerCache(barracaId)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cache-first como useAssinaturaBarraca
    setEstado({ id: barracaId, modulos: cache, carregando: true })

    const buscar = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelado) setEstado((e) => ({ ...e, carregando: false }))
        return
      }
      void Promise.resolve(supabase.rpc('modulos_ativos', { p_barraca_id: barracaId }))
        .then(({ data, error }) => {
          if (cancelado) return
          if (error || !Array.isArray(data)) {
            setEstado((e) => ({ ...e, carregando: false }))
            return
          }
          const lista = (data as unknown[]).filter((x): x is string => typeof x === 'string')
          salvarCache(barracaId, lista)
          setEstado({ id: barracaId, modulos: lista, carregando: false })
        })
        .catch(() => {
          if (!cancelado) setEstado((e) => ({ ...e, carregando: false }))
        })
    }
    buscar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') buscar()
    }
    window.addEventListener('online', buscar)
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      cancelado = true
      window.removeEventListener('online', buscar)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [barracaId])

  // Resultado de outra loja nunca vaza para esta (troca de loja antes da resposta).
  if (estado.id !== barracaId) return { modulos: null, carregando: Boolean(barracaId) }
  return { modulos: estado.modulos, carregando: estado.carregando }
}
