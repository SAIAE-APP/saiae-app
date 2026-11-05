import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'

export interface SegmentedControlItem {
  label: string
  count?: number
  /** Linha de apoio sob o rótulo (opcional). */
  sublabel?: string
  icon?: ReactNode
}

export interface SegmentedControlProps {
  items: SegmentedControlItem[]
  activeIndex: number
  onChange: (index: number) => void
  className?: string
  'aria-label'?: string
}

export function SegmentedControl({ items, activeIndex, onChange, className, ...rest }: SegmentedControlProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const activeButton = buttonRefs.current[activeIndex]
    if (!activeButton) return
    setIndicatorStyle({ left: activeButton.offsetLeft, width: activeButton.offsetWidth })
  }, [activeIndex, items])

  function focusItem(index: number) {
    const target = buttonRefs.current[index]
    target?.focus()
    onChange(index)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusItem((index + 1) % items.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusItem((index - 1 + items.length) % items.length)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={rest['aria-label']}
      className={clsx('relative flex gap-1 rounded-mesa-md bg-mesa-neutral-100 p-1 dark:bg-mesa-neutral-800', className)}
    >
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-mesa-sm bg-white shadow-mesa-1 transition-[transform,width] duration-[var(--mesa-duration-short)] ease-mesa-standard dark:bg-mesa-neutral-700"
        style={{ transform: `translateX(${indicatorStyle.left}px)`, width: indicatorStyle.width }}
      />
      {items.map((item, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={item.label}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={clsx(
              'relative z-10 flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-mesa-sm px-3 py-2 text-sm font-medium outline-none',
              'transition-colors duration-[var(--mesa-duration-short)]',
              isActive ? 'text-mesa-neutral-900 dark:text-white' : 'text-mesa-neutral-500',
            )}
          >
            {item.icon && (
              <span className="inline-flex shrink-0" aria-hidden>
                {item.icon}
              </span>
            )}
            <span>
              {item.label}
              {item.count !== undefined && ` · ${item.count}`}
              {item.sublabel && <span className="block text-xs font-normal text-mesa-text-secondary">{item.sublabel}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
