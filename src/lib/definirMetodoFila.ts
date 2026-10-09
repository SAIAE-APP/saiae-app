// "Pagar depois", Fase 1: definir a forma de pagamento ao tocar "Entregue", mesmo sem rede. A escolha vira a operação
// `definir_metodo` da fila de sincronização (idempotente: a RPC definir_metodo_pagamento repete o mesmo método sem
// erro). PURO, testado em tests/definirMetodoFila.test.ts.

export const METODOS_REAIS = ['dinheiro', 'debito', 'credito', 'pix'] as const

export type DesfechoDefinirNaFila =
  /** Pronto: sai da fila. */
  | 'concluida'
  /** Banco ainda sem a RPC (PGRST202) ou falha passageira: fica na fila e reenvia, sem travar as outras. */
  | 'adiar'
  /** Erro de rede/sessão: reenvia como as demais operações (para a fila). */
  | 'repetir'

// Definido agora, já estava com esse método, ou outro lugar definiu antes (entregador/outro aparelho: "primeiro que
// sincroniza vence", spec seção 6); ou reenviar nunca vai dar certo (cancelado, sem acesso, método inválido).
const ESTADOS_QUE_ENCERRAM = new Set(['ok', 'ja_definido', 'cancelado', 'sem_acesso', 'metodo_invalido'])

/** Resposta da RPC `definir_metodo_pagamento` (ou erro) → o que a fila faz. Sessão expirada ou resposta estranha: repete. */
export function desfechoDefinirMetodo(
  erro: { code?: string; message?: string } | null | undefined,
  resposta: { estado?: string } | null | undefined,
): DesfechoDefinirNaFila {
  if (erro) return erro.code === 'PGRST202' ? 'adiar' : 'repetir'
  return resposta?.estado !== undefined && ESTADOS_QUE_ENCERRAM.has(resposta.estado) ? 'concluida' : 'repetir'
}

type PedidoComValores = {
  itens_do_pedido: { preco_centavos_unitario: number; quantidade: number; removido?: boolean | null }[]
  taxa_entrega_centavos?: number | null
  desconto_cupom_centavos?: number | null
}

/** Total que o cliente paga: itens ativos + taxa de entrega − desconto de cupom (nunca negativo). */
export function totalAPagarCentavos(pedido: PedidoComValores): number {
  const itens = pedido.itens_do_pedido
    .filter((i) => !i.removido)
    .reduce((soma, i) => soma + i.preco_centavos_unitario * i.quantidade, 0)
  return Math.max(0, itens + Math.max(0, pedido.taxa_entrega_centavos ?? 0) - Math.max(0, pedido.desconto_cupom_centavos ?? 0))
}

/** Troco de quem pagou em dinheiro (só informativo): null se não informou ou pagou menos que o total. */
export function calcularTroco(totalCentavos: number, recebidoCentavos: number | null): number | null {
  if (recebidoCentavos === null || recebidoCentavos <= 0) return null
  return recebidoCentavos >= totalCentavos ? recebidoCentavos - totalCentavos : null
}
