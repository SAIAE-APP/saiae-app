import { useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

/** Substitui a tela de planos (Planos) no app iOS quando o acesso caiu por assinatura. A Apple
 * (3.1.1) não aceita preço, botão de assinar nem caminho para compra fora do app, então aqui é só
 * um aviso neutro — quem contrata é o dono, fora do app (ver lib/plataforma). */
export function AcessoIndisponivelIOS() {
  const { sair } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-mesa-bg-base p-6 pt-[calc(env(safe-area-inset-top)+24px)] text-center">
      <span className="flex size-16 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-800">
        <Icone nome="lock" size={28} className="text-mesa-neutral-900 dark:text-mesa-neutral-50" />
      </span>
      <div>
        <h1 className="text-xl font-bold text-mesa-text-primary">Acesso indisponível</h1>
        <p className="mt-1 max-w-sm text-sm text-mesa-text-secondary">
          O acesso desta barraca está inativo no momento. Fale com o responsável pela conta.
        </p>
      </div>
      <Button variant="ghost" size="md" onClick={() => navigate('/selecionar-barraca')}>
        Trocar de barraca
      </Button>
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
