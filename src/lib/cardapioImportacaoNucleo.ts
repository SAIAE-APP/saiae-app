// Núcleo da gravação da importação do cardápio (sem importar o cliente do supabase: recebe `db`, e por isso roda nos
// testes com um banco simulado). O cliente real é ligado em cardapioImportacao.ts.
// Gravação da importação do cardápio: lê o que a barraca já tem e grava categorias e itens em lote, SEMPRE pela RLS
// (o mesmo caminho do cadastro manual; vale para o dono e para o suporte com acesso ativo). Sem RPC nem migration:
// funciona em qualquer banco. Não é uma transação, então foi desenhada para ser REPETÍVEL: categoria é achada pelo
// nome e item que já existe é pulado, logo importar o mesmo arquivo de novo depois de uma falha não duplica nada.
import {
  TAMANHO_LOTE_ITENS,
  chaveNome,
  type CardapioExistente,
  type ItemParaCriar,
} from './importarCardapio.ts'
import { emLotes } from './importarClientes.ts'

const PAGINA = 1000

// Só o que o núcleo usa do supabase-js (o teste injeta um simulado).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BancoCardapio = { from: (tabela: string) => any }

export type ResumoImportacaoCardapio = { itensCriados: number; categoriasCriadas: number }

export class ErroImportacaoCardapio extends Error {
  parcial: ResumoImportacaoCardapio
  constructor(mensagem: string, parcial: ResumoImportacaoCardapio) {
    super(mensagem)
    this.parcial = parcial
  }
}

async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const tudo: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    const pagina = data ?? []
    tudo.push(...pagina)
    if (pagina.length < PAGINA) return tudo
  }
}

/** Categorias e itens da barraca (só o necessário para comparar nomes e continuar a ordem). */
export async function carregarCardapioExistenteCom(db: BancoCardapio, barracaId: string): Promise<CardapioExistente> {
  const [categorias, itens] = await Promise.all([
    lerTudo<{ id: string; nome: string; ordem: number }>((de, ate) =>
      db.from('categorias').select('id, nome, ordem').eq('barraca_id', barracaId).order('ordem').order('id').range(de, ate),
    ),
    lerTudo<{ nome: string; categoria_id: string | null; ordem: number }>((de, ate) =>
      db.from('itens').select('nome, categoria_id, ordem').eq('barraca_id', barracaId).order('ordem').order('id').range(de, ate),
    ),
  ])
  return { categorias, itens }
}

/**
 * Cria as categorias que faltam (nunca duplica: compara por nome sem acento/maiúscula) e depois os itens, com ordem
 * sequencial depois da última existente. Fotos, campos fiscais e estoque ficam vazios (o dono completa depois).
 * Em falha no meio lança `ErroImportacaoCardapio` com o que já foi gravado.
 */
export async function gravarCardapioImportadoCom(
  db: BancoCardapio,
  barracaId: string,
  existente: CardapioExistente,
  itens: readonly ItemParaCriar[],
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResumoImportacaoCardapio> {
  const resumo: ResumoImportacaoCardapio = { itensCriados: 0, categoriasCriadas: 0 }
  const idPorChave = new Map(existente.categorias.map((c) => [chaveNome(c.nome), c.id]))

  // A chave é SEMPRE recalculada do nome da categoria (mesma função que casa com o que o banco devolve), em vez de
  // confiar numa chave pré-calculada: se as duas divergirem o item ficaria sem categoria em silêncio.
  const chaveDoItem = (item: ItemParaCriar) => (item.categoria ? chaveNome(item.categoria) : null)
  const novas: { chave: string; nome: string }[] = []
  for (const item of itens) {
    const chave = chaveDoItem(item)
    if (chave && item.categoria && !idPorChave.has(chave) && !novas.some((n) => n.chave === chave)) {
      novas.push({ chave, nome: item.categoria })
    }
  }

  try {
    if (novas.length > 0) {
      const ordemBase = existente.categorias.reduce((m, c) => Math.max(m, c.ordem), 0)
      const { data, error } = await db
        .from('categorias')
        .insert(novas.map((n, i) => ({ barraca_id: barracaId, nome: n.nome, ordem: ordemBase + i + 1 })))
        .select('id, nome')
      if (error) throw new Error(error.message)
      for (const c of data ?? []) idPorChave.set(chaveNome(c.nome), c.id)
      resumo.categoriasCriadas = (data ?? []).length
      // O insert tem de devolver todas as categorias (senão os itens ficariam sem categoria em silêncio).
      const faltou = novas.find((n) => !idPorChave.has(n.chave))
      if (faltou) throw new Error(`a categoria "${faltou.nome}" não foi confirmada pelo banco`)
    }

    let ordem = existente.itens.reduce((m, i) => Math.max(m, i.ordem), 0)
    const linhas = itens.map((item) => {
      ordem += 1
      const registro: Record<string, unknown> = {
        barraca_id: barracaId,
        nome: item.nome,
        preco_centavos: item.precoCentavos,
        categoria_id: chaveDoItem(item) ? (idPorChave.get(chaveDoItem(item)!) ?? null) : null,
        descricao: item.descricao,
        ativo: item.ativo,
        ordem,
      }
      // Só manda a coluna quando precisa (banco sem a migration do valor livre não conhece `preco_aberto`).
      if (item.precoAberto) registro.preco_aberto = true
      return registro
    })

    for (const lote of emLotes(linhas, TAMANHO_LOTE_ITENS)) {
      const { error } = await db.from('itens').insert(lote)
      if (error) throw new Error(error.message)
      resumo.itensCriados += lote.length
      aoProgredir?.(resumo.itensCriados, linhas.length)
    }
  } catch (e) {
    throw new ErroImportacaoCardapio(e instanceof Error ? e.message : 'erro desconhecido', { ...resumo })
  }
  return resumo
}
