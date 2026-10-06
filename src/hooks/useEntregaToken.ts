import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Token do link do entregador de um pedido (null: pedido antigo, sem link, ou banco sem a migration). */
export function useEntregaToken(pedidoId: string | null): string | null {
  const [lido, setLido] = useState<{ pedidoId: string; token: string | null } | null>(null)

  useEffect(() => {
    if (!pedidoId) return
    let cancelado = false
    supabase
      .from('pedidos')
      .select('entrega_token')
      .eq('id', pedidoId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelado) setLido({ pedidoId, token: (data?.entrega_token as string | null | undefined) ?? null })
      })
    return () => {
      cancelado = true
    }
  }, [pedidoId])

  return lido && lido.pedidoId === pedidoId ? lido.token : null
}
