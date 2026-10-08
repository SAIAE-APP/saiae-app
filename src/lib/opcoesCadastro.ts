// Cadastro de grupos de opções em Ajustes (SAI-010a). Lógica PURA (sem React nem Supabase): validações
// do formulário, modelos prontos e cálculos de apoio. Espelha as regras do banco para o dono ver o
// erro na tela, em vez de uma falha de constraint:
//   * variação: no máximo UMA por item; sempre escolha única e obrigatória (min = max = 1);
//     o preço da opção é ABSOLUTO (substitui o base), então precisa ser maior que zero;
//   * adicional: obrigatório (min 1) ou opcional (min 0); limite de escolhas de 1 a 20 ou sem limite;
//   * grupo obrigatório sem opção disponível deixa os itens ligados indisponíveis (aviso).
import { CENTAVOS_MAX, reaisParaCentavos } from './preco.ts'

export type TipoGrupo = 'variacao' | 'adicional'

export const MAX_NOME = 60
export const MAX_ESCOLHAS = 20

export type RascunhoOpcao = {
  /** null = opção nova (ainda não existe no banco). */
  id: string | null
  nome: string
  precoTexto: string
  ativo: boolean
  esgotado: boolean
}

export type RascunhoGrupo = {
  nome: string
  tipo: TipoGrupo
  obrigatorio: boolean
  /** Vazio = sem limite (só adicional). */
  maximoTexto: string
  ativo: boolean
  opcoes: RascunhoOpcao[]
  itemIds: string[]
}

export type GrupoCadastro = {
  id: string
  nome: string
  tipo: TipoGrupo
  min_escolhas: number
  max_escolhas: number | null
  ordem: number
  ativo: boolean
}

export type OpcaoCadastro = {
  id: string
  grupo_id: string
  nome: string
  preco_centavos: number
  ordem: number
  ativo: boolean
  esgotado: boolean
}

export type LigacaoCadastro = { item_id: string; grupo_id: string; ordem: number }

export function rascunhoVazio(tipo: TipoGrupo): RascunhoGrupo {
  return { nome: '', tipo, obrigatorio: tipo === 'variacao', maximoTexto: '', ativo: true, opcoes: [], itemIds: [] }
}

export function opcaoVazia(): RascunhoOpcao {
  return { id: null, nome: '', precoTexto: '', ativo: true, esgotado: false }
}

/** min/max gravados no banco. Variação é sempre 1/1; o limite inválido vira null aqui e é barrado em `validarRascunho`. */
export function limitesDoGrupo(r: Pick<RascunhoGrupo, 'tipo' | 'obrigatorio' | 'maximoTexto'>): { min: number; max: number | null } {
  if (r.tipo === 'variacao') return { min: 1, max: 1 }
  const texto = r.maximoTexto.trim()
  const max = texto === '' || !/^\d+$/.test(texto) ? null : Number(texto)
  return { min: r.obrigatorio ? 1 : 0, max }
}

function precoValido(texto: string): { ok: boolean; centavos: number } {
  const limpo = texto.trim()
  if (limpo === '') return { ok: true, centavos: 0 }
  if (!/^\d+([.,]\d{0,2})?$/.test(limpo)) return { ok: false, centavos: 0 }
  const centavos = reaisParaCentavos(limpo)
  // reaisParaCentavos trunca em CENTAVOS_MAX: valor maior que o teto é recusado em vez de cortado.
  const [inteiro] = limpo.replace(',', '.').split('.')
  return { ok: Number(inteiro) * 100 <= CENTAVOS_MAX, centavos }
}

export function precoCentavosDaOpcao(o: Pick<RascunhoOpcao, 'precoTexto'>): number {
  return precoValido(o.precoTexto).centavos
}

/** Erros que impedem salvar (mensagens para o dono). */
export function validarRascunho(r: RascunhoGrupo): string[] {
  const erros: string[] = []
  const nome = r.nome.trim()
  if (!nome) erros.push('Dê um nome ao grupo.')
  else if (nome.length > MAX_NOME) erros.push(`O nome do grupo pode ter até ${MAX_NOME} letras.`)

  if (r.tipo === 'adicional') {
    const texto = r.maximoTexto.trim()
    if (texto !== '') {
      const n = /^\d+$/.test(texto) ? Number(texto) : NaN
      if (!(n >= 1 && n <= MAX_ESCOLHAS)) erros.push(`O limite de escolhas deve ser de 1 a ${MAX_ESCOLHAS} (ou deixe vazio para sem limite).`)
    }
  }

  const ativas = r.opcoes.filter((o) => o.ativo)
  if (ativas.length === 0) erros.push('Cadastre pelo menos uma opção ativa.')

  const vistos = new Set<string>()
  for (const o of r.opcoes) {
    const n = o.nome.trim()
    if (!n) {
      erros.push('Toda opção precisa de um nome.')
      continue
    }
    if (n.length > MAX_NOME) erros.push(`O nome da opção "${n.slice(0, 20)}…" passa de ${MAX_NOME} letras.`)
    if (o.ativo) {
      const chave = n.toLocaleLowerCase('pt-BR')
      if (vistos.has(chave)) erros.push(`A opção "${n}" aparece duas vezes.`)
      vistos.add(chave)
    }
    const preco = precoValido(o.precoTexto)
    if (!preco.ok) erros.push(`Preço inválido em "${n}".`)
    else if (r.tipo === 'variacao' && o.ativo && preco.centavos <= 0) {
      erros.push(`Informe o preço de "${n}": na variação ele substitui o preço do item.`)
    }
  }
  return [...new Set(erros)]
}

