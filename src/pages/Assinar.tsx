import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

/** /assinar — ponte entre a LP/o app e o checkout da Stripe.
 * Sem sessão: manda pro cadastro preservando ?plano=&ciclo=.
 * Com sessão: pede uma Checkout Session pra edge function
 * criar-checkout-stripe (ela resolve o price_id certo e manda
 * client_reference_id=usuario_id — é assim que o webhook liga a venda de
 * volta a esta conta) e redireciona pra lá. */
export function Assinar() {
  const [params] = useSearchParams()
  const { usuario, carregando } = useAuth()
  const [erro, setErro] = useState<string | null>(null)

  const plano = params.get('plano')
  const ciclo = params.get('ciclo')

  useEffect(() => {
    if (carregando) return

    if (!usuario) {
      const destino = new URLSearchParams({ plano: plano ?? '', ciclo: ciclo ?? '' }).toString()
      window.location.replace(`/cadastro?voltar=/assinar&${destino}`)
      return
    }

    if (!plano || !ciclo) {
      setErro('Plano não informado.')
      return
    }

    let cancelado = false

    supabase.functions
      .invoke('criar-checkout-stripe', { body: { plano, ciclo } })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error || !data?.url) {
          setErro(data?.erro ?? 'Não foi possível iniciar o checkout. Tente de novo em instantes.')
          return
        }
        window.location.replace(data.url)
      })

    return () => {
      cancelado = true
    }
  }, [carregando, usuario, plano, ciclo])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      {erro ? (
        <p className="text-sm text-mesa-error-500">{erro}</p>
      ) : (
        <p className="text-mesa-text-secondary">Levando você pro checkout...</p>
      )}
    </div>
  )
}
