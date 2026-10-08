// Pedido GRÁTIS: o cupom cobre tudo e não há taxa de entrega a pagar (total cobrado = 0). Não existe cobrança
// no provedor Pix: o pedido nasce na mesma transação que confirma o uso do cupom. Funções puras, testadas em
// tests/pedidoGratis.test.ts.
export const METODO_GRATIS = 'gratis'

/** Só o total cobrado ZERO é grátis; com taxa de entrega > 0 segue o Pix normal (só da taxa). */
export function ehPedidoGratis(totalCobradoCentavos: number): boolean {
  return totalCobradoCentavos === 0
}

/** Telefone (só dígitos) exigido para liberar pedido grátis: dificulta uso em massa sem identificação. */
export function telefoneDoPedidoGratis(a: {
  telefoneEntrega: string | null | undefined
  telefoneAviso: string | null | undefined
}): string | null {
  const t = String(a.telefoneEntrega ?? a.telefoneAviso ?? '').replace(/\D/g, '')
  return t.length >= 8 && t.length <= 15 ? t : null
}

/** Argumentos de `criar_pedido_com_cupom` para o pedido grátis (mesmo molde do webhook do Pix). */
export function argsPedidoGratis(p: {
  usoId: string
  barracaId: string
  mesa: string | null
  viagem: boolean
  observacao: string | null
  clientUuid: string
  itens: unknown
  entrega: Record<string, unknown> | null
  taxaEntregaCentavos: number
  clienteNome: string | null
  clienteTelefone: string | null
}): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_uso_id: p.usoId,
    p_barraca_id: p.barracaId,
    p_mesa: p.mesa,
    p_viagem: p.viagem,
    p_observacao: p.observacao,
    p_client_uuid: p.clientUuid,
    p_metodo_pagamento: METODO_GRATIS,
    p_itens: p.itens,
  }
  if (p.entrega) {
    args.p_tipo_atendimento = 'entrega'
    args.p_entrega = {
      nome: p.entrega.nome,
      telefone: p.entrega.telefone,
      rua: p.entrega.rua,
      numero: p.entrega.numero,
      bairro: p.entrega.bairro,
      referencia: p.entrega.referencia,
    }
    args.p_taxa_entrega_centavos = p.taxaEntregaCentavos
  }
  if (p.clienteNome) args.p_cliente_nome = p.clienteNome
  if (p.clienteTelefone) args.p_cliente_telefone = p.clienteTelefone
  return args
}
