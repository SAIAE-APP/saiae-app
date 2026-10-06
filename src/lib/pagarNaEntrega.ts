import { formatarPrecoBR } from './preco'

/** Só dígitos do número do dono, com o 55 do Brasil quando vier só DDD+número. */
export function numeroWhatsapp(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '')
  return digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos
}

export type ResumoPedidoEntrega = {
  nomeBarraca: string
  senha: number | null
  nome: string
  telefone: string
  endereco: string
  observacao: string
  itens: { nome_item: string; quantidade: number; preco_centavos_unitario: number }[]
  /** Total já com a taxa. */
  totalCentavos: number
  /** Taxa de entrega calculada pelo servidor (0/ausente = sem linha de taxa). */
  taxaCentavos?: number
}

/** Texto do WhatsApp pro dono. Itens e valores vêm da resposta do servidor
 * (preço real), nunca do carrinho do navegador. */
export function montarMensagemPagarNaEntrega(r: ResumoPedidoEntrega): string {
  const linhas = [
    `*Novo pedido - pagar na entrega*${r.senha !== null ? ` (senha ${String(r.senha).padStart(3, '0')})` : ''}`,
    `Barraca: ${r.nomeBarraca}`,
    '',
    ...r.itens.map(
      (i) => `${i.quantidade}x ${i.nome_item} - ${formatarPrecoBR(i.preco_centavos_unitario * i.quantidade)}`,
    ),
    '',
    ...((r.taxaCentavos ?? 0) > 0
      ? [`Subtotal: ${formatarPrecoBR(r.totalCentavos - (r.taxaCentavos ?? 0))}`, `Taxa de entrega: ${formatarPrecoBR(r.taxaCentavos ?? 0)}`]
      : []),
    `*Total: ${formatarPrecoBR(r.totalCentavos)}* (pago na entrega)`,
    '',
    `Cliente: ${r.nome}`,
    `Telefone: ${r.telefone}`,
  ]
  if (r.endereco.trim()) linhas.push(`Endereço: ${r.endereco.trim()}`)
  if (r.observacao.trim()) linhas.push(`Obs: ${r.observacao.trim()}`)
  return linhas.join('\n')
}

export function urlWhatsappDono(numeroDono: string, mensagem: string): string {
  return `https://wa.me/${numeroWhatsapp(numeroDono)}?text=${encodeURIComponent(mensagem)}`
}
