import { useLayoutEffect, useState, type RefObject } from 'react'
import clsx from 'clsx'
import { Icone } from './ui/Icone'

export type PassoTour = {
  alvo: RefObject<HTMLElement | null>
  titulo: string
  texto: string
}

const CHAVE_PREFIXO = 'saiae:tour_'

/** Mesmo padrão do onboarding (ver Onboarding.tsx): só marca "já viu",
 * nunca decide acesso. `chave` isola tours diferentes (ex.: um por tela)
 * — cada um aparece uma vez só, independente dos outros. */
export function tourJaVisto(chave: string): boolean {
  try {
    return window.localStorage.getItem(CHAVE_PREFIXO + chave) === '1'
  } catch {
    return false
  }
}

export function marcarTourVisto(chave: string): void {
  try {
    window.localStorage.setItem(CHAVE_PREFIXO + chave, '1')
  } catch {
    // localStorage indisponível — sem problema, só mostra de novo depois
  }
}

const MARGEM_SPOTLIGHT = 8
const ALTURA_ESTIMADA_CARTAO = 220

/** Tour guiado por "spotlight": escurece a tela inteira e recorta um
 * buraco (via box-shadow gigante) exatamente em cima do elemento real do
 * passo atual, com um cartão de explicação por perto. Passivo — não
 * intercepta clique no elemento em si, só avança pelos botões do
 * próprio cartão (evita casos de borda de navegar no meio do tour). */
export function TourGuiado({ passos, onFechar }: { passos: PassoTour[]; onFechar: () => void }) {
  const [indice, setIndice] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const passo = passos[indice]
  const ultimo = indice === passos.length - 1

  useLayoutEffect(() => {
    function medir() {
      const el = passo?.alvo.current
      setRect(el ? el.getBoundingClientRect() : null)
    }
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [passo])

  if (!rect) return null

  const espacoAbaixo = window.innerHeight - rect.bottom
  const cardEmbaixo = espacoAbaixo > ALTURA_ESTIMADA_CARTAO || rect.top < ALTURA_ESTIMADA_CARTAO

  return (
    <div className="fixed inset-0 z-[var(--mesa-z-modal)]" role="dialog" aria-modal="true" aria-label={passo.titulo}>
      <div
        aria-hidden
        className="absolute rounded-mesa-lg border-2 border-mesa-orange-500 transition-[top,left,width,height] duration-200"
        style={{
          top: rect.top - MARGEM_SPOTLIGHT,
          left: rect.left - MARGEM_SPOTLIGHT,
          width: rect.width + MARGEM_SPOTLIGHT * 2,
          height: rect.height + MARGEM_SPOTLIGHT * 2,
          boxShadow: '0 0 0 9999px rgba(15,15,20,.75)',
        }}
      />

      <div
        className="absolute left-1/2 z-10 w-[calc(100%-32px)] max-w-[340px] -translate-x-1/2 rounded-mesa-xl border border-mesa-border-default bg-mesa-surface p-4 shadow-mesa-3"
        style={
          cardEmbaixo
            ? { top: rect.bottom + MARGEM_SPOTLIGHT + 12 }
            : { bottom: window.innerHeight - rect.top + MARGEM_SPOTLIGHT + 12 }
        }
      >
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-mesa-orange-500">
          Passo {indice + 1} de {passos.length}
        </p>
        <h2 className="text-base font-bold text-mesa-text-primary">{passo.titulo}</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">{passo.texto}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onFechar}
            className="min-h-11 text-sm font-semibold text-mesa-text-secondary outline-none hover:text-mesa-text-primary"
          >
            Pular
          </button>
          <div className="flex items-center gap-1" aria-hidden>
            {passos.map((_, i) => (
              <span
                key={i}
                className={clsx(
                  'h-1.5 rounded-full transition-[width,background-color] duration-[var(--mesa-duration-short)]',
                  i === indice ? 'w-5 bg-mesa-orange-500' : 'w-1.5 bg-mesa-neutral-200 dark:bg-mesa-neutral-700',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => (ultimo ? onFechar() : setIndice((i) => i + 1))}
            className="flex min-h-11 items-center gap-1 rounded-mesa-md bg-mesa-orange-500 px-4 text-sm font-bold text-mesa-neutral-900 outline-none hover:bg-mesa-orange-400"
          >
            {ultimo ? 'Entendi' : 'Próximo'}
            <Icone nome="arrow_forward" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
