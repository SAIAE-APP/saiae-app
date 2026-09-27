import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'highlight' | 'successOutline'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

// success/successOutline usam mesa-success-* (verde operacional "No
// prazo" da IDV Sai aê) — não são mais teal/esmeralda, que deixou de
// ser cor de marca (ver DESIGN.md, "só duas cores").
const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-mesa-neutral-100 text-mesa-neutral-700 dark:bg-mesa-neutral-700 dark:text-mesa-neutral-200',
  success: 'bg-mesa-success-50 text-mesa-success-700 dark:bg-mesa-success-500/15 dark:text-mesa-success-500',
  warning: 'bg-mesa-warning-50 text-mesa-warning-700 dark:bg-mesa-warning-500/15 dark:text-mesa-warning-500',
  danger: 'bg-mesa-error-50 text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400',
  info: 'bg-mesa-info-50 text-mesa-info-700 dark:bg-mesa-info-500/15 dark:text-mesa-info-400',
  highlight: 'bg-mesa-orange-500 text-mesa-neutral-900',
  successOutline: 'border border-mesa-success-500 bg-transparent text-mesa-success-700 dark:text-mesa-success-500',
}

const dotClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-mesa-neutral-500',
  success: 'bg-mesa-success-500',
  warning: 'bg-mesa-warning-500',
  danger: 'bg-mesa-error-500',
  info: 'bg-mesa-info-500',
  highlight: 'bg-white',
  successOutline: 'bg-mesa-success-500',
}

export function Badge({ variant = 'neutral', dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-mesa-balao px-3 py-1 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {dot && <span className={clsx('size-1.5 shrink-0 rounded-mesa-full', dotClasses[variant])} aria-hidden />}
      {children}
    </span>
  )
}
