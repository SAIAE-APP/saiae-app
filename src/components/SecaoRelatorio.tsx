import type { ReactNode } from 'react'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'

/**
 * Widget de uma seção do relatório (Faturamento) — cada seção agora é o
 * próprio Card.tsx (cantos 20-24px, borda + sombra), com um ícone + título
 * de mesmo peso visual dos CardDashboard/"Ritmo da Operação" (Dashboard.tsx)
 * em vez do antigo rótulo uppercase minúsculo + linha divisória, que dava
 * peso igual pra tudo e lia como lista de dados solta.
 */
export function SecaoRelatorio({
  titulo,
  icone,
  children,
}: {
  titulo: string
  icone: string
  children: ReactNode
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-mesa-md bg-mesa-neutral-100 text-mesa-neutral-900 dark:bg-mesa-neutral-800 dark:text-mesa-neutral-50">
          <Icone nome={icone} size={16} />
        </span>
        <h3 className="text-sm font-bold text-mesa-text-primary">{titulo}</h3>
      </div>
      {children}
    </Card>
  )
}
