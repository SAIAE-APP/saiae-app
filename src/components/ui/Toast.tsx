import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Icone } from './Icone'

// Avisos e notificações da IDV Sai aê (DESIGN.md): canto balão, ícone
// colorido por variante, mensagem curta e direta — "Saiaê! Senha 042...",
// "Sem internet...", "Pagamento recusado...". Empilha (mais de um toast
// por vez é raro, mas não trava se acontecer) e cada um se fecha sozinho
// ou no toque.

export type ToastVariante = 'sucesso' | 'erro' | 'aviso'

export interface ToastOpcoes {
  variante?: ToastVariante
  icone?: string
  duracaoMs?: number | null
}

interface ToastItem {
  id: number
  texto: string
  variante: ToastVariante
  icone: string
  saindo: boolean
}

interface ToastContextValue {
  mostrarToast: (texto: string, opcoes?: ToastOpcoes) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONE_PADRAO: Record<ToastVariante, string> = {
  sucesso: 'check_circle',
  erro: 'error',
  aviso: 'wifi_off',
}

const COR_ICONE: Record<ToastVariante, string> = {
  sucesso: 'text-mesa-success-500',
  erro: 'text-mesa-error-500',
  aviso: 'text-mesa-warning-500',
}

const DURACAO_PADRAO_MS = 4000
// Combina com duration-[var(--mesa-duration-short)] usado na transição
// de saída do card — dá tempo do fade terminar antes de desmontar.
const DURACAO_SAIDA_MS = 250

let proximoId = 0

export function useToast(): ToastContextValue {
  const contexto = useContext(ToastContext)
  if (!contexto) {
    throw new Error('useToast precisa ser usado dentro de ToastProvider')
  }
  return contexto
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([])

  const removerToast = useCallback((id: number) => {
    setItens((atual) => atual.filter((item) => item.id !== id))
  }, [])

  const fecharToast = useCallback(
    (id: number) => {
      setItens((atual) => atual.map((item) => (item.id === id ? { ...item, saindo: true } : item)))
      window.setTimeout(() => removerToast(id), DURACAO_SAIDA_MS)
    },
    [removerToast],
  )

  const mostrarToast = useCallback(
    (texto: string, opcoes?: ToastOpcoes) => {
      const variante = opcoes?.variante ?? 'sucesso'
      const id = proximoId++
      setItens((atual) => [
        ...atual,
        { id, texto, variante, icone: opcoes?.icone ?? ICONE_PADRAO[variante], saindo: false },
      ])

      const duracaoMs = opcoes?.duracaoMs === undefined ? DURACAO_PADRAO_MS : opcoes.duracaoMs
      if (duracaoMs !== null) {
        window.setTimeout(() => fecharToast(id), duracaoMs)
      }
    },
    [fecharToast],
  )

  return (
    <ToastContext.Provider value={{ mostrarToast }}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[var(--mesa-z-toast)] flex flex-col items-center gap-2 px-4"
          aria-live="polite"
          aria-atomic="false"
        >
          {itens.map((item) => (
            <ToastCard key={item.id} item={item} onFechar={() => fecharToast(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onFechar }: { item: ToastItem; onFechar: () => void }) {
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisivel(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <button
      type="button"
      role="status"
      onClick={onFechar}
      className={clsx(
        'pointer-events-auto flex w-full max-w-[420px] items-center gap-2.5 rounded-mesa-balao border border-mesa-border-subtle bg-mesa-surface px-4 py-3 text-left shadow-mesa-3',
        'transition-[transform,opacity] duration-[var(--mesa-duration-short)] ease-mesa-decelerate',
        visivel && !item.saindo ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <Icone nome={item.icone} size={20} preenchido className={clsx('shrink-0', COR_ICONE[item.variante])} />
      <span className="text-sm font-medium text-mesa-text-primary">{item.texto}</span>
    </button>
  )
}
