import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { acaoDoPoll, telaDaConexao, type RespostaConexao, type TelaConexao } from '../lib/estadoWhatsapp'

type Acao = 'iniciar' | 'status' | 'desconectar' | 'historico'

const POLL_QR_MS = 3_000
const POLL_PADRAO_MS = 15_000

/** Estado da conexão do WhatsApp da loja (proxy `whatsapp-conexao`). Polling parado com a aba escondida. */
export function useWhatsappConexao(barracaId: string) {
  const [resposta, setResposta] = useState<RespostaConexao | null>(null)
  const [erro, setErro] = useState(false)

  const chamar = useCallback(
    async (acao: Acao) => {
      try {
        const { data, error } = await supabase.functions.invoke('whatsapp-conexao', {
          body: { barraca_id: barracaId, acao },
        })
        if (error || !data?.ok) throw new Error('indisponivel')
        setResposta(data as RespostaConexao)
        setErro(false)
      } catch {
        setErro(true)
      }
    },
    [barracaId],
  )

  const estado = resposta?.estado
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void chamar(acaoDoPoll(estado))
    const intervalo = estado === 'aguardando_qr' ? POLL_QR_MS : POLL_PADRAO_MS
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void chamar(acaoDoPoll(estado))
    }, intervalo)
    return () => window.clearInterval(id)
  }, [chamar, estado])

  const tela: TelaConexao = telaDaConexao(resposta, erro)
  return {
    tela,
    avisos: resposta?.avisos ?? [],
    iniciar: () => chamar('iniciar'),
    desconectar: () => chamar('desconectar'),
    recarregar: () => void chamar('status'),
  }
}
