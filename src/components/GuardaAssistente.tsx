import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { useBarracasPendentes } from '../hooks/useBarracasPendentes'
import { onboardingConfigHabilitado, precisaVoltarAoAssistente } from '../lib/onboardingConfig'

/**
 * Trava real do assistente de configuração (atrás de VITE_ONBOARDING_CONFIG): enquanto o dono não chegar à tela final,
 * qualquer URL da barraca dele (/:slug/...) ou a tela de criar barraca devolve para /configurar. Digitar o endereço,
 * usar o histórico do navegador ou um link salvo não escapa. Não afeta funcionário, barraca concluída (toda barraca
 * antiga) nem login/logout. Deve ficar DENTRO de RotaProtegida (precisa de sessão). Falha de leitura nunca bloqueia.
 */
export function GuardaAssistente({ escopo, children }: { escopo: 'slug' | 'lista'; children: ReactNode }) {
  const location = useLocation()
  const { usuario } = useAuth()
  const { barracas, carregando } = useBarracasDoUsuario(usuario)
  const flagLigada = onboardingConfigHabilitado(import.meta.env.VITE_ONBOARDING_CONFIG)
  const pendentes = useBarracasPendentes(usuario, barracas, flagLigada)

  if (!flagLigada) return <>{children}</>
  if (carregando || pendentes === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  const voltar = precisaVoltarAoAssistente({
    flagLigada,
    escopo,
    slug: location.pathname.split('/')[1] ?? '',
    barracas: barracas.map((b) => ({ barraca_id: b.barraca_id, papel: b.papel, slug: b.barraca.slug })),
    pendentesIds: pendentes,
  })
  return voltar ? <Navigate to="/configurar" replace /> : <>{children}</>
}
