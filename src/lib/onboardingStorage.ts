// Só existe pra marcar "já viu" — nunca é lido pra decidir NADA de acesso
// (isso é `useAuth`/Dispatcher). Se falhar (modo privado etc.), o pior
// caso é mostrar o onboarding de novo, sem quebrar nada.
const CHAVE_ONBOARDING_VISTO = 'saiae:onboarding_visto'

export function marcarOnboardingVisto() {
  try {
    window.localStorage.setItem(CHAVE_ONBOARDING_VISTO, '1')
  } catch {
    // localStorage indisponível — sem problema, só mostra de novo depois
  }
}

export function onboardingJaVisto(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_ONBOARDING_VISTO) === '1'
  } catch {
    return false
  }
}
