import { createContext, useContext } from 'react'
import type { Barraca } from '../types/database'

export const BarracaContext = createContext<Barraca | null>(null)

export function useBarracaAtual(): Barraca {
  const barraca = useContext(BarracaContext)
  if (!barraca) {
    throw new Error('useBarracaAtual precisa ser usado dentro de LayoutBarraca')
  }
  return barraca
}

export type EstadoSincronizacao = { pendentes: number; sincronizando: boolean; online: boolean }
export const SincronizacaoContext = createContext<EstadoSincronizacao | null>(null)

export function useSincronizacaoAtual(): EstadoSincronizacao {
  const estado = useContext(SincronizacaoContext)
  if (!estado) {
    throw new Error('useSincronizacaoAtual precisa ser usado dentro de LayoutBarraca')
  }
  return estado
}

/** O usuário é dono (papel 'dono') da loja ativa. Fecha por padrão (false) fora do LayoutBarraca. */
export const SouDonoContext = createContext(false)

export function useSouDonoDaLoja(): boolean {
  return useContext(SouDonoContext)
}

/** Módulos pagos ativos da loja; `null` = ainda sem resposta (tudo fechado). */
export const ModulosContext = createContext<string[] | null>(null)

export function useModulosDaLoja(): string[] | null {
  return useContext(ModulosContext)
}
