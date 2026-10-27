// Cashback dentro dos fluxos de pedido do cardápio (Pix e cartão). A regra e o cálculo ficam no banco
// (cashback_avaliar_resgate / cashback_reservar); aqui só a sequência comum às duas funções, no molde de cupomPedido.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { interpretarResgate, mensagemDoErroCashback } from './cashback.ts'

type Falha = { ok: false; status: number; corpo: Record<string, unknown> }

const ERRO_GENERICO = 'Não foi possível usar o saldo agora. Tente de novo.'

/** Avalia SEM gravar. `usar` diferente de `true` = sem saldo no pedido e nada é consultado.
 * Cupom no mesmo pedido = 422 (SUPOSIÇÃO-CASHBACK-4: um benefício por pedido, cupom OU saldo). */
export async function avaliarCashbackDoPedido(
  supabase: SupabaseClient,
  a: { barracaId: string; usar: unknown; clienteId: string | null; itensCentavos: number; temCupom: boolean },
): Promise<{ ok: true; resgate: number } | Falha> {
  if (a.usar !== true) return { ok: true, resgate: 0 }
  if (a.temCupom) {
    return { ok: false, status: 422, corpo: { erro: mensagemDoErroCashback('cupom_e_saldo'), codigo: 'cashback_e_cupom' } }
  }
  if (!a.clienteId) {
    return { ok: false, status: 401, corpo: { erro: mensagemDoErroCashback('sem_cliente'), codigo: 'cashback_sem_cliente' } }
  }
  const { data, error } = await supabase.rpc('cashback_avaliar_resgate', {
    p_barraca_id: a.barracaId,
    p_cliente_id: a.clienteId,
    p_itens_centavos: a.itensCentavos,
  })
  if (error) {
    console.error('cashback: cashback_avaliar_resgate falhou')
    return { ok: false, status: 500, corpo: { erro: ERRO_GENERICO } }
  }
  const r = interpretarResgate(data)
  if (!r.ok) return { ok: false, status: 422, corpo: { erro: mensagemDoErroCashback(r.erro), codigo: 'cashback_invalido' } }
  return { ok: true, resgate: r.resgate_centavos }
}

/** Reserva atômica no banco, idempotente por cobrança (`pendenteId`). */
export async function reservarCashbackDoPedido(
  supabase: SupabaseClient,
  a: { barracaId: string; clienteId: string; itensCentavos: number; pendenteId: string; reservadoAte: Date },
): Promise<{ ok: true; resgate: number; usoId: string } | Falha> {
  const { data, error } = await supabase.rpc('cashback_reservar', {
    p_barraca_id: a.barracaId,
    p_cliente_id: a.clienteId,
    p_itens_centavos: a.itensCentavos,
    p_pendente_id: a.pendenteId,
    p_reservado_ate: a.reservadoAte.toISOString(),
  })
  if (error) {
    console.error('cashback: cashback_reservar falhou')
    return { ok: false, status: 500, corpo: { erro: ERRO_GENERICO } }
  }
  const r = interpretarResgate(data)
  if (!r.ok) {
    // Perdeu a corrida (saldo gasto em outro pedido) entre a avaliação e a reserva: nada foi cobrado nem criado.
    return { ok: false, status: 422, corpo: { erro: mensagemDoErroCashback(r.erro), codigo: 'cashback_invalido' } }
  }
  // Sem uso_id não há reserva para confirmar no pagamento: melhor falhar agora do que cobrar com desconto sem lastro.
  if (!r.uso_id) {
    console.error('cashback: cashback_reservar sem uso_id')
    return { ok: false, status: 500, corpo: { erro: ERRO_GENERICO } }
  }
  return { ok: true, resgate: r.resgate_centavos, usoId: r.uso_id }
}

/** Checkout refeito: libera a reserva anterior do cliente. Chamar ANTES de avaliar, senão o saldo "esgota" contra a
 * própria reserva. Nunca lança: falha aqui não derruba o pedido (mesmo contrato de liberarReservasAbandonadas). */
export async function liberarCashbackAbandonado(
  supabase: SupabaseClient,
  a: { barracaId: string; clienteId: string | null; pendenteAnteriorId?: string | null },
): Promise<void> {
  if (!a.clienteId) return
  try {
    const { error } = await supabase.rpc('cashback_liberar_abandonadas', {
      p_barraca_id: a.barracaId,
      p_cliente_id: a.clienteId,
      p_pendente_anterior_id: a.pendenteAnteriorId ?? null,
    })
    if (error) console.error('cashback: cashback_liberar_abandonadas falhou')
  } catch {
    console.error('cashback: cashback_liberar_abandonadas lançou')
  }
}
