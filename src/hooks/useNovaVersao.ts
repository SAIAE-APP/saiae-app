import { useCallback, useEffect, useState } from 'react'
import { INTERVALO_CHECAGEM_MS, trocaEhAtualizacao } from '../lib/novaVersao'

/**
 * `disponivel` fica true quando um service worker NOVO assumiu o controle com o app aberto. `atualizar()` recarrega a
 * página (só quando a pessoa escolhe). Também pede ao navegador para procurar versão nova ao voltar para a aba e a cada
 * 30 minutos. Sem service worker (dev, staging, navegador antigo) não faz nada.
 */
export function useNovaVersao() {
  const [disponivel, setDisponivel] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker
    const tinhaControlador = Boolean(sw.controller)

    const aoTrocar = () => {
      if (trocaEhAtualizacao(tinhaControlador)) setDisponivel(true)
    }
    sw.addEventListener('controllerchange', aoTrocar)

    const procurar = () => {
      sw.getRegistration()
        .then((r) => r?.update())
        .catch(() => {})
    }
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') procurar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    const timer = window.setInterval(procurar, INTERVALO_CHECAGEM_MS)

    return () => {
      sw.removeEventListener('controllerchange', aoTrocar)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.clearInterval(timer)
    }
  }, [])

  const atualizar = useCallback(() => window.location.reload(), [])
  return { disponivel, atualizar }
}
