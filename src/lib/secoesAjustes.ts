// Ajustes no desktop (pedido do João, 2026-10-09/10): em vez de ~20 seções empilhadas numa rolagem só, cada categoria
// (Conta / Cardápio & Operação) tem um menu de GRUPOS à esquerda e mostra um grupo por vez. No celular as categorias também
// se separam (Sprint 3), mas cada uma mostra todos os grupos, na mesma ordem de sempre (o grupo só esconde de `md:` para cima).

export type CategoriaAjustes = 'conta' | 'cardapio'

export type GrupoAjustes = { id: string; categoria: CategoriaAjustes; rotulo: string; icone: string }

export const GRUPOS_AJUSTES: readonly GrupoAjustes[] = [
  // Cardápio & Operação
  { id: 'cardapio', categoria: 'cardapio', rotulo: 'Cardápio', icone: 'restaurant_menu' },
  { id: 'atendimento', categoria: 'cardapio', rotulo: 'Atendimento e entrega', icone: 'local_shipping' },
  { id: 'recebimento', categoria: 'cardapio', rotulo: 'Formas de receber', icone: 'payments' },
  { id: 'avisos', categoria: 'cardapio', rotulo: 'Avisos e integrações', icone: 'campaign' },
  { id: 'cozinha', categoria: 'cardapio', rotulo: 'Cozinha e equipamentos', icone: 'skillet' },
  // Conta
  { id: 'plano', categoria: 'conta', rotulo: 'Plano e identidade', icone: 'storefront' },
  { id: 'financeiro', categoria: 'conta', rotulo: 'Pagamentos e fiscal', icone: 'receipt_long' },
  { id: 'ajuda', categoria: 'conta', rotulo: 'Ajuda e conta', icone: 'help' },
]

export function gruposDaCategoria(categoria: CategoriaAjustes): GrupoAjustes[] {
  return GRUPOS_AJUSTES.filter((g) => g.categoria === categoria)
}

/** Grupo a mostrar: o pedido na URL (`?secao=`) se existir NESTA categoria; senão o primeiro. */
export function grupoAtivo(categoria: CategoriaAjustes, pedido: string | null | undefined): string {
  const lista = gruposDaCategoria(categoria)
  return lista.find((g) => g.id === pedido)?.id ?? lista[0].id
}
