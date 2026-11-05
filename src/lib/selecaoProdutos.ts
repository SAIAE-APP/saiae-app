// Seleção de vários produtos/categorias nos filtros de Faturamento e Histórico.
// Funções puras: devolvem sempre um Set novo, nunca mutam o recebido.

export type EstadoCategoria = 'nenhum' | 'alguns' | 'todos'

export function estadoDaCategoria(
  selecionados: ReadonlySet<string>,
  idsDaCategoria: string[],
): EstadoCategoria {
  const marcados = idsDaCategoria.filter((id) => selecionados.has(id)).length
  if (marcados === 0) return 'nenhum'
  return marcados === idsDaCategoria.length ? 'todos' : 'alguns'
}

/** Categoria toda marcada desmarca tudo dela; nenhum/alguns marca tudo dela. */
export function alternarCategoria(
  selecionados: ReadonlySet<string>,
  idsDaCategoria: string[],
): Set<string> {
  const proximo = new Set(selecionados)
  const desmarcar = estadoDaCategoria(selecionados, idsDaCategoria) === 'todos'
  for (const id of idsDaCategoria) {
    if (desmarcar) proximo.delete(id)
    else proximo.add(id)
  }
  return proximo
}

export function alternarProduto(selecionados: ReadonlySet<string>, id: string): Set<string> {
  const proximo = new Set(selecionados)
  if (!proximo.delete(id)) proximo.add(id)
  return proximo
}

/** null sem seleção; o nome com um produto; "N produtos" com vários. */
export function rotuloDaSelecao(
  selecionados: ReadonlySet<string>,
  nomesPorId: Map<string, string>,
): string | null {
  if (selecionados.size === 0) return null
  if (selecionados.size === 1) {
    const [id] = selecionados
    return nomesPorId.get(id) ?? '1 produto'
  }
  return `${selecionados.size} produtos`
}
