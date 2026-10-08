// Corrida de notificações do provedor (duas chegam quase juntas). `criar_pedido` é idempotente por
// client_uuid, mas na corrida a 2ª chamada pode bater na restrição de unicidade antes de ver a
// linha da 1ª: o banco devolve 23505 em `pedidos_client_uuid_key`. Isso NÃO é falha: o pedido já
// existe e basta ligá-lo à cobrança. Qualquer outro erro continua sendo falha (500 + conciliação).

export type ErroRpc = { code?: string | null; message?: string | null } | null | undefined

/** Violação da unicidade de `pedidos.client_uuid` (pedido já criado por outra notificação). */
export function ehConflitoClientUuid(erro: ErroRpc): boolean {
  if (!erro) return false
  const mensagem = erro.message ?? ''
  return erro.code === '23505' && /pedidos_client_uuid_key/.test(mensagem)
}

export type DesfechoCriacao =
  | { acao: 'criado'; pedidoId: string }
  | { acao: 'ja_existia'; pedidoId: string }
  | { acao: 'falha'; detalhe: string }

/**
 * Decide o desfecho de `criar_pedido`. `buscarPorClientUuid` só é chamada no conflito de client_uuid
 * e devolve o id do pedido que já existe (ou null).
 */
export async function desfechoDaCriacao(
  resultado: { pedido_id?: string } | null | undefined,
  erro: ErroRpc,
  buscarPorClientUuid: () => Promise<string | null>,
): Promise<DesfechoCriacao> {
  if (!erro && resultado?.pedido_id) return { acao: 'criado', pedidoId: resultado.pedido_id }
  if (ehConflitoClientUuid(erro)) {
    const existente = await buscarPorClientUuid()
    if (existente) return { acao: 'ja_existia', pedidoId: existente }
  }
  return { acao: 'falha', detalhe: String(erro?.message ?? 'sem resposta') }
}
