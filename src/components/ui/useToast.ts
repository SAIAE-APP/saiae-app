import { createContext, useContext } from 'react'

export type ToastVariante = 'sucesso' | 'erro' | 'aviso'

export interface ToastOpcoes {
  variante?: ToastVariante
  icone?: string
  duracaoMs?: number | null
  /** Toque no toast executa isso (e fecha) — ex.: "Reimprimir". */
  aoClicar?: () => void
}

interface ToastContextValue {
  mostrarToast: (texto: string, opcoes?: ToastOpcoes) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const contexto = useContext(ToastContext)
  if (!contexto) {
    throw new Error('useToast precisa ser usado dentro de ToastProvider')
  }
  return contexto
}
