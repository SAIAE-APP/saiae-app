import { type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react'
import clsx from 'clsx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export function Card({ interactive = false, className, onClick, onKeyDown, children, ...rest }: CardProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event)
    if (!interactive || !onClick) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick(event as unknown as MouseEvent<HTMLDivElement>)
    }
  }

  return (
    <div
      className={clsx(
        'rounded-mesa-xl border border-mesa-border-subtle bg-mesa-surface p-4 shadow-mesa-1',
        interactive &&
          'cursor-pointer transition-shadow duration-[var(--mesa-duration-micro)] hover:shadow-mesa-2 ' +
            'outline-none focus-visible:[box-shadow:var(--mesa-focus-ring-primary)]',
        className,
      )}
      role={interactive && onClick ? 'button' : undefined}
      tabIndex={interactive && onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {children}
    </div>
  )
}
