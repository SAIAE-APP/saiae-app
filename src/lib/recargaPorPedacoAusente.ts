// Depois de um deploy, uma aba com a versão antiga aberta pode pedir um pedaço (chunk) do app que não existe mais:
// o Vite dispara `vite:preloadError` e a tela ficaria em branco. Recarrega UMA vez (travado por sessionStorage contra
// loop); se o pedaço continuar ausente, o erro segue e a GuardaErroApp mostra "Recarregar". Testado em
// tests/carregamentoSobDemanda.test.ts.

const CHAVE = 'saiae:recarga-pedaco-ausente'
/** Só recarrega de novo depois disto (um deploy novo na mesma aba é ok; um loop não). */
const JANELA_MS = 60_000

type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>

/** true = vai recarregar (o erro deve ser engolido); false = já recarregou há pouco, deixa o erro seguir. */
export function tratarPedacoAusente(
  evento: { preventDefault: () => void },
  deps: { storage: Armazenamento; recarregar: () => void; agora?: () => number },
): boolean {
  const agora = (deps.agora ?? Date.now)()
  try {
    const ultima = Number(deps.storage.getItem(CHAVE))
    if (ultima && agora - ultima < JANELA_MS) return false
    deps.storage.setItem(CHAVE, String(agora))
  } catch {
    return false // sem sessionStorage não dá para travar o loop: não recarrega
  }
  evento.preventDefault()
  deps.recarregar()
  return true
}

export function instalarRecargaPorPedacoAusente(): void {
  window.addEventListener('vite:preloadError', (evento) => {
    tratarPedacoAusente(evento, { storage: window.sessionStorage, recarregar: () => window.location.reload() })
  })
}
