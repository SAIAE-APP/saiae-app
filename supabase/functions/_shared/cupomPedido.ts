// Cupom dentro dos fluxos de pedido do cardápio (Pix e "pagar na entrega"). A regra e o cálculo ficam no
// banco (cupom_avaliar / cupom_reservar); aqui só a sequência comum às duas funções.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { interpretarAvaliacao, mensagemDoErro, normalizarCodigo, type ResultadoAvaliacao } from './cupom.ts'

type Falha = { ok: false; status: number; corpo: Record<string, unknown> }

/** Conta a tentativa (mesmo limite de adivinhação do cupom-validar) e avalia SEM gravar.
 * Sem código enviado: `{ ok: true, codigo: null, desconto: 0 }` e nada é consultado. */
export async function avaliarCupomDoPedido(
  supabase: SupabaseClient,
  a: { barracaId: string; codigoBruto: unknown; subtotalCentavos: number; clienteId: string | null; ipHash: string },
): Promise<{ ok: true; codigo: string | null; desconto: number } | Falha> {
  const bruto = String(a.codigoBruto ?? '').trim()
  if (bruto === '') return { ok: true, codigo: null, desconto: 0 }

  const codigo = normalizarCodigo(bruto)
  const limite = await supabase.rpc('cupom_registrar_tentativa', {
    p_barraca_id: a.barracaId,
    p_ip_hash: a.ipHash,
    p_valida: codigo !== null,
  })
  if (limite.error || limite.data === false) {
    return { ok: false, status: 429, corpo: { erro: 'Muitas tentativas. Tente de novo em alguns minutos.', codigo: 'cupom_tentativas' } }
  }
  if (!codigo) return { ok: false, status: 422, corpo: { erro: mensagemDoErro('invalido'), codigo: 'cupom_invalido' } }

  const { data, error } = await supabase.rpc('cupom_avaliar', {
    p_barraca_id: a.barracaId,
    p_codigo: codigo,
    p_subtotal_centavos: a.subtotalCentavos,
    p_cliente_id: a.clienteId,
  })
  if (error) {
    console.error('cupom: cupom_avaliar falhou')
    return { ok: false, status: 500, corpo: { erro: 'Não foi possível validar o cupom agora. Tente de novo.' } }
  }
  const av = interpretarAvaliacao(data)
  if (!av.ok) {
    return { ok: false, status: 422, corpo: { erro: mensagemDoErro(av.erro, av.minimo_centavos), codigo: 'cupom_invalido' } }
  }
  return { ok: true, codigo, desconto: av.desconto_centavos }
}

/** Reserva atômica no banco. `pendenteId` null = "pagar na entrega" (sem cobrança a esperar). */
export async function reservarCupomDoPedido(
  supabase: SupabaseClient,
  a: {
    barracaId: string
    codigo: string
    subtotalCentavos: number
    clienteId: string | null
    pendenteId: string | null
    reservadoAte: Date
  },
): Promise<{ ok: true; reserva: Extract<ResultadoAvaliacao, { ok: true }> } | Falha> {
  const { data, error } = await supabase.rpc('cupom_reservar', {
    p_barraca_id: a.barracaId,
    p_codigo: a.codigo,
    p_subtotal_centavos: a.subtotalCentavos,
    p_cliente_id: a.clienteId,
    p_pendente_id: a.pendenteId,
    p_reservado_ate: a.reservadoAte.toISOString(),
  })
  if (error) {
    console.error('cupom: cupom_reservar falhou')
    return { ok: false, status: 500, corpo: { erro: 'Não foi possível aplicar o cupom agora. Tente de novo.' } }
  }
  const r = interpretarAvaliacao(data)
  if (!r.ok) {
    // Perdeu a corrida (esgotou, venceu...) entre a avaliação e a reserva: nada foi cobrado nem criado.
    return { ok: false, status: 422, corpo: { erro: mensagemDoErro(r.erro, r.minimo_centavos), codigo: 'cupom_invalido' } }
  }
  return { ok: true, reserva: r }
}
