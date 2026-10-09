// "Revisar cardápio de exemplo" (kits iniciais, PR 5): lógica PURA, sem React nem Supabase.
// O kit cria itens inativos e sem preço, e opções que custam dinheiro inativas. O dono marca o que vai usar e informa o
// preço; só então o item/opção é ativado. Nada vendável nasce sem o dono (spec K1/K2).
import { CENTAVOS_MAX, reaisParaCentavos } from './preco.ts'

export type LinhaItemRevisao = {
  id: string
  nome: string
  categoria: string
  precoTexto: string
  usar: boolean
  /** Chaves de grupo de variação a que o item está ligado (para avisar de item que não ficará pedível). */
  variacaoId: string | null
}

export type LinhaOpcaoRevisao = {
  id: string
  grupoId: string
  grupoNome: string
  tipo: 'variacao' | 'adicional'
  nome: string
  precoTexto: string
  usar: boolean
}

export type PlanoDeRevisao = {
  itens: { id: string; nome: string; preco_centavos: number; ativo: true }[]
  opcoes: { id: string; preco_centavos: number; ativo: true }[]
  /** Erros por linha (`item:<id>` ou `opcao:<id>`), em frase simples. Vazio = pode salvar. */
  erros: Record<string, string>
  /** Avisos que não impedem salvar (ex.: item com tamanho obrigatório e nenhum tamanho ativo). */
  avisos: string[]
}

const MAX_NOME = 60

function preco(texto: string): { ok: boolean; centavos: number; vazio: boolean } {
  const limpo = texto.trim()
  if (limpo === '') return { ok: true, centavos: 0, vazio: true }
  if (!/^\d+([.,]\d{0,2})?$/.test(limpo)) return { ok: false, centavos: 0, vazio: false }
  const [inteiro] = limpo.replace(',', '.').split('.')
  return { ok: Number(inteiro) * 100 <= CENTAVOS_MAX, centavos: reaisParaCentavos(limpo), vazio: false }
}

/**
 * O que gravar. Só entra no plano o que o dono marcou ("usar") e preencheu direito; linha sem marca fica como está
 * (inativa). Item e variação exigem preço maior que zero; adicional pode ficar em branco (= grátis).
 */
export function montarPlano(
  itens: LinhaItemRevisao[],
  opcoes: LinhaOpcaoRevisao[],
  /** Opções de variação que já estão ativas no banco (por grupo), para o aviso de item não pedível. */
  variacoesAtivasNoBanco: ReadonlySet<string> = new Set(),
): PlanoDeRevisao {
  const plano: PlanoDeRevisao = { itens: [], opcoes: [], erros: {}, avisos: [] }

  for (const o of opcoes) {
    if (!o.usar) continue
    const p = preco(o.precoTexto)
    if (!p.ok) plano.erros[`opcao:${o.id}`] = `Preço inválido em "${o.nome}".`
    else if (o.tipo === 'variacao' && p.centavos <= 0) plano.erros[`opcao:${o.id}`] = `Informe o preço de "${o.nome}": ele substitui o preço do item.`
    else plano.opcoes.push({ id: o.id, preco_centavos: p.centavos, ativo: true })
  }

  const variacoesAtivas = new Set(variacoesAtivasNoBanco)
  for (const o of opcoes) if (o.tipo === 'variacao' && plano.opcoes.some((x) => x.id === o.id)) variacoesAtivas.add(o.grupoId)

  for (const i of itens) {
    if (!i.usar) continue
    const nome = i.nome.trim()
    const p = preco(i.precoTexto)
    if (!nome) plano.erros[`item:${i.id}`] = 'Dê um nome ao item.'
    else if (nome.length > MAX_NOME) plano.erros[`item:${i.id}`] = `O nome pode ter até ${MAX_NOME} letras.`
    else if (!p.ok) plano.erros[`item:${i.id}`] = `Preço inválido em "${nome}".`
    else if (p.centavos <= 0) plano.erros[`item:${i.id}`] = `Informe o preço de "${nome}" ou desmarque "Usar".`
    else {
      plano.itens.push({ id: i.id, nome, preco_centavos: p.centavos, ativo: true })
      if (i.variacaoId && !variacoesAtivas.has(i.variacaoId)) {
        plano.avisos.push(`"${nome}" tem tamanho obrigatório e nenhum tamanho está ativo: ele não poderá ser pedido.`)
      }
    }
  }
  return plano
}

/** Pode salvar: sem erros e com algo a gravar. */
export function podeSalvar(plano: PlanoDeRevisao): boolean {
  return Object.keys(plano.erros).length === 0 && (plano.itens.length > 0 || plano.opcoes.length > 0)
}

/** Quantos itens do kit ainda não têm preço (para o resumo "Faltam N itens"). */
export function itensSemPreco(itens: { preco_centavos: number }[]): number {
  return itens.filter((i) => i.preco_centavos === 0).length
}

export function centavosParaCampo(centavos: number): string {
  return centavos > 0 ? (centavos / 100).toFixed(2).replace('.', ',') : ''
}
