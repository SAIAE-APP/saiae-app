import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icone } from './Icone'

export type ButtonVariant =
  | 'primary'
  | 'confirm'
  | 'destructive'
  | 'outline'
  | 'outlineAmber'
  | 'ghost'
  | 'textDanger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  loading?: boolean
}

const baseClasses =
  'relative inline-flex select-none items-center justify-center gap-2 text-center font-medium ' +
  'transition-[background-color,color,transform,box-shadow] duration-[var(--mesa-duration-micro)] ease-mesa-standard ' +
  // "Pressionado" na IDV Sai aê é só scale(.97) — nenhum variant sólido
  // troca de cor no press, só no hover (ver variantClasses abaixo).
  'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 outline-none'

// Realce tátil sutil (inset de luz no topo) nos botões de ação sólidos —
// traço do redesign "Speed Bento POS" (emula um switch físico). Cede
// lugar ao anel de foco quando focado via teclado, já que box-shadow não
// acumula entre estados sem repetir o valor inteiro.
const realceTatil = '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3)]'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    // Mostarda é clara demais pra sustentar texto branco (regra da
    // IDV "Sai aê": texto sobre mostarda é sempre tinta) — daí o
    // neutral-900 fixo em vez de text-white aqui. Hover CLAREIA
    // (mostarda 400) em vez de escurecer — pressionado não troca de
    // cor, só o scale(.97) do baseClasses.
    `rounded-mesa-btn bg-mesa-orange-500 text-mesa-neutral-900 ${realceTatil} hover:bg-mesa-orange-400 ` +
    'focus-visible:[box-shadow:var(--mesa-focus-ring-primary)]',
  // "Chamar senha" na IDV Sai aê: sólido em tinta (preto), não mais
  // teal/esmeralda — a marca só tem duas cores (mostarda + tinta), o
  // resto é apoio. Nome do variant mantido pra não precisar tocar em
  // cada tela que já usa variant="confirm". No dark mode inverte pro
  // mesmo padrão já usado em Checkbox/Radio/Toggle (tinta vira quase
  // branco) em vez de continuar preto sobre o fundo escuro — preto
  // sobre `neutral-800/900` perde contraste e não é mais mostarda pra
  // não colidir com o variant primary.
  confirm:
    `rounded-mesa-btn bg-mesa-neutral-900 text-white ${realceTatil} hover:bg-mesa-neutral-800 ` +
    'dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900 dark:hover:bg-mesa-neutral-200 ' +
    'focus-visible:[box-shadow:var(--mesa-focus-ring-confirm)]',
  destructive:
    `rounded-mesa-btn bg-mesa-error-500 text-white ${realceTatil} hover:bg-mesa-error-700 active:bg-mesa-error-700 ` +
    'focus-visible:[box-shadow:var(--mesa-focus-ring-danger)]',
  // "Ver cardápio" na IDV Sai aê: contorno em tinta, não mais teal.
  outline:
    'rounded-mesa-btn border-[1.5px] border-mesa-neutral-900 bg-transparent text-mesa-neutral-900 ' +
    'dark:border-mesa-neutral-50 dark:text-mesa-neutral-50 ' +
    'hover:bg-[var(--mesa-state-hover-bg)] active:bg-[var(--mesa-state-active-bg)] ' +
    'focus-visible:[box-shadow:var(--mesa-focus-ring-confirm)]',
  outlineAmber:
    'rounded-mesa-btn border-[1.5px] border-mesa-orange-500 bg-transparent text-mesa-orange-500 ' +
    'hover:bg-[var(--mesa-state-hover-bg)] active:bg-[var(--mesa-state-active-bg)] ' +
    'focus-visible:[box-shadow:var(--mesa-focus-ring-primary)]',
  ghost:
    'rounded-mesa-md bg-transparent text-mesa-text-primary hover:bg-[var(--mesa-state-hover-bg)] ' +
    'active:bg-[var(--mesa-state-active-bg)] focus-visible:[box-shadow:var(--mesa-focus-ring-primary)]',
  textDanger:
    'rounded-mesa-md bg-transparent text-mesa-error-500 hover:bg-[var(--mesa-state-hover-bg)] ' +
    'active:bg-[var(--mesa-state-active-bg)] focus-visible:[box-shadow:var(--mesa-focus-ring-danger)]',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm whitespace-nowrap',
  md: 'h-11 px-5 text-sm whitespace-nowrap',
  // lg/xl são CTAs de largura total — texto longo quebra em vez de
  // estourar a tela horizontalmente. min-h em vez de h para o botão
  // crescer quando a segunda linha aparece.
  lg: 'min-h-[52px] px-6 py-3 text-base leading-snug',
  xl: 'min-h-[60px] px-6 py-3 text-base font-semibold leading-snug',
}

const spinnerSizePx: Record<ButtonSize, number> = {
  sm: 16,
  md: 20,
  lg: 20,
  xl: 24,
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconPosition = 'left',
    loading = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={clsx(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...rest}
    >
      <span className={clsx('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
        {icon && iconPosition === 'left' && (
          <span className="inline-flex shrink-0" aria-hidden>
            {icon}
          </span>
        )}
        {children}
        {icon && iconPosition === 'right' && (
          <span className="inline-flex shrink-0" aria-hidden>
            {icon}
          </span>
        )}
      </span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Icone nome="progress_activity" size={spinnerSizePx[size]} className="animate-spin" />
        </span>
      )}
    </button>
  )
})
