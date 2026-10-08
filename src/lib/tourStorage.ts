const CHAVE_PREFIXO = 'saiae:tour_'

/** Mesmo padrão do onboarding (ver Onboarding.tsx): só marca "já viu",
 * nunca decide acesso. `chave` isola tours diferentes (ex.: um por tela)
 * — cada um aparece uma vez só, independente dos outros. */
export function tourJaVisto(chave: string): boolean {
  try {
    return window.localStorage.getItem(CHAVE_PREFIXO + chave) === '1'
  } catch {
    return false
  }
}

export function marcarTourVisto(chave: string): void {
  try {
    window.localStorage.setItem(CHAVE_PREFIXO + chave, '1')
  } catch {
    // localStorage indisponível — sem problema, só mostra de novo depois
  }
}
