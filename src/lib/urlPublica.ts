// No app Android nativo, window.location.origin é "https://localhost" (o
// WebView serve o dist/ local) — qualquer link que precisa funcionar FORA
// do app (compartilhado, aberto em outro navegador, link de e-mail) não
// pode usar origin nesse caso. Na web (dev/preview/produção) origin
// continua certo e é o que preserva os ambientes de preview.

import { Capacitor } from '@capacitor/core'

const URL_PUBLICA_PADRAO = 'https://app.saiae.com.br'

function baseUrlPublica(): string {
  if (Capacitor.isNativePlatform()) {
    return import.meta.env.VITE_PUBLIC_APP_URL ?? URL_PUBLICA_PADRAO
  }
  return window.location.origin
}

/** Monta uma URL pública absoluta a partir de um caminho (ex.: "/barraca/cardapio"). */
export function urlPublica(caminho: string): string {
  return `${baseUrlPublica()}${caminho}`
}
