// Adicionais e variações no cardápio público (SAI-010a). Lógica PURA (sem React): agrupa as linhas de
// `opcoes_publicas`, valida as escolhas e calcula o preço de PRÉVIA. O servidor (resolver_carrinho)
// recalcula tudo; aqui só evita o cliente enviar um carrinho que o servidor vai recusar.
// Regras da v1: no máximo UMA variação por item (min = max = 1, preço ABSOLUTO que substitui o base);
// adicionais somam e têm min/max livres; grupo obrigatório sem opção disponível => item não pedível.

export type LinhaOpcaoPublica = {
  item_id: string
  grupo_id: string
  grupo_nome: string
  grupo_tipo: 'variacao' | 'adicional'
  min_escolhas: number
  max_escolhas: number | null
  opcao_id: string | null
  opcao_nome: string | null
  opcao_preco_centavos: number | null
  opcao_esgotado: boolean | null
}

export type OpcaoItem = { id: string; nome: string; precoCentavos: number; esgotado: boolean }

export type GrupoItem = {
  id: string
  nome: string
  tipo: 'variacao' | 'adicional'
  min: number
  /** null = sem limite */
  max: number | null
  opcoes: OpcaoItem[]
}

/** Agrupa as linhas (já na ordem de exibição) por item. Linha sem opção (grupo sem opção ativa) cria
 * o grupo vazio, o que torna o item não pedível se o grupo for obrigatório. */
export function agruparOpcoes(linhas: LinhaOpcaoPublica[]): Map<string, GrupoItem[]> {
  const porItem = new Map<string, GrupoItem[]>()
  for (const l of linhas) {
    const grupos = porItem.get(l.item_id) ?? []
    let grupo = grupos.find((g) => g.id === l.grupo_id)
    if (!grupo) {
      grupo = { id: l.grupo_id, nome: l.grupo_nome, tipo: l.grupo_tipo, min: l.min_escolhas, max: l.max_escolhas, opcoes: [] }
      grupos.push(grupo)
    }
    if (l.opcao_id !== null && l.opcao_nome !== null) {
      grupo.opcoes.push({
        id: l.opcao_id,
        nome: l.opcao_nome,
        precoCentavos: l.opcao_preco_centavos ?? 0,
        esgotado: l.opcao_esgotado === true,
      })
    }
    porItem.set(l.item_id, grupos)
  }
  return porItem
}

const disponiveis = (g: GrupoItem) => g.opcoes.filter((o) => !o.esgotado)

/** Item pedível: todo grupo obrigatório (min >= 1) tem ao menos uma opção disponível. */
export function itemPedivel(grupos: GrupoItem[]): boolean {
  return grupos.every((g) => g.min < 1 || disponiveis(g).length > 0)
}

export function temVariacao(grupos: GrupoItem[]): boolean {
  return grupos.some((g) => g.tipo === 'variacao')
}

/** Preço exibido no card: com variação, o menor preço disponível ("a partir de"); sem, o base. */
export function precoAPartirDe(precoBaseCentavos: number, grupos: GrupoItem[]): number {
  const variacao = grupos.find((g) => g.tipo === 'variacao')
  if (!variacao) return precoBaseCentavos
  const precos = disponiveis(variacao).map((o) => o.precoCentavos)
  return precos.length > 0 ? Math.min(...precos) : precoBaseCentavos
}

function opcoesEscolhidas(grupos: GrupoItem[], ids: string[]): { grupo: GrupoItem; opcao: OpcaoItem }[] {
  const escolhidas: { grupo: GrupoItem; opcao: OpcaoItem }[] = []
  for (const grupo of grupos) {
    for (const opcao of grupo.opcoes) if (ids.includes(opcao.id)) escolhidas.push({ grupo, opcao })
  }
  return escolhidas
}

/** Preço de prévia da unidade: variação (absoluta) substitui o base; adicionais somam. */
export function precoUnitario(precoBaseCentavos: number, grupos: GrupoItem[], ids: string[]): number {
  const escolhidas = opcoesEscolhidas(grupos, ids)
  const variacao = escolhidas.find((e) => e.grupo.tipo === 'variacao')
  const base = variacao ? variacao.opcao.precoCentavos : precoBaseCentavos
  return base + escolhidas.filter((e) => e.grupo.tipo === 'adicional').reduce((s, e) => s + e.opcao.precoCentavos, 0)
}

export type ValidacaoEscolhas = { ok: boolean; erros: Record<string, string> }

/** Valida mínimo/máximo por grupo e opções desconhecidas ou esgotadas. `erros` é por id de grupo
 * (a chave '' é erro geral). */
export function validarEscolhas(grupos: GrupoItem[], ids: string[]): ValidacaoEscolhas {
  const erros: Record<string, string> = {}
  const conhecidas = new Set<string>()
  for (const g of grupos) {
    const escolhidas = g.opcoes.filter((o) => ids.includes(o.id))
    for (const o of g.opcoes) conhecidas.add(o.id)
    if (escolhidas.some((o) => o.esgotado)) erros[g.id] = 'Uma das opções acabou. Escolha outra.'
    else if (escolhidas.length < g.min) erros[g.id] = g.min === 1 ? 'Escolha uma opção' : `Escolha pelo menos ${g.min}`
    else if (g.max !== null && escolhidas.length > g.max) erros[g.id] = `Escolha no máximo ${g.max}`
  }
  if (ids.some((id) => !conhecidas.has(id))) erros[''] = 'Opção inválida.'
  return { ok: Object.keys(erros).length === 0, erros }
}

/** Toque numa opção. Grupo de escolha única (max = 1): troca a escolha (e desmarca se o grupo for
 * opcional); grupo com limite: marca/desmarca e ignora o que passar do máximo. */
export function alternarOpcao(grupos: GrupoItem[], ids: string[], grupoId: string, opcaoId: string): string[] {
  const grupo = grupos.find((g) => g.id === grupoId)
  const opcao = grupo?.opcoes.find((o) => o.id === opcaoId)
  if (!grupo || !opcao || opcao.esgotado) return ids

  const marcada = ids.includes(opcaoId)
  const doGrupo = new Set(grupo.opcoes.map((o) => o.id))
  if (grupo.max === 1) {
    if (marcada) return grupo.min >= 1 ? ids : ids.filter((id) => id !== opcaoId)
    return [...ids.filter((id) => !doGrupo.has(id)), opcaoId]
  }
  if (marcada) return ids.filter((id) => id !== opcaoId)
  const jaNoGrupo = ids.filter((id) => doGrupo.has(id)).length
  if (grupo.max !== null && jaNoGrupo >= grupo.max) return ids
  return [...ids, opcaoId]
}

/** Texto curto das escolhas, na ordem dos grupos: "Grande, Ovo, Bacon". */
export function resumoEscolhas(grupos: GrupoItem[], ids: string[]): string {
  return opcoesEscolhidas(grupos, ids)
    .map((e) => e.opcao.nome)
    .join(', ')
}

/** Identidade de uma linha do carrinho: mesmo item + mesmas opções (em qualquer ordem) + mesma observação. */
export function chaveDaLinha(itemId: string, ids: string[], observacao: string): string {
  return JSON.stringify([itemId, [...ids].sort(), observacao.trim()])
}
