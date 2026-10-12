import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { mensagemDoErroFuncao } from '../lib/erroFuncao'

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
  const [aviso, setAviso] = useState<string | null>(null)

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
      .then(async ({ data, error }) => {
        if (error || !data?.url) {
          // Non-2xx (ex.: 409 "você já tem uma assinatura") traz a frase em error.context.
          const mensagem = data?.erro ?? (await mensagemDoErroFuncao(error, 'Não foi possível iniciar o checkout. Tente de novo em instantes.'))
          if (!cancelado) setErro(mensagem)
          return
        }
        if (cancelado) return
        // Deixa claro quando a cobrança começa: só no fim do teste grátis, ou agora (teste com menos de 48 h
        // restantes não permite adiar na Stripe).
        const aviso = data.teste_ate
          ? `Seu teste grátis continua até ${new Date(data.teste_ate).toLocaleDateString('pt-BR')}. A cobrança começa só depois.`
          : data.teste_curto_demais
            ? 'Seu teste termina em menos de 2 dias, então a cobrança começa agora.'
            : null
        if (aviso) {
          setAviso(aviso)
          window.setTimeout(() => window.location.replace(data.url), 2500)
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
        <>
          {aviso ? <p className="max-w-sm text-sm text-mesa-text-primary">{aviso}</p> : null}
          <p className="text-mesa-text-secondary">Levando você pro checkout...</p>
        </>
      )}
    </div>
  )
}
