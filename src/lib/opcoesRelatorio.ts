// Relatório de variações e adicionais (SAI-010b). Arquivo à parte: só importa tipos, então roda nos
// testes do Node (relatorio.ts usa imports sem extensão).
import type { PedidoComItens } from '../types/database'

export type OpcaoVendida = {
  tipo: 'variacao' | 'adicional'
  grupo_nome: string
  nome: string
  quantidade_total: number
  /** Variação: preço absoluto × quantidade. Adicional: acréscimo × quantidade. */
  valor_total: number
}

/** Quanto saiu de cada variação e adicional (SAI-010b). Lê o snapshot de `itens_do_pedido.opcoes`,
 * então renomear ou apagar a opção depois não muda o histórico. Pedido cancelado e item removido
 * ficam de fora, como em "Mais vendidos". Pedido antigo (sem snapshot) não conta. */
export function calcularOpcoesVendidas(pedidos: PedidoComItens[]): OpcaoVendida[] {
  const mapa = new Map<string, OpcaoVendida>()
  for (const pedido of pedidos.filter((p) => p.status !== 'cancelado')) {
    for (const item of pedido.itens_do_pedido) {
      if (item.removido || !Array.isArray(item.opcoes)) continue
      for (const o of item.opcoes) {
        if (typeof o?.nome !== 'string' || o.nome.trim() === '') continue
        const tipo = o.tipo === 'variacao' ? 'variacao' : 'adicional'
        const grupo = o.grupo_nome ?? ''
        const chave = `${tipo}|${grupo}|${o.nome}`
        const atual = mapa.get(chave) ?? { tipo, grupo_nome: grupo, nome: o.nome, quantidade_total: 0, valor_total: 0 }
        atual.quantidade_total += item.quantidade
        atual.valor_total += (Number.isFinite(o.preco_centavos) ? (o.preco_centavos as number) : 0) * item.quantidade
        mapa.set(chave, atual)
      }
    }
  }
  return [...mapa.values()].sort((a, b) => b.quantidade_total - a.quantidade_total)
}
