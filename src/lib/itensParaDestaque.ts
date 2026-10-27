/** Itens que o dono pode escolher como destaque: ativos, disponíveis e de preço fechado, por nome. */
export function itensElegiveisParaDestaque<
  I extends { id: string; nome: string; ativo: boolean; esgotado: boolean; preco_aberto?: boolean },
>(itens: I[]): I[] {
  return itens
    .filter((i) => i.ativo && !i.esgotado && !i.preco_aberto)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}
