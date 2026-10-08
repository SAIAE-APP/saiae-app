// Pedido GRÁTIS no cardápio digital: o cupom cobre tudo (e não há taxa de entrega a pagar). Não existe Pix:
// o botão vira "Finalizar pedido grátis" e a senha aparece direto. O servidor decide e recalcula tudo; aqui só
// o que a tela mostra. Funções puras, testadas em tests/pedidoGratis.front.test.ts.

/** Total que o cliente vê (itens − desconto + taxa) igual a zero. */
export function ehPedidoGratis(totalCobradoCentavos: number | null): boolean {
  return totalCobradoCentavos === 0
}

/** Telefone com DDD (10 a 13 dígitos, com ou sem o 55): o servidor exige telefone para liberar pedido grátis. */
export function telefoneServePedidoGratis(telefone: string): boolean {
  const d = telefone.replace(/\D/g, '')
  return d.length >= 10 && d.length <= 13
}

export const TEXTO_BOTAO_PEDIDO_GRATIS = 'Finalizar pedido grátis'
export const AVISO_TELEFONE_PEDIDO_GRATIS = 'Informe seu WhatsApp com DDD para finalizar o pedido grátis.'

/** Resposta de sucesso do `criar-pagamento-pix` quando o pedido saiu grátis (sem QR). */
export function lerPedidoGratis(data: unknown): { senha: number | null } | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as { pedido_gratis?: unknown; senha?: unknown }
  if (d.pedido_gratis !== true) return null
  return { senha: typeof d.senha === 'number' ? d.senha : null }
}
