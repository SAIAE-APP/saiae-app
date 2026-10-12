import type { ReactNode } from 'react'
import clsx from 'clsx'
import { classesTituloCabecalho } from '../../lib/estiloCabecalhoPagina'
import { BotaoHome } from './BotaoHome'

/**
 * Cabeçalho padrão das páginas (Lançar Pedido, Cozinha, Histórico,
 * Faturamento): botão home à esquerda, título, ações à direita.
 * `min-w-0 flex-1` no lado do título é o que faz o `truncate` funcionar —
 * sem isso o flex item nunca encolhe e o título volta a quebrar linha.
 */
export function CabecalhoPagina({
  titulo,
  acoes,
  aoClicarHome,
  className,
}: {
  titulo: string
  acoes?: ReactNode
  aoClicarHome?: () => void
  className?: string
}) {
  return (
    <div className={clsx('flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <BotaoHome onClick={aoClicarHome} />
        <h1 className={classesTituloCabecalho()}>{titulo}</h1>
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </div>
  )
}
