import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { HistoricoDisparos, TipoDisparo } from '../lib/disparos'

// A function guarda o histórico por 10 s; o CRM limita 30 chamadas/min por loja, então o polling é folgado.
const POLL_PADRAO_MS = 30_000
const POLL_ANDAMENTO_MS = 20_000

export type Previa = { total: number; enviaveis: number }
export type ResultadoEnvio = { ok: true; campanha_id: string; total: number; repetido?: boolean } | { ok: false; motivo?: string }

/** Falha da function com o código do corpo (`modulo_desligado`, `sem_permissao`…), quando houver. */
export class ErroDisparo extends Error {
  codigo?: string
  constructor(codigo?: string) {
    super('disparos')
    this.codigo = codigo
  }
}

/** Chama a function `whatsapp-disparos` (JWT do usuário). Qualquer falha de transporte lança. */
async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('whatsapp-disparos', { body: corpo })
  if (error) {
    let codigo: string | undefined
    try {
      const resposta = (error as { context?: Response }).context
      codigo = ((await resposta?.json()) as { erro?: string } | undefined)?.erro
    } catch {
      // corpo ilegível: erro genérico
    }
    throw new ErroDisparo(codigo)
  }
  if (!data) throw new ErroDisparo()
  return data as T
}

/** Histórico de campanhas e avaliações da loja, mais as ações. Polling parado com a aba escondida; 5 s com campanha em andamento. */
export function useWhatsappDisparos(barracaId: string) {
  const [historico, setHistorico] = useState<HistoricoDisparos | null>(null)
  const [erro, setErro] = useState(false)
  const [ehDono, setEhDono] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelado = false
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id
      if (!uid) return !cancelado && setEhDono(false)
      const { data: v } = await supabase
        .from('usuarios_barracas')
        .select('papel')
        .eq('barraca_id', barracaId)
        .eq('usuario_id', uid)
        .maybeSingle()
      if (!cancelado) setEhDono((v as { papel?: string } | null)?.papel === 'dono')
    })
    return () => {
      cancelado = true
    }
  }, [barracaId])

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
    async (tipo: TipoDisparo, dias: number | null, texto: string, requestId: string): Promise<ResultadoEnvio> => {
      const d = await chamar<ResultadoEnvio>({
        barraca_id: barracaId,
        acao: 'enviar',
        request_id: requestId,
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
    async (campanhaId: string): Promise<{ ok: true } | { ok: false; codigo?: string }> => {
      try {
        await chamar({ barraca_id: barracaId, acao: 'cancelar', campanha_id: campanhaId })
        void recarregar()
        return { ok: true }
      } catch (e) {
        return { ok: false, codigo: e instanceof ErroDisparo ? e.codigo : undefined }
      }
    },
    [barracaId, recarregar],
  )

  return { historico, erro, ehDono, recarregar: () => void recarregar(), previa, enviar, cancelar }
}
