// Cupons (v2): o desconto do pedido fica À PARTE, nunca misturado aos preços dos itens (mesmo padrão
// da taxa de entrega). Puro e sem imports de app, para rodar nos testes do Node.
import { formatarPrecoBR } from './preco.ts'
import type { PedidoComItens } from '../types/database.ts'

/** Linha do pedido: "Cupom FEIRA10: −R$ 5,00". Vazio quando o pedido não usou cupom. */
export function textoCupomDoPedido(pedido: Pick<PedidoComItens, 'cupom_codigo' | 'desconto_cupom_centavos'>): string {
  const desconto = Number(pedido.desconto_cupom_centavos ?? 0)
  if (desconto <= 0) return ''
  const codigo = (pedido.cupom_codigo ?? '').trim()
  return `${codigo ? `Cupom ${codigo}` : 'Cupom'}: −${formatarPrecoBR(desconto)}`
}

export type DescontosCupom = { quantidade: number; valor: number }

/** Descontos de cupom dos pedidos NÃO cancelados. O faturamento continua sendo a soma dos itens;
 * o valor recebido nos itens é faturamento − descontos. */
export function calcularDescontosCupom(pedidos: Pick<PedidoComItens, 'status' | 'desconto_cupom_centavos'>[]): DescontosCupom {
  let quantidade = 0
  let valor = 0
  for (const p of pedidos) {
    if (p.status === 'cancelado') continue
    const d = Number(p.desconto_cupom_centavos ?? 0)
    if (d > 0) {
      quantidade += 1
      valor += d
    }
  }
  return { quantidade, valor }
}
