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
  let av: ResultadoAvaliacao = { ok: false, erro: 'invalido' }
  if (codigo) {
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
    av = interpretarAvaliacao(data)
  }

  // Adivinhar código: registra o resultado REAL (só tentativa inválida conta), como o cupom-validar.
  // Passou do limite => 429, mesmo que o palpite estivesse certo.
  const limite = await supabase.rpc('cupom_registrar_tentativa', {
    p_barraca_id: a.barracaId,
    p_ip_hash: a.ipHash,
    p_valida: av.ok,
  })
  if (limite.error || limite.data === false) {
    return { ok: false, status: 429, corpo: { erro: 'Muitas tentativas. Tente de novo em alguns minutos.', codigo: 'cupom_tentativas' } }
  }
  if (!av.ok) {
    return { ok: false, status: 422, corpo: { erro: mensagemDoErro(av.erro, av.minimo_centavos), codigo: 'cupom_invalido' } }
  }
  return { ok: true, codigo: codigo as string, desconto: av.desconto_centavos }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Checkout refeito: libera as reservas abertas do cliente logado e a dos Pix informados (o anterior que o
 * próprio cliente recebeu e a cobrança desta mesma tentativa, em retry). Chamar ANTES de avaliar, senão um
 * cupom de limite 1 "esgota" contra a própria reserva. Falha aqui nunca derruba o pedido. */
export async function liberarReservasAbandonadas(
  supabase: SupabaseClient,
  a: { barracaId: string; clienteId: string | null; pendentesIds: Array<string | null | undefined> },
): Promise<void> {
  const ids = [...new Set(a.pendentesIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  const lista: Array<string | null> = ids.length ? ids : [null]
  for (const id of lista) {
    const { error } = await supabase.rpc('cupom_liberar_abandonadas', {
      p_barraca_id: a.barracaId,
      p_cliente_id: a.clienteId,
      p_pendente_anterior_id: id,
    })
    if (error) console.error('cupom: cupom_liberar_abandonadas falhou')
  }
}
