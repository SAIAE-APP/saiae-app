// "Saiu para entrega" (PR 2/4): regra pura da coluna nova do kanban. Spec: docs/superpowers/specs/2026-10-19-saiu-para-entrega-design.md.
import { modosAtivos, tipoDoPedido } from './atendimento.ts'
import type { Barraca, Pedido } from '../types/database'

export const STATUS_SAIU = 'saiu_entrega' as const

/** A coluna só existe com o modo Entrega ligado E o interruptor da loja ligado (padrão desligado). */
export function saiuEntregaLigado(barraca: Pick<Barraca, 'modos_atendimento'> & { saiu_entrega_habilitado?: boolean }): boolean {
  return barraca.saiu_entrega_habilitado === true && modosAtivos(barraca).includes('entrega')
}

export function pedidoDeEntrega(pedido: Pick<Pedido, 'tipo_atendimento' | 'mesa' | 'viagem'>): boolean {
  return tipoDoPedido(pedido) === 'entrega'
}

/** O botão principal de um pedido Pronto vira "Saiu para entrega" só em pedido de Entrega com a coluna ligada. */
export function podeSairParaEntrega(
  pedido: Pick<Pedido, 'tipo_atendimento' | 'mesa' | 'viagem' | 'status'>,
  barraca: Pick<Barraca, 'modos_atendimento'> & { saiu_entrega_habilitado?: boolean },
): boolean {
  return pedido.status === 'pronto' && saiuEntregaLigado(barraca) && pedidoDeEntrega(pedido)
}

/** O cronômetro congela em Pronto e também em Saiu para entrega (a cor operacional não muda na coluna nova). */
export function cronometroCongelado(status: string): boolean {
  return status === 'pronto' || status === STATUS_SAIU
}

/** "saiu há N min" (arredonda para baixo; nunca negativo). */
export function minutosDesdeQueSaiu(saiuEm: string | null | undefined, agora: number = Date.now()): number | null {
  if (!saiuEm) return null
  const t = new Date(saiuEm).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((agora - t) / 60000))
}

export const ROTULO_SAIU = 'Saiu para entrega'
