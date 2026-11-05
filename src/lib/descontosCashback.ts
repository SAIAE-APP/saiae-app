// Cashback: o saldo usado e o saldo gerado ficam À PARTE dos itens (mesmo padrão de descontosCupom.ts). Puro e sem
// imports de app, para rodar nos testes do Node. O faturamento continua sendo a soma dos itens.
import { formatarPrecoBR } from './preco.ts'
import type { PedidoComItens } from '../types/database.ts'

/** Linha do pedido: "Cashback usado: −R$ 5,00". Vazio quando o pedido não usou saldo. */
export function textoCashbackUsadoDoPedido(pedido: Pick<PedidoComItens, 'cashback_usado_centavos'>): string {
  const usado = Number(pedido.cashback_usado_centavos ?? 0)
  return usado > 0 ? `Cashback usado: −${formatarPrecoBR(usado)}` : ''
}

/** Linha do pedido: "Cashback gerado: R$ 2,00". Vazio quando o pedido não gerou saldo. */
export function textoCashbackGeradoDoPedido(pedido: Pick<PedidoComItens, 'cashback_gerado_centavos'>): string {
  const gerado = Number(pedido.cashback_gerado_centavos ?? 0)
  return gerado > 0 ? `Cashback gerado: ${formatarPrecoBR(gerado)}` : ''
}

export type CashbackUsado = { quantidade: number; valor: number }

/** Saldo usado nos pedidos NÃO cancelados (pedido cancelado não conta, como nos descontos de cupom). */
export function calcularCashbackUsado(
  pedidos: Pick<PedidoComItens, 'status' | 'cashback_usado_centavos'>[],
): CashbackUsado {
  let quantidade = 0
  let valor = 0
  for (const p of pedidos) {
    if (p.status === 'cancelado') continue
    const d = Number(p.cashback_usado_centavos ?? 0)
    if (d > 0) {
      quantidade += 1
      valor += d
    }
  }
  return { quantidade, valor }
}

/** Faturamento (soma dos itens) menos cupom e menos saldo usado. Nunca negativo. Como o servidor aceita um benefício por
 * pedido, os dois nunca incidem no mesmo pedido; somar os totais continua certo. */
export function recebidoNosItensCentavos(faturamento: number, descontoCupom: number, cashbackUsado: number): number {
  return Math.max(0, faturamento - descontoCupom - cashbackUsado)
}
