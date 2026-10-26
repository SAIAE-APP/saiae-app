// Regras puras do webhook de pagamento (sem rede e sem Deno; testadas em Node, pagamento.test.ts).
// A edge function webhook-mercadopago só liga as peças.
import { emitidoViaOauth } from './cobrancaOnline.ts'
import { decidirAprovado, totalEsperadoDoPendente, type DecisaoAprovado } from './conciliacao.ts'
import type { ResultadoTokenVendedor } from './token.ts'
import type { ConsultaPagamento } from './tipos.ts'

export type TokenDoWebhook = { ok: true; token: string } | { ok: false; status: 200 | 500; aviso: string }

/**
 * Token para consultar o provedor de volta: a MESMA credencial que emitiu a cobrança. Pendente com taxa Sai aê
 * foi cobrado pelo OAuth; sem taxa (anterior ao corte), pelo token colado. Falha do OAuth devolve 500 para o
 * provedor reenviar (renovar ou reconectar depois ainda confirma o pagamento); nunca cai no token colado.
 */
export async function tokenDoWebhook(
  pendente: { taxa_plataforma_centavos?: unknown },
  fontes: { vendedor: () => Promise<ResultadoTokenVendedor>; colado: () => Promise<string | null> },
): Promise<TokenDoWebhook> {
  if (!emitidoViaOauth(pendente)) {
    const token = await fontes.colado()
    return token ? { ok: true, token } : { ok: false, status: 200, aviso: 'token da barraca não encontrado' }
  }
  const vendedor = await fontes.vendedor()
  if (vendedor.ok) return { ok: true, token: vendedor.token }
  return {
    ok: false,
    status: 500,
    aviso: vendedor.motivo === 'renovacao_falhou' ? 'renovação do acesso ao Mercado Pago falhou' : 'barraca desconectada do Mercado Pago',
  }
}

type PendenteAprovado = {
  status: string
  itens: unknown
  taxa_entrega_centavos?: unknown
  desconto_cupom_centavos?: unknown
  taxa_plataforma_centavos?: unknown
}

/**
 * Decisão sobre um pagamento aprovado, com os valores DO SNAPSHOT do pendente (nunca recalculados): total =
 * itens − cupom + entrega + taxa Sai aê, e, com taxa, a comissão registrada no provedor tem que ser a mesma.
 */
export function decidirAprovadoDoPendente(
  pendente: PendenteAprovado,
  leitura: Pick<ConsultaPagamento, 'valorCentavos' | 'comissaoCentavos'>,
): { decisao: DecisaoAprovado; totalCentavos: number; taxaEntregaCentavos: number; taxaPlataformaCentavos: number } {
  const taxaEntregaCentavos = Number(pendente.taxa_entrega_centavos ?? 0)
  const taxaPlataformaCentavos = Number(pendente.taxa_plataforma_centavos ?? 0)
  const totalCentavos = totalEsperadoDoPendente(
    pendente.itens as { quantidade: number; preco_centavos_unitario: number }[],
    taxaEntregaCentavos,
    Number(pendente.desconto_cupom_centavos ?? 0),
    taxaPlataformaCentavos,
  )
  const decisao = decidirAprovado({
    statusPendente: pendente.status,
    valorPagoCentavos: leitura.valorCentavos,
    totalEsperadoCentavos: totalCentavos,
    comissaoPagaCentavos: leitura.comissaoCentavos,
    taxaPlataformaEsperadaCentavos: taxaPlataformaCentavos,
  })
  return { decisao, totalCentavos, taxaEntregaCentavos, taxaPlataformaCentavos }
}
