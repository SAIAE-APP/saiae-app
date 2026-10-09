// Abrir um link FORA do app (WhatsApp, wa.me) a partir de um toque do operador.
//
// Navegador/PWA: `window.open(url, '_blank', 'noopener')` (como sempre foi).
// App Android (WebView do Capacitor): `window.open` com `noopener` não entrega o link ao WhatsApp em todos os
// aparelhos (a janela nova nasce sem ligação com o app e o WebView não dispara a intent). Navegar o próprio WebView
// para a URL faz o Capacitor tratar como link externo (`shouldOverrideUrlLoading` → ACTION_VIEW) e abrir o app
// dono do endereço (WhatsApp), sem trocar a tela do Sai aê. Sem WhatsApp instalado nada acontece e o aviso "O
// WhatsApp não abriu" aparece (a tela continua visível).
//
// PURO (dependências injetadas) para testar no Node; o uso real está em `abrirLinkExterno` (`abrirExternoApp.ts`).

export type AbridorExterno = {
  /** App nativo (Capacitor) ou navegador. */
  nativo: boolean
  janelaNova: (url: string) => void
  navegar: (url: string) => void
}

/** Só http(s) sai do app: nada de `javascript:`, `data:`, `intent:` ou esquemas de app montados por engano. */
export function urlExternaPermitida(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Devolve false (e não abre nada) se a URL não for http(s). */
export function abrirExterno(url: string, abridor: AbridorExterno): boolean {
  if (!urlExternaPermitida(url)) return false
  if (abridor.nativo) abridor.navegar(url)
  else abridor.janelaNova(url)
  return true
}
