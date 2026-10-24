import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { HistoricoDisparos, TipoDisparo } from '../lib/disparos'

const POLL_PADRAO_MS = 15_000
const POLL_ANDAMENTO_MS = 5_000

export type Previa = { total: number; enviaveis: number }
export type ResultadoEnvio = { ok: true; campanha_id: string; total: number } | { ok: false; motivo?: string }

/** Chama a function `whatsapp-disparos` (JWT do usuário). Qualquer falha de transporte lança. */
async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-disparos', { body: corpo })
  if (error || !data) throw new Error('indisponivel')
  return data as T
}

/** Histórico de campanhas e avaliações da loja, mais as ações. Polling parado com a aba escondida; 5 s com campanha em andamento. */
export function useWhatsappDisparos(barracaId: string) {
  const [historico, setHistorico] = useState<HistoricoDisparos | null>(null)
  const [erro, setErro] = useState(false)

  const recarregar = useCallback(async () => {
    try {
      const d = await chamar<{ ok: boolean } & HistoricoDisparos>({ barraca_id: barracaId, acao: 'historico' })
      if (!d.ok) throw new Error('indisponivel')
      setHistorico({ campanhas: d.campanhas, avaliacoes: d.avaliacoes })
      setErro(false)
    } catch {
      setErro(true)
    }
  }, [barracaId])

  const emAndamento = historico?.campanhas.some((c) => c.estado === 'em_andamento') ?? false
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recarregar()
    }, emAndamento ? POLL_ANDAMENTO_MS : POLL_PADRAO_MS)
    return () => window.clearInterval(id)
  }, [recarregar, emAndamento])

  const previa = useCallback(
    async (tipo: TipoDisparo, dias: number | null): Promise<Previa> => {
      const d = await chamar<{ ok: boolean; total: number; enviaveis: number }>({
        barraca_id: barracaId,
        acao: 'previa',
        tipo,
        ...(tipo === 'reativacao' ? { dias } : {}),
      })
      if (!d.ok) throw new Error('indisponivel')
      return { total: d.total, enviaveis: d.enviaveis }
    },
    [barracaId],
  )

  const enviar = useCallback(
    async (tipo: TipoDisparo, dias: number | null, texto: string): Promise<ResultadoEnvio> => {
      const d = await chamar<ResultadoEnvio>({
        barraca_id: barracaId,
        acao: 'enviar',
        tipo,
        texto,
        ...(tipo === 'reativacao' ? { dias } : {}),
      })
      void recarregar()
      return d
    },
    [barracaId, recarregar],
  )

  const cancelar = useCallback(
    async (campanhaId: string): Promise<boolean> => {
      try {
        await chamar({ barraca_id: barracaId, acao: 'cancelar', campanha_id: campanhaId })
        void recarregar()
        return true
      } catch {
        return false
      }
    },
    [barracaId, recarregar],
  )

  return { historico, erro, recarregar: () => void recarregar(), previa, enviar, cancelar }
}
