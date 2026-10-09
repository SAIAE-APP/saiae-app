import { Capacitor } from '@capacitor/core'
import { abrirExterno } from './abrirExterno'

/** Abre `url` (wa.me etc.) fora do app. Chamar direto do toque do usuário. Ver `abrirExterno.ts`. */
export function abrirLinkExterno(url: string): boolean {
  return abrirExterno(url, {
    nativo: Capacitor.isNativePlatform(),
    janelaNova: (u) => {
      window.open(u, '_blank', 'noopener')
    },
    navegar: (u) => {
      window.location.href = u
    },
  })
}