/** Avisos (não impedem salvar). */
export function avisosDoRascunho(r: RascunhoGrupo): string[] {
  const avisos: string[] = []
  const limites = limitesDoGrupo(r)
  const disponiveis = r.opcoes.filter((o) => o.ativo && !o.esgotado)
  if (r.ativo && limites.min >= 1 && disponiveis.length === 0 && r.itemIds.length > 0) {
    avisos.push('Todas as opções estão esgotadas ou inativas: os itens ligados a este grupo ficam indisponíveis.')
  }
  if (r.ativo && r.itemIds.length === 0) avisos.push('Nenhum item usa este grupo ainda.')
  return avisos
}

/** Itens que já têm OUTRA variação (um item só pode ter uma). */
export function itensBloqueadosPorVariacao(
  grupoId: string | null,
  grupos: Pick<GrupoCadastro, 'id' | 'tipo'>[],
  ligacoes: Pick<LigacaoCadastro, 'item_id' | 'grupo_id'>[],
): Set<string> {
  const variacoes = new Set(grupos.filter((g) => g.tipo === 'variacao' && g.id !== grupoId).map((g) => g.id))
  return new Set(ligacoes.filter((l) => variacoes.has(l.grupo_id)).map((l) => l.item_id))
}

export function diffLigacoes(atual: string[], novo: string[]): { inserir: string[]; remover: string[] } {
  const a = new Set(atual)
  const n = new Set(novo)
  return { inserir: [...n].filter((id) => !a.has(id)), remover: [...a].filter((id) => !n.has(id)) }
}

/** Itens ligados a grupo ativo e obrigatório sem nenhuma opção disponível => item -> nome do grupo. */
export function itensIndisponiveis(
  grupos: GrupoCadastro[],
  opcoes: OpcaoCadastro[],
  ligacoes: LigacaoCadastro[],
): Map<string, string> {
  const resultado = new Map<string, string>()
  for (const g of grupos) {
    if (!g.ativo || g.min_escolhas < 1) continue
    if (opcoes.some((o) => o.grupo_id === g.id && o.ativo && !o.esgotado)) continue
    for (const l of ligacoes) if (l.grupo_id === g.id && !resultado.has(l.item_id)) resultado.set(l.item_id, g.nome)
  }
  return resultado
}

export function resumoDoGrupo(g: Pick<GrupoCadastro, 'tipo' | 'min_escolhas' | 'max_escolhas'>): string {
  if (g.tipo === 'variacao') return 'Variação · escolha 1'
  const obrigatorio = g.min_escolhas >= 1 ? 'obrigatório' : 'opcional'
  return `Adicional · ${obrigatorio}${g.max_escolhas !== null ? ` · até ${g.max_escolhas}` : ''}`
}

/** Modelos prontos: abrem o formulário já preenchido (sem preços: o dono completa antes de salvar). */
export const MODELOS_DE_GRUPO: { id: string; titulo: string; descricao: string; criar: () => RascunhoGrupo }[] = [
  {
    id: 'tamanho',
    titulo: 'Tamanho (P / M / G)',
    descricao: 'O cliente escolhe um tamanho; o preço de cada um substitui o preço do item.',
    criar: () => ({
      ...rascunhoVazio('variacao'),
      nome: 'Tamanho',
      opcoes: ['Pequeno', 'Médio', 'Grande'].map((nome) => ({ ...opcaoVazia(), nome })),
    }),
  },
  {
    id: 'adicionais',
    titulo: 'Adicionais',
    descricao: 'Extras opcionais somados ao preço do item.',
    criar: () => ({
      ...rascunhoVazio('adicional'),
      nome: 'Adicionais',
      opcoes: ['Queijo extra', 'Bacon', 'Ovo'].map((nome) => ({ ...opcaoVazia(), nome })),
    }),
  },
]

/** Cópia para outro conjunto de itens: sem ids (tudo vira novo) e sem itens ligados. */
export function duplicarRascunho(r: RascunhoGrupo): RascunhoGrupo {
  const nome = `${r.nome.trim()} (cópia)`.slice(0, MAX_NOME)
  return { ...r, nome, itemIds: [], opcoes: r.opcoes.map((o) => ({ ...o, id: null })) }
}

export function centavosParaTexto(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

/** Formulário de edição a partir do que está no banco. */
export function rascunhoDoGrupo(
  g: GrupoCadastro,
  opcoes: OpcaoCadastro[],
  ligacoes: Pick<LigacaoCadastro, 'item_id' | 'grupo_id'>[],
): RascunhoGrupo {
  return {
    nome: g.nome,
    tipo: g.tipo,
    obrigatorio: g.min_escolhas >= 1,
    maximoTexto: g.tipo === 'adicional' && g.max_escolhas !== null ? String(g.max_escolhas) : '',
    ativo: g.ativo,
    opcoes: opcoes
      .filter((o) => o.grupo_id === g.id)
      .sort((a, b) => a.ordem - b.ordem)
      .map((o) => ({ id: o.id, nome: o.nome, precoTexto: centavosParaTexto(o.preco_centavos), ativo: o.ativo, esgotado: o.esgotado })),
    itemIds: ligacoes.filter((l) => l.grupo_id === g.id).map((l) => l.item_id),
  }
}
