// Regras puras do webhook de Pix sobre pagamento APROVADO (sem rede, sem banco,
// testáveis em Node e no Deno). O webhook usa estas funções para decidir; quem
// grava/consulta é a edge function.

export type TipoConciliacao = 'valor_divergente' | 'pago_apos_expirar' | 'pedido_nao_criado' | 'comissao_nao_informada'

/** Status do pendente em que o webhook ainda precisa olhar o provedor. */
export const STATUS_PENDENTE_ABERTOS = ['pendente', 'expirado'] as const

/** itens (snapshot) + taxa de entrega (snapshot) + taxa da plataforma, em centavos inteiros. */
export function totalEsperadoDoPendente(
  itens: { quantidade: number; preco_centavos_unitario: number }[],
  taxaEntregaCentavos: number,
  /** Cupom: desconto só nos itens, gravado no pendente na hora da cobrança. Sem cupom = 0 (conta de antes). */
  descontoCupomCentavos = 0,
  /** Taxa Sai aê gravada no pendente. Pendente antigo (sem taxa) = 0. */
  taxaPlataformaCentavos = 0,
): number {
  const itensCentavos = itens.reduce((soma, item) => soma + item.preco_centavos_unitario * item.quantidade, 0)
  return itensCentavos - descontoCupomCentavos + taxaEntregaCentavos + taxaPlataformaCentavos
}

export type DecisaoAprovado =
  /** Pendente já processado (aprovado/rejeitado): responde ok sem fazer nada. */
  | { acao: 'ignorar' }
  /** Valor pago diferente do esperado: NÃO cria pedido, registra conciliação. */
  | { acao: 'conciliar_valor' }
  /**
   * Cria o pedido. `tardio` = o pendente já tinha expirado (registra conciliação informativa).
   * `comissaoNaoInformada` = pendente com taxa Sai aê e o provedor não devolveu a comissão: o pedido nasce
   * (perder pedido pago é pior) e fica um registro de conciliação para conferir a taxa.
   */
  | { acao: 'criar_pedido'; tardio: boolean; comissaoNaoInformada?: true }

/** Decisão quando o provedor confirma "aprovado". */
export function decidirAprovado(params: {
  statusPendente: string
  valorPagoCentavos: number
  totalEsperadoCentavos: number
  /** Comissão que o provedor registrou (marketplace). null = não informada. Opcional: o webhook atual não passa. */
  comissaoPagaCentavos?: number | null
  /** Taxa Sai aê esperada. 0 = pendente sem taxa: a comissão não é comparada. */
  taxaPlataformaEsperadaCentavos?: number
}): DecisaoAprovado {
  const { statusPendente, valorPagoCentavos, totalEsperadoCentavos, comissaoPagaCentavos = null, taxaPlataformaEsperadaCentavos = 0 } = params
  if (!(STATUS_PENDENTE_ABERTOS as readonly string[]).includes(statusPendente)) return { acao: 'ignorar' }
  if (valorPagoCentavos !== totalEsperadoCentavos) return { acao: 'conciliar_valor' }
  if (taxaPlataformaEsperadaCentavos <= 0) return { acao: 'criar_pedido', tardio: statusPendente === 'expirado' }
  // Comissão informada e diferente da taxa: bloqueia. Não informada: cria e marca para conciliação.
  if (comissaoPagaCentavos !== null && comissaoPagaCentavos !== taxaPlataformaEsperadaCentavos) return { acao: 'conciliar_valor' }
  return {
    acao: 'criar_pedido',
    tardio: statusPendente === 'expirado',
    ...(comissaoPagaCentavos === null ? { comissaoNaoInformada: true as const } : {}),
  }
}
