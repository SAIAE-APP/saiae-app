// Regras PURAS do estoque por item (Sprint 6). A baixa/devolução acontece no
// banco (triggers); aqui só o que a tela precisa: saldo, avisos e leitura dos
// campos digitados. Sem rede, testável em Node.

/** Saldo igual ou abaixo disso mostra "Restam N" / aviso de estoque baixo (só visual). */
export const ESTOQUE_BAIXO = 5

type ComEstoque = { estoque_qtd?: number | null }

export type NivelEstoque = 'negativo' | 'zerado' | 'baixo' | 'ok'

/** Item controla estoque? (`estoque_qtd` NULL = não controla, comportamento de sempre.) */
export function controlaEstoque(item: ComEstoque): item is { estoque_qtd: number } {
  return typeof item.estoque_qtd === 'number'
}

export function nivelDeEstoque(item: ComEstoque): NivelEstoque | null {
  if (!controlaEstoque(item)) return null
  if (item.estoque_qtd < 0) return 'negativo'
  if (item.estoque_qtd === 0) return 'zerado'
  if (item.estoque_qtd <= ESTOQUE_BAIXO) return 'baixo'
  return 'ok'
}

/** "Restam N" no Lançar Pedido: só com saldo baixo e positivo (zero/negativo já é "Esgotado"). */
export function textoRestam(item: ComEstoque): string | null {
  return nivelDeEstoque(item) === 'baixo' ? `Restam ${item.estoque_qtd}` : null
}

export type AvisoEstoque = { nivel: Exclude<NivelEstoque, 'ok'>; texto: string; destaque: 'erro' | 'aviso' }

/** Aviso da lista de itens em Ajustes: negativo/zerado em destaque, baixo só visual. */
export function avisoDeEstoque(item: ComEstoque): AvisoEstoque | null {
  const nivel = nivelDeEstoque(item)
  if (nivel === 'negativo') {
    return { nivel, texto: 'Estoque negativo: vendido além do saldo', destaque: 'erro' }
  }
  if (nivel === 'zerado') return { nivel, texto: 'Sem estoque', destaque: 'erro' }
  if (nivel === 'baixo') return { nivel, texto: `Estoque baixo: restam ${item.estoque_qtd}`, destaque: 'aviso' }
  return null
}

const LIMITE = 1_000_000

/** Saldo inicial digitado: inteiro >= 0. Vazio ou inválido = null. */
export function interpretarSaldoInicial(texto: string): number | null {
  const limpo = texto.trim()
  if (!/^\d{1,7}$/.test(limpo)) return null
  const n = Number(limpo)
  return n <= LIMITE ? n : null
}

/** Ajuste digitado (+ repõe, - baixa): inteiro diferente de zero. Vazio, 0 ou inválido = null. */
export function interpretarAjuste(texto: string): number | null {
  const limpo = texto.trim().replace(/^\+/, '')
  if (!/^-?\d{1,7}$/.test(limpo)) return null
  const n = Number(limpo)
  return n !== 0 && Math.abs(n) <= LIMITE ? n : null
}

/** Mensagem do estado devolvido por `ajustar_estoque`. */
export function mensagemAjusteEstoque(estado: string | undefined): string {
  switch (estado) {
    case 'sem_acesso':
      return 'Sem permissão para alterar o estoque deste item.'
    case 'nao_autenticado':
      return 'Sua sessão expirou. Entre de novo e tente outra vez.'
    case 'delta_invalido':
      return 'Quantidade inválida.'
    default:
      return 'Não foi possível ajustar o estoque. Tente de novo.'
  }
}

/** Texto de uma movimentação do histórico do item. */
export function rotuloMovimento(motivo: string): string {
  switch (motivo) {
    case 'venda':
      return 'Venda'
    case 'cancelamento':
      return 'Devolvido (pedido cancelado)'
    case 'remocao':
      return 'Devolvido (item removido)'
    case 'ajuste':
      return 'Ajuste manual'
    default:
      return motivo
  }
}
