import { useId, type ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'

export interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label, disabled, id, className, ...rest }: ToggleProps) {
  const generatedId = useId()
  const toggleId = id ?? generatedId

  const track = (
    <button
      id={toggleId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : rest['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        // botão real ocupa 44×44 (regra de área de toque do CLAUDE.md) —
        // o visual continua sendo só a pastilha 24×44 dentro dele
        'group flex min-h-11 min-w-11 shrink-0 items-center justify-center outline-none',
        disabled && 'cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={clsx(
          'relative inline-flex h-6 w-11 items-center rounded-mesa-full transition-colors',
          'duration-[var(--mesa-duration-micro)] ease-mesa-standard',
          'group-focus-visible:[box-shadow:var(--mesa-focus-ring-confirm)]',
          disabled && 'opacity-40',
          checked ? 'bg-mesa-orange-500' : 'bg-mesa-neutral-300 dark:bg-mesa-neutral-700',
        )}
      >
        <span
          className={clsx(
            'inline-block size-5 translate-x-0.5 rounded-mesa-full bg-white shadow-mesa-1 transition-transform',
            'duration-[var(--mesa-duration-micro)] ease-mesa-standard',
            checked && 'translate-x-[22px]',
          )}
        />
      </span>
    </button>
  )

  if (!label) return track

  return (
    <label htmlFor={toggleId} className="inline-flex items-center gap-3">
      <span className="text-sm text-mesa-text-primary">{label}</span>
      {track}
    </label>
  )
}
