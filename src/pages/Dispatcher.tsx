import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { Button } from '../components/ui/Button'
import { onboardingJaVisto } from '../lib/onboardingStorage'
import { destinoAposLogin } from '../lib/loginGoogle'

export function Dispatcher() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { usuario, carregando: carregandoAuth, sair } = useAuth()
  const { barracas, carregando: carregandoBarracas, erro } = useBarracasDoUsuario(usuario)

  useEffect(() => {
    if (carregandoAuth) return

    if (!usuario) {
      // Onboarding só aparece uma vez, no primeiro acesso desse aparelho —
      // ver src/pages/Onboarding.tsx. Quem já tem conta e só perdeu a
      // sessão (deslogou, trocou de aparelho já visto) cai direto no login.
      navigate(onboardingJaVisto() ? '/login' : '/onboarding', { replace: true })
      return
    }

    // Voltou do Google vindo de /assinar (ou outro fluxo com ?voltar=): retoma de onde parou.
    const destinoSalvo = destinoAposLogin(params.toString())
    if (destinoSalvo) {
      navigate(destinoSalvo, { replace: true })
      return
    }

    if (carregandoBarracas) return
    if (erro) return

    if (barracas.length === 1) {
      navigate(`/${barracas[0].barraca.slug}`, { replace: true })
      return
    }

    // 0 barracas cai aqui também — SelecionarBarraca mostra o convite pra
    // criar a primeira, em vez de um beco sem saída.
    navigate('/selecionar-barraca', { replace: true })
  }, [usuario, carregandoAuth, barracas, carregandoBarracas, erro, navigate, params])

  if (carregandoAuth || (usuario && carregandoBarracas)) {
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
