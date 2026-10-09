import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { Button } from '../components/ui/Button'
import { onboardingJaVisto } from '../lib/onboardingStorage'
import { onboardingConfigHabilitado } from '../lib/onboardingConfig'
import { useOnboardingPendente } from '../hooks/useOnboardingPendente'

export function Dispatcher() {
  const navigate = useNavigate()
  const { usuario, carregando: carregandoAuth, sair } = useAuth()
  const { barracas, carregando: carregandoBarracas, erro } = useBarracasDoUsuario(usuario)
  // Assistente de configuração: só conta nova ou barraca própria com o assistente por concluir, e só com a flag.
  const { pendente: onboardingPendente, carregando: carregandoOnboarding } = useOnboardingPendente(
    usuario,
    barracas,
    onboardingConfigHabilitado(import.meta.env.VITE_ONBOARDING_CONFIG),
  )

  useEffect(() => {
    if (carregandoAuth) return

    if (!usuario) {
      // Onboarding só aparece uma vez, no primeiro acesso desse aparelho —
      // ver src/pages/Onboarding.tsx. Quem já tem conta e só perdeu a
      // sessão (deslogou, trocou de aparelho já visto) cai direto no login.
      navigate(onboardingJaVisto() ? '/login' : '/onboarding', { replace: true })
      return
    }

    if (carregandoBarracas) return
    if (erro) return
    if (carregandoOnboarding) return

    if (onboardingPendente) {
      navigate('/configurar', { replace: true })
      return
    }

    if (barracas.length === 1) {
      navigate(`/${barracas[0].barraca.slug}`, { replace: true })
      return
    }

    // 0 barracas cai aqui também — SelecionarBarraca mostra o convite pra
    // criar a primeira, em vez de um beco sem saída.
    navigate('/selecionar-barraca', { replace: true })
  }, [usuario, carregandoAuth, barracas, carregandoBarracas, erro, navigate, onboardingPendente, carregandoOnboarding])

  if (carregandoAuth || (usuario && (carregandoBarracas || carregandoOnboarding))) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-sm text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  if (usuario && erro) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mesa-bg-base p-6 text-center">
        <p className="text-base text-mesa-text-primary">
          Não foi possível carregar suas barracas. Tente novamente.
        </p>
        <Button
          variant="ghost"
          size="md"
          onClick={async () => {
            await sair()
            navigate('/login')
          }}
        >
          Sair
        </Button>
      </div>
    )
  }

  return null
}
