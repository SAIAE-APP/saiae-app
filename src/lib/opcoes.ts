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

/** Foto imutável de uma escolha, gravada em `itens_do_pedido.opcoes` (mesmas chaves que
 * `sanear_opcoes_pedido` aceita no servidor). `quantidade` fica fixo em 1 na v1. */
export type OpcaoSnapshot = {
  grupo_id: string
  grupo_nome: string
  tipo: 'variacao' | 'adicional'
  opcao_id: string
  nome: string
  preco_centavos: number
  quantidade: 1
}

/** Snapshot das opções escolhidas, na ordem dos grupos. Usado pelo operador (Lançar Pedido): o
 * servidor não revalida o pedido do balcão/fila offline, o snapshot do aparelho vale. */
export function snapshotOpcoes(grupos: GrupoItem[], ids: string[]): OpcaoSnapshot[] {
  return opcoesEscolhidas(grupos, ids).map(({ grupo, opcao }) => ({
    grupo_id: grupo.id,
    grupo_nome: grupo.nome,
    tipo: grupo.tipo,
    opcao_id: opcao.id,
    nome: opcao.nome,
    preco_centavos: opcao.precoCentavos,
    quantidade: 1,
  }))
}

export type GrupoLeitura = { id: string; nome: string; tipo: 'variacao' | 'adicional'; min_escolhas: number; max_escolhas: number | null; ordem: number; ativo: boolean }
export type OpcaoLeitura = { id: string; grupo_id: string; nome: string; preco_centavos: number; ordem: number; ativo: boolean; esgotado: boolean }
export type LigacaoLeitura = { item_id: string; grupo_id: string; ordem: number }

/** Grupos de cada item como o OPERADOR os vê (Lançar Pedido). Só grupos e opções ativos. O operador
 * nunca é travado por regra de catálogo: se um grupo obrigatório ficou sem opção disponível, o mínimo
 * cai para o que existe (e grupo sem nenhuma opção some), em vez de impedir a venda no balcão. */
export function montarGruposDoOperador(
  grupos: GrupoLeitura[],
  opcoes: OpcaoLeitura[],
  ligacoes: LigacaoLeitura[],
): Map<string, GrupoItem[]> {
  const grupoPorId = new Map(grupos.filter((g) => g.ativo).map((g) => [g.id, g]))
  const opcoesDoGrupo = new Map<string, OpcaoLeitura[]>()
  for (const o of [...opcoes].filter((o) => o.ativo).sort((a, b) => a.ordem - b.ordem)) {
    opcoesDoGrupo.set(o.grupo_id, [...(opcoesDoGrupo.get(o.grupo_id) ?? []), o])
  }
  const porItem = new Map<string, GrupoItem[]>()
  for (const l of [...ligacoes].sort((a, b) => a.ordem - b.ordem)) {
    const g = grupoPorId.get(l.grupo_id)
    const ops = opcoesDoGrupo.get(l.grupo_id) ?? []
    if (!g || ops.length === 0) continue
    const livres = ops.filter((o) => !o.esgotado).length
    const grupo: GrupoItem = {
      id: g.id,
      nome: g.nome,
      tipo: g.tipo,
      min: Math.min(g.min_escolhas, livres),
      max: g.max_escolhas,
      opcoes: ops.map((o) => ({ id: o.id, nome: o.nome, precoCentavos: o.preco_centavos, esgotado: o.esgotado })),
    }
    porItem.set(l.item_id, [...(porItem.get(l.item_id) ?? []), grupo])
  }
  return porItem
}

/** Nomes das opções gravadas no item do pedido, uma por entrada. Tolerante a pedido antigo (coluna
 * ausente/nula) e a lixo no jsonb: devolve [] em vez de quebrar a tela. */
export function nomesDasOpcoes(opcoes: unknown): string[] {
  if (!Array.isArray(opcoes)) return []
  return opcoes
    .map((o) => (typeof o === 'object' && o !== null && typeof (o as { nome?: unknown }).nome === 'string' ? (o as { nome: string }).nome.trim() : ''))
    .filter((nome) => nome !== '')
}

/** Texto das opções: "Grande, Ovo, Bacon" ('' em item simples). */
export function textoOpcoes(opcoes: unknown): string {
  return nomesDasOpcoes(opcoes).join(', ')
}

/** Nome do item com as opções entre parênteses, para texto corrido (planilha, WhatsApp, NFC-e). */
export function nomeComOpcoes(nome: string, opcoes: unknown): string {
  const texto = textoOpcoes(opcoes)
  return texto ? `${nome} (${texto})` : nome
}
