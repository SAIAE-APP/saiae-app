// Gravações do pagamento aprovado, comuns ao webhook (webhook-mercadopago) e à resposta síncrona do cartão
// (criar-pagamento-pix). O cliente do banco é injetado: testado em Node com um cliente falso (pagamento.test.ts).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { TipoConciliacao } from './conciliacao.ts'

export type BaseConciliacao = {
  supabase: SupabaseClient
  barracaId: string
  pendenteId: string
  provedor: string
  idExterno: string
  /** Prefixo dos logs (nome da edge function). */
  origem: string
}

export type ExtraConciliacao = {
  situacao?: string
  pedido_id?: string | null
  detalhe?: string
  valor_pago_centavos?: number
  valor_esperado_centavos?: number
}

/** Registro de conciliação. Idempotente: a mesma notificação repetida não duplica (unique provedor+id+tipo). */
export async function registrarConciliacao(base: BaseConciliacao, tipo: TipoConciliacao, extra: ExtraConciliacao = {}): Promise<boolean> {
  const { error } = await base.supabase.from('pagamentos_conciliacao').upsert(
    {
      barraca_id: base.barracaId,
      pendente_id: base.pendenteId,
      provedor: base.provedor,
      id_externo: base.idExterno,
      tipo,
      ...extra,
    },
    { onConflict: 'provedor,id_externo,tipo', ignoreDuplicates: true },
  )
  if (error) console.error(`${base.origem}: conciliação não registrada`, error.message)
  return !error
}
