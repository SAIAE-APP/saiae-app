// Carrinho do cardápio público (SAI-010a): monta as linhas que vão para o resolver_carrinho do
// banco e traduz a resposta dele em HTTP. Puro (sem Deno/Supabase), testado em
// tests/carrinhoEdge.test.ts. O PREÇO nunca é calculado aqui: sai do resolver_carrinho.

export type LinhaCarrinho = {
  item_id: string
  quantidade: number
  opcao_ids: string[]
  observacao: string | null
}

export type ErroResolver = {
  linha: number | null
  item_id: string | null
  codigo: string
  mensagem: string
}

export type LinhaResolvida = {
  item_id: string
  nome_item: string
  quantidade: number
  preco_centavos_unitario: number
  opcoes: unknown[]
  observacao: string | null
}

export type ResultadoResolver =
  | { ok: true; linhas: LinhaResolvida[]; total_centavos: number }
  | { ok: false; erros: ErroResolver[] }

const MAX_OPCOES_POR_LINHA = 20
const MAX_OBSERVACAO = 120

/** Junta linhas IDÊNTICAS (mesmo item, mesmas opções, mesma observação) somando a quantidade.
 * Item simples (sem opções nem observação) cai na mesma regra de antes: repetidos viram uma linha.
 * `maxQuantidade` (se informado) limita a quantidade da linha juntada, como o "pagar na entrega"
 * sempre fez; o Pix passa null e o resolver recusa acima de 99. */
export function montarLinhas(
  itens: unknown,
  limites: { maxLinhas: number; maxQuantidade: number | null },
): { ok: true; linhas: LinhaCarrinho[] } | { ok: false; erro: string } {
  const invalido = { ok: false, erro: 'Itens inválidos' } as const
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > limites.maxLinhas) return invalido

  const porChave = new Map<string, LinhaCarrinho>()
  for (const bruta of itens) {
    if (typeof bruta !== 'object' || bruta === null) return invalido
    const l = bruta as Record<string, unknown>
    const itemId = typeof l.item_id === 'string' ? l.item_id : ''
    const quantidade = Math.floor(Number(l.quantidade) || 0)
    if (itemId === '' || quantidade < 1) return invalido

    let opcaoIds: string[] = []
    if (l.opcao_ids !== undefined && l.opcao_ids !== null) {
      if (
        !Array.isArray(l.opcao_ids) ||
        l.opcao_ids.length > MAX_OPCOES_POR_LINHA ||
        !l.opcao_ids.every((x) => typeof x === 'string')
      ) {
        return invalido
      }
      opcaoIds = l.opcao_ids as string[]
    }
    const observacao = typeof l.observacao === 'string' ? l.observacao.trim().slice(0, MAX_OBSERVACAO) || null : null

    const chave = JSON.stringify([itemId, [...opcaoIds].sort(), observacao])
    const existente = porChave.get(chave)
    if (existente) {
      existente.quantidade += quantidade
    } else {
      porChave.set(chave, { item_id: itemId, quantidade, opcao_ids: opcaoIds, observacao })
    }
  }

  const linhas = [...porChave.values()]
  if (limites.maxQuantidade !== null) {
    for (const l of linhas) l.quantidade = Math.min(limites.maxQuantidade, l.quantidade)
  }
  return { ok: true, linhas }
}

/** Valida a FORMA da resposta do RPC (defesa: nunca confiar cegamente, mesmo sendo do nosso banco). */
export function interpretarResolver(data: unknown): ResultadoResolver | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.ok === true) {
    if (!Array.isArray(d.linhas) || d.linhas.length === 0 || typeof d.total_centavos !== 'number') return null
    const linhas = d.linhas as LinhaResolvida[]
    const bem = linhas.every(
      (l) =>
        typeof l?.item_id === 'string' &&
        typeof l.nome_item === 'string' &&
        Number.isInteger(l.quantidade) &&
        Number.isInteger(l.preco_centavos_unitario) &&
        Array.isArray(l.opcoes),
    )
    return bem ? { ok: true, linhas, total_centavos: d.total_centavos } : null
  }
  if (d.ok === false && Array.isArray(d.erros) && d.erros.length > 0) {
    return { ok: false, erros: d.erros as ErroResolver[] }
  }
  return null
}

const ERROS_DE_FORMA = new Set([
  'carrinho_invalido',
  'item_invalido',
  'quantidade_invalida',
  'muitas_opcoes',
  'opcao_duplicada',
])

/** Status HTTP + texto para o cliente: carrinho malformado = 400, barraca = 404, o resto
 * (item/opção indisponível, mínimo/máximo do grupo) = 422 com a mensagem do banco. */
export function respostaDeErros(erros: ErroResolver[]): { status: number; erro: string } {
  const texto = [...new Set(erros.map((e) => String(e.mensagem ?? e.codigo)))].join('; ')
  if (erros.some((e) => e.codigo === 'barraca_invalida')) return { status: 404, erro: 'Barraca não encontrada' }
  if (erros.every((e) => ERROS_DE_FORMA.has(e.codigo))) return { status: 400, erro: 'Itens inválidos' }
  return { status: 422, erro: texto }
}

/** Soma das quantidades por item (o carrinho pode repetir o item em linhas com opções diferentes). */
export function quantidadePorItem(linhas: { item_id: string; nome_item: string; quantidade: number }[]) {
  const mapa = new Map<string, { nome: string; quantidade: number }>()
  for (const l of linhas) {
    const atual = mapa.get(l.item_id)
    mapa.set(l.item_id, { nome: l.nome_item, quantidade: (atual?.quantidade ?? 0) + l.quantidade })
  }
  return mapa
}

/** Mensagens de estoque (`bloqueio` ligado pelo dono) a partir do saldo conhecido por item. */
export function itensAcimaDoEstoque(
  linhas: { item_id: string; nome_item: string; quantidade: number }[],
  saldoPorItem: Map<string, number | null>,
): string[] {
  const acima: string[] = []
  for (const [id, { nome, quantidade }] of quantidadePorItem(linhas)) {
    const saldo = saldoPorItem.get(id) ?? null
    if (saldo !== null && quantidade > saldo) acima.push(saldo <= 0 ? `${nome}: sem estoque` : `${nome}: restam ${saldo}`)
  }
  return acima
}
