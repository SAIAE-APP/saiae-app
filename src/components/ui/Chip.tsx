import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import { Icone } from './Icone'

// Nome do variant "teal" mantido de propósito (evita tocar em ~11 call
// sites) — a cor por trás virou tinta, não mais teal/esmeralda (Sai aê:
// só duas cores de marca, ver DESIGN.md).
export type ChipVariant = 'teal' | 'plain'

interface ChipBaseProps {
  checked?: boolean
  variant?: ChipVariant
  disabled?: boolean
  className?: string
  children?: ReactNode
}

export type ChipProps = ChipBaseProps &
  (
    | ({ onClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] } & Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        keyof ChipBaseProps | 'onClick'
      >)
    | ({ onClick?: undefined } & Omit<HTMLAttributes<HTMLSpanElement>, keyof ChipBaseProps>)
  )

// Selecionado (teal) = mostarda/tinta com canto balão, mesma assinatura do
// selo "Popular" (pedido do João, 2026-09-29); não-selecionado (plain) =
// cinza neutro em pílula uniforme.
// Sem `variant` explícito, vem de `checked`: só o selecionado fica mostarda.
const variantClasses: Record<ChipVariant, string> = {
  teal: 'rounded-mesa-balao bg-mesa-orange-500 text-mesa-neutral-900',
  plain: 'rounded-mesa-full bg-mesa-neutral-100 text-mesa-neutral-700 dark:bg-mesa-neutral-700 dark:text-mesa-neutral-200',
}

export function Chip({ checked = false, variant, disabled, className, children, onClick, ...rest }: ChipProps) {
  const chipClassName = clsx(
    'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium',
    disabled && 'cursor-not-allowed opacity-40',
    variantClasses[variant ?? (checked ? 'teal' : 'plain')],
    className,
  )
  const content = (
    <>
      {checked && <Icone nome="check" size={14} peso={700} />}
      {children}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={checked}
        className={clsx(chipClassName, 'outline-none focus-visible:[box-shadow:var(--mesa-focus-ring-confirm)]')}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    )
  }

  return (
    <span className={chipClassName} {...(rest as HTMLAttributes<HTMLSpanElement>)}>
      {content}
    </span>
  )
}
