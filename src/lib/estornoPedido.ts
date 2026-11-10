// Qual ação de estorno o card do Histórico oferece (testes em tests/estornarPagamento.test.ts).
//
// Só pedido pago online pelo OAuth (taxa Sai aê > 0 ou `pago_online_oauth`) e só para o dono. Pedido aberto ou entregue: cancela e estorna.
// Pedido já cancelado (ex.: pela Cozinha, que não estorna): o cliente continua cobrado, então oferece só o estorno.
// O app não lê `pagamentos_pendentes.estornado_em`; `estornadoAqui` esconde o botão depois do estorno nesta tela, e
// repetir em outra visita é seguro (o servidor responde `ja_estornado` sem estornar de novo).
export type AcaoEstorno = 'cancelar_e_estornar' | 'estornar' | null

export function acaoDeEstorno(
  pedido: { status: string; taxa_plataforma_centavos?: number | null; pago_online_oauth?: boolean | null },
  souDono: boolean,
  estornadoAqui: boolean,
): AcaoEstorno {
  // Pago pelo OAuth: com taxa Sai aê, ou sem (cliente recusou a taxa opcional, `pago_online_oauth`).
  const pagoPeloOauth = pedido.pago_online_oauth === true || (pedido.taxa_plataforma_centavos ?? 0) > 0
  if (!souDono || estornadoAqui || !pagoPeloOauth) return null
  return pedido.status === 'cancelado' ? 'estornar' : 'cancelar_e_estornar'
}
