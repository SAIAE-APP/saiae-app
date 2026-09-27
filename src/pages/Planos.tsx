import { useNavigate } from 'react-router'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import { PaywallConteudo } from '../components/PaywallConteudo'
import { Button } from '../components/ui/Button'

/** Tela cheia — LayoutBarraca manda pra cá quando a assinatura do dono da
 * barraca não está mais ativa. Sem botão de fechar de propósito (o
 * popup fechável é o PaywallModal, aberto pelo banner do trial). */
export function Planos() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const { assinatura } = useAssinaturaBarraca(barraca.slug)

  return (
    <div className="flex min-h-dvh flex-col gap-6 bg-mesa-bg-base p-6">
      {!assinatura?.eh_dono && (
        <div className="rounded-mesa-lg border border-mesa-border-default bg-mesa-surface p-4 text-center text-sm text-mesa-text-secondary">
          A assinatura de <strong>{barraca.nome}</strong> está inativa. Fale com o dono da barraca pra
          regularizar o acesso.
        </div>
      )}

      <div className="mx-auto w-full max-w-[420px]">
        <PaywallConteudo assinatura={assinatura} />
        {assinatura?.eh_dono && (
          <Button variant="ghost" size="md" className="mt-4 w-full" onClick={() => navigate('/')}>
            Ver minhas barracas
          </Button>
        )}
      </div>
    </div>
  )
}
