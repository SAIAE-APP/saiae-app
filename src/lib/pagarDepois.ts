// "Pagar depois" (Fase 1, Retirada e Entrega): o pedido vai à cozinha sem a forma de pagamento definida e o operador
// dá baixa quando o cliente retira/recebe. Reaproveita o valor interno `na_entrega` (sem mexer em constraint, eventos,
// entregador nem relatórios); na tela vira "A receber". Atrás de um interruptor por barraca
// (`barracas.pagamento_depois_habilitado`, desligado por padrão): desligado, o app é exatamente o de antes.
// PURO, testado em tests/pagarDepois.test.ts. Spec: docs/superpowers/specs/2026-10-08-pagar-depois-e-dividido-design.md.
import { METODO_NA_ENTREGA } from './metodoPagamento.ts'
import { tipoDoPedido } from './atendimento.ts'
import type { Pedido, TipoAtendimento } from '../types/database'

export const ROTULO_A_RECEBER = 'A receber'
/** Linha da comanda impressa no lugar da forma de pagamento (sem acento, maiúsculo). */
export const LINHA_COMANDA_A_RECEBER = 'PAGAMENTO: A RECEBER'

/** Só o interruptor LIGADO de verdade conta (coluna ausente em banco/cache antigo = desligado). */
export function pagarDepoisLigado(barraca: { pagamento_depois_habilitado?: boolean } | null | undefined): boolean {
  return barraca?.pagamento_depois_habilitado === true
}

/** Mesa e Balcão ficam de fora nesta fase. */
export function modoPermitePagarDepois(tipo: TipoAtendimento | string | null | undefined): tipo is 'retirada' | 'entrega' {
  return tipo === 'retirada' || tipo === 'entrega'
}

export type OpcaoPagarDepois = { chave: typeof METODO_NA_ENTREGA; label: string; icone: string }

/** A opção "Pagar depois" de Confirmar Pedido, com o rótulo do modo. Null se o interruptor está desligado ou o modo
 * não vale. (No modo Entrega a opção "Pagar na entrega" já existia e segue como estava; esta cobre a Retirada.) */
export function opcaoPagarDepois(
  barraca: { pagamento_depois_habilitado?: boolean } | null | undefined,
  tipo: TipoAtendimento | string | null | undefined,
): OpcaoPagarDepois | null {
  if (!pagarDepoisLigado(barraca) || !modoPermitePagarDepois(tipo)) return null
  return tipo === 'retirada'
    ? { chave: METODO_NA_ENTREGA, label: 'Pagar na retirada', icone: 'takeout_dining' }
    : { chave: METODO_NA_ENTREGA, label: 'Pagar na entrega', icone: 'two_wheeler' }
}

/** O envio de `na_entrega` é aceito: sempre na Entrega (como já era) e na Retirada só com o interruptor ligado. */
export function podeEnviarAReceber(
  barraca: { pagamento_depois_habilitado?: boolean } | null | undefined,
  tipo: TipoAtendimento | string | null | undefined,
): boolean {
  return tipo === 'entrega' || (tipo === 'retirada' && pagarDepoisLigado(barraca))
}

/** Pedido com pagamento pendente ("A receber"): interruptor ligado, método ainda `na_entrega`, Retirada/Entrega e não
 * cancelado. Com o interruptor desligado devolve sempre false (telas iguais às de antes). */
export function pedidoAReceber(
  pedido: Pick<Pedido, 'tipo_atendimento' | 'mesa' | 'viagem' | 'metodo_pagamento' | 'status'>,
  ligado: boolean,
): boolean {
  return (
    ligado &&
    pedido.metodo_pagamento === METODO_NA_ENTREGA &&
    pedido.status !== 'cancelado' &&
    modoPermitePagarDepois(tipoDoPedido(pedido))
  )
}

/** Linha de pagamento da comanda: "PAGAMENTO: A RECEBER" quando é pagar depois, senão null (a comanda segue com a
 * linha de sempre). */
export function linhaPagamentoAReceber(metodo: string | null | undefined, tipo: TipoAtendimento | string | null | undefined, ligado: boolean): string | null {
  return ligado && metodo === METODO_NA_ENTREGA && modoPermitePagarDepois(tipo) ? LINHA_COMANDA_A_RECEBER : null
}
