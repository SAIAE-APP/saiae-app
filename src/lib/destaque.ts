/** Devolve a linha do item em destaque, ou null quando o bloco não deve aparecer
 * (sem escolha, item fora do cardápio, esgotado — inclusive pelas opções — ou busca ativa). */
export function resolverDestaque<L extends { item_id: string; item_esgotado: boolean }>(
  itemId: string | null,
  linhas: L[],
  buscaAtiva: boolean,
): L | null {
  if (!itemId || buscaAtiva) return null
  const linha = linhas.find((l) => l.item_id === itemId)
  return linha && !linha.item_esgotado ? linha : null
}
