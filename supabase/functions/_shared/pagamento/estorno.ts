// Regras puras do estorno do pedido pago online (sem rede e sem Deno; testadas em Node, pagamento.test.ts).
// A edge function estornar-pagamento só liga as peças (banco, token, provedor).
//
// Estorno só TOTAL (itens + entrega + taxa Sai aê voltam juntos), disparado pelo dono ao cancelar. Recusa do
// provedor (ex.: saldo insuficiente da barraca) NÃO cancela o pedido: o caso vai para o suporte do provedor.
import { chaveDoProvedor } from './registro.ts'
import type { ResultadoTokenVendedor } from './token.ts'
import { ErroProvedor, type ProvedorPix } from './tipos.ts'
import { tokenDoWebhook } from './webhookAprovado.ts'

export type CodigoEstorno = 'saldo_insuficiente' | 'nao_pago_online' | 'ja_estornado' | 'recusado'

export type RespostaEstorno = {
  status: number
  corpo: { ok: true; codigo?: 'ja_estornado' } | { erro: string; codigo?: CodigoEstorno }
}

export type DepsEstorno = {
  /** Barraca do pedido, ou null se o pedido não existe. */
  barracaDoPedido: (pedidoId: string) => Promise<string | null>
  /** O usuário da requisição é dono (papel 'dono') desta barraca? */
  ehDono: (barracaId: string) => Promise<boolean>
  pendentesDoPedido: (pedidoId: string, barracaId: string) => Promise<Record<string, unknown>[]>
  vendedor: (barracaId: string) => Promise<ResultadoTokenVendedor>
  colado: (barracaId: string, provedor: ProvedorPix['chave']) => Promise<string | null>
  provedor: (chave: unknown) => ProvedorPix | null
  /** Grava `estornado_em`; false = falhou ao gravar. */
  marcarEstornado: (pendenteId: string) => Promise<boolean>
}

// Mesmo texto para pedido inexistente e pedido de outra barraca: não revela se o pedido existe.
const SEM_ACESSO: RespostaEstorno = { status: 403, corpo: { erro: 'Sem acesso a este pedido.' } }
const NAO_PAGO: RespostaEstorno = {
  status: 422,
  corpo: { erro: 'Este pedido não foi pago online, não há o que estornar.', codigo: 'nao_pago_online' },
}

/** Pendente que de fato cobrou o pedido: aprovado e com o id do pagamento no provedor. */
function pendentePago(linhas: Record<string, unknown>[]): Record<string, unknown> | null {
  return linhas.find((l) => l.status === 'aprovado' && typeof l.mercadopago_order_id === 'string' && l.mercadopago_order_id) ?? null
}

export async function estornarPedido(pedidoId: string, deps: DepsEstorno): Promise<RespostaEstorno> {
  const barracaId = await deps.barracaDoPedido(pedidoId)
  if (!barracaId || !(await deps.ehDono(barracaId))) return SEM_ACESSO

  const pendente = pendentePago(await deps.pendentesDoPedido(pedidoId, barracaId))
  if (!pendente) return NAO_PAGO
  // Idempotente: já estornado é sucesso, sem falar com o provedor de novo.
  if (pendente.estornado_em) return { status: 200, corpo: { ok: true, codigo: 'ja_estornado' } }

  const provedor = deps.provedor(chaveDoProvedor(pendente.provedor))
  if (!provedor?.estornar) return { status: 422, corpo: { erro: 'Estorno indisponível para este meio de pagamento.' } }

  // A mesma credencial que cobrou: com taxa Sai aê = OAuth do vendedor; sem taxa = token colado. Nunca cai no outro.
  const credencial = await tokenDoWebhook(pendente, {
    vendedor: () => deps.vendedor(barracaId),
    colado: () => deps.colado(barracaId, provedor.chave),
  })
  if (!credencial.ok) {
    return {
      status: 503,
      corpo: { erro: `A conexão da loja com o ${provedor.nome} não está disponível. Reconecte em Ajustes e tente de novo.` },
    }
  }

  let resultado: Awaited<ReturnType<NonNullable<ProvedorPix['estornar']>>>
  try {
    resultado = await provedor.estornar({
      token: credencial.token,
      idExterno: String(pendente.mercadopago_order_id),
      // Fixa por pendente: repetir depois de um timeout devolve o mesmo estorno, nunca dois.
      chaveIdempotencia: `estorno-${pendente.id}`,
    })
  } catch (e) {
    if (e instanceof ErroProvedor) {
      return { status: 502, corpo: { erro: `Não foi possível falar com o ${provedor.nome}. Tente de novo em instantes.` } }
    }
    throw e
  }

  if (!resultado.ok) {
    return resultado.motivo === 'saldo_insuficiente'
      ? {
          status: 409,
          corpo: {
            erro: `A conta ${provedor.nome} da loja não tem saldo para devolver este pagamento. O pedido NÃO foi cancelado. Procure o suporte do ${provedor.nome}.`,
            codigo: 'saldo_insuficiente',
          },
        }
      : {
          status: 409,
          corpo: {
            erro: `O ${provedor.nome} recusou o estorno. O pedido NÃO foi cancelado. Procure o suporte do ${provedor.nome}.`,
            codigo: 'recusado',
          },
        }
  }

  if (!(await deps.marcarEstornado(String(pendente.id)))) {
    return { status: 500, corpo: { erro: 'O estorno foi feito, mas não foi registrado. Toque de novo para concluir.' } }
  }
  return { status: 200, corpo: { ok: true } }
}
