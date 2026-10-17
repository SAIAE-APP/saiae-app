import { useNavigate } from 'react-router'
import clsx from 'clsx'
import { useContext } from 'react'
import { BarracaContext } from '../../layouts/contextoBarraca'
import { classesBotaoIcone } from '../../lib/estiloBotaoIcone'
import { Icone } from './Icone'

/**
 * Mesmo shape do botão de tema (`classesBotaoIcone`, 44×44). Por padrão
 * navega direto pro Dashboard (`/:slug`); telas com estado que seria
 * perdido no caminho (ex.: ConfirmarPedido) passam `onClick` pra
 * interceptar e confirmar antes. Fora do LayoutBarraca (painel /admin) não há
 * barraca no contexto: aí o `onClick` é obrigatório.
 */
export function BotaoHome({ onClick, className }: { onClick?: () => void; className?: string }) {
  const barraca = useContext(BarracaContext)
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={onClick ?? (() => barraca && navigate(`/${barraca.slug}`))}
      aria-label="Ir para o início"
      className={clsx(classesBotaoIcone(), className)}
    >
      <Icone nome="home" size={20} />
    </button>
  )
}
