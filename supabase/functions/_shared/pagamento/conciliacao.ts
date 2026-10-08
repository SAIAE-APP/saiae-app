// Regras puras do webhook de Pix sobre pagamento APROVADO (sem rede, sem banco,
// testáveis em Node e no Deno). O webhook usa estas funções para decidir; quem
// grava/consulta é a edge function.

export type TipoConciliacao = 'valor_divergente' | 'pago_apos_expirar' | 'pedido_nao_criado'

/** Status do pendente em que o webhook ainda precisa olhar o provedor. */
export const STATUS_PENDENTE_ABERTOS = ['pendente', 'expirado'] as const

/** itens (snapshot) + taxa de entrega (snapshot) em centavos inteiros. */
export function totalEsperadoDoPendente(
  itens: { quantidade: number; preco_centavos_unitario: number }[],
  taxaEntregaCentavos: number,
  /** Cupom: desconto só nos itens, gravado no pendente na hora da cobrança. Sem cupom = 0 (conta de antes). */
  descontoCupomCentavos = 0,
): number {
  const itensCentavos = itens.reduce((soma, item) => soma + item.preco_centavos_unitario * item.quantidade, 0)
  return itensCentavos - descontoCupomCentavos + taxaEntregaCentavos
}

export type DecisaoAprovado =
  /** Pendente já processado (aprovado/rejeitado): responde ok sem fazer nada. */
  | { acao: 'ignorar' }
  /** Valor pago diferente do esperado: NÃO cria pedido, registra conciliação. */
  | { acao: 'conciliar_valor' }
  /** Cria o pedido. `tardio` = o pendente já tinha expirado (registra conciliação informativa). */
  | { acao: 'criar_pedido'; tardio: boolean }

/** Decisão quando o provedor confirma "aprovado". */
export function decidirAprovado(params: {
  statusPendente: string
  valorPagoCentavos: number
  totalEsperadoCentavos: number
}): DecisaoAprovado {
  const { statusPendente, valorPagoCentavos, totalEsperadoCentavos } = params
  if (!(STATUS_PENDENTE_ABERTOS as readonly string[]).includes(statusPendente)) return { acao: 'ignorar' }
  if (valorPagoCentavos !== totalEsperadoCentavos) return { acao: 'conciliar_valor' }
  return { acao: 'criar_pedido', tardio: statusPendente === 'expirado' }
}
