// Compara os itens de um pedido antigo com o cardápio de hoje. O front só monta o carrinho com o que
// vier 'ok' ou 'preco_mudou' (esse, depois de mostrar o preço novo).

export type ItemAntigo = {
  item_id: string | null
  nome_item: string
  quantidade: number
  preco_centavos_unitario: number
  opcoes?: unknown[] | null
}
export type ItemAtual = { id: string; nome: string; ativo: boolean; esgotado: boolean; preco_centavos: number }
export type StatusPedirDeNovo = 'ok' | 'preco_mudou' | 'esgotado' | 'indisponivel' | 'refazer_opcoes'
export type LinhaPedirDeNovo = {
  item_id: string | null
  nome: string
  quantidade: number
  status: StatusPedirDeNovo
  preco_atual_centavos: number | null
  preco_antigo_centavos: number
}

export function classificarItensPedirDeNovo(antigos: ItemAntigo[], atuais: ItemAtual[]): LinhaPedirDeNovo[] {
  const porId = new Map(atuais.map((i) => [i.id, i]))
  return antigos.map((a) => {
    const base = { item_id: a.item_id, nome: a.nome_item, quantidade: a.quantidade, preco_antigo_centavos: a.preco_centavos_unitario }
    const atual = a.item_id ? porId.get(a.item_id) : undefined
    if (!atual || !atual.ativo) return { ...base, status: 'indisponivel' as const, preco_atual_centavos: null }
    if (atual.esgotado) return { ...base, status: 'esgotado' as const, preco_atual_centavos: atual.preco_centavos }
    if ((a.opcoes ?? []).length > 0) return { ...base, status: 'refazer_opcoes' as const, preco_atual_centavos: atual.preco_centavos }
    const mudou = atual.preco_centavos !== a.preco_centavos_unitario
    return { ...base, nome: atual.nome, status: mudou ? ('preco_mudou' as const) : ('ok' as const), preco_atual_centavos: atual.preco_centavos }
  })
}
