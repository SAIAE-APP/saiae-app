import { normalizarTelefone } from './entrega.ts'

export type ContatoMarketing = { p_barraca_id: string; p_telefone: string; p_nome: string | null }

/**
 * Contato de balcão que aceitou promoções por WhatsApp. Só existe quando o módulo de disparos está ligado na loja, o
 * pedido não é de Entrega (esse já grava o cliente pelo formulário), o número tem 8 a 15 dígitos e o operador marcou
 * que o cliente aceitou. Sem a marca nada é guardado: o telefone do aviso de "pronto" continua só no pedido.
 */
export function contatoMarketingDoPedido(a: {
  barracaId: string
  disparosHabilitado: boolean | undefined
  ehEntrega: boolean
  telefone: string
  nome: string
  aceitaPromocoes: boolean
}): ContatoMarketing | null {
  if (!a.disparosHabilitado || a.ehEntrega || !a.aceitaPromocoes) return null
  const telefone = normalizarTelefone(a.telefone)
  if (telefone.length < 8 || telefone.length > 15) return null
  return { p_barraca_id: a.barracaId, p_telefone: telefone, p_nome: a.nome.trim() || null }
}
