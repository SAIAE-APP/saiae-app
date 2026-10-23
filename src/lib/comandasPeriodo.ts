import { supabase } from './supabase'
import { paginar } from './exportarClientes'
import type { Comanda, PedidoComItens } from '../types/database'

export type ComandaFechada = Pick<Comanda, 'id' | 'fechada_em' | 'taxa_servico_centavos' | 'metodo_pagamento'> & { fechada_em: string }

/** Comandas fechadas com `fechada_em` em [de, ate], numa consulta paginada (sem N+1). */
export async function buscarComandasFechadas(
  barracaId: string,
  de: Date,
  ate: Date,
  somenteMetodo?: string,
): Promise<ComandaFechada[]> {
  return paginar<ComandaFechada>((inicio, fim) => {
    let consulta = supabase
      .from('comandas')
      .select('id, fechada_em, taxa_servico_centavos, metodo_pagamento')
      .eq('barraca_id', barracaId)
      .eq('status', 'fechada')
      .gte('fechada_em', de.toISOString())
      .lte('fechada_em', ate.toISOString())
    if (somenteMetodo) consulta = consulta.eq('metodo_pagamento', somenteMetodo)
    return consulta.order('id').range(inicio, fim)
  })
}

/** Pedidos em dinheiro (não cancelados) das comandas dadas, em lotes de 100 ids. Lista vazia = nenhuma consulta. */
export async function buscarPedidosDeComandas(barracaId: string, comandaIds: string[]): Promise<PedidoComItens[]> {
  const todos: PedidoComItens[] = []
  for (let i = 0; i < comandaIds.length; i += 100) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, itens_do_pedido(*)')
      .eq('barraca_id', barracaId)
      .neq('status', 'cancelado')
      .eq('metodo_pagamento', 'dinheiro')
      .in('comanda_id', comandaIds.slice(i, i + 100))
    if (error) throw error
    todos.push(...((data ?? []) as PedidoComItens[]))
  }
  return todos
}

export type ComandaDoPedido = Pick<Comanda, 'id' | 'mesa' | 'status' | 'taxa_servico_centavos'>

const LOTE_IDS = 100

/** Comandas dos pedidos listados (uma consulta por lote de 100 ids). Lista vazia = nenhuma consulta. */
export async function buscarComandasPorIds(barracaId: string, ids: string[]): Promise<Map<string, ComandaDoPedido>> {
  const mapa = new Map<string, ComandaDoPedido>()
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const { data, error } = await supabase
      .from('comandas')
      .select('id, mesa, status, taxa_servico_centavos')
      .eq('barraca_id', barracaId)
      .in('id', ids.slice(i, i + LOTE_IDS))
    if (error) throw error
    for (const c of (data ?? []) as ComandaDoPedido[]) mapa.set(c.id, c)
  }
  return mapa
}

/** Texto da linha do pedido ligado a comanda: etiqueta da rodada aberta ou taxa da comanda fechada. */
export function textoComandaDoPedido(comanda: ComandaDoPedido | undefined, formatar: (centavos: number) => string): string {
  if (!comanda) return ''
  if (comanda.status === 'aberta') return `Mesa ${comanda.mesa} · comanda aberta`
  return comanda.taxa_servico_centavos > 0 ? `Taxa de serviço: ${formatar(comanda.taxa_servico_centavos)} (comanda inteira)` : ''
}
