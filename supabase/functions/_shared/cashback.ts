// Cashback: funções puras compartilhadas pelas edge functions (Deno e Node).
// A REGRA e o cálculo ficam no banco (cashback_avaliar_resgate/cashback_reservar); aqui só a leitura
// segura da resposta, os textos para o cliente e a regra "um benefício por pedido".

export type ResultadoResgate =
  | { ok: true; resgate_centavos: number; uso_id?: string; saldo_centavos?: number; vence_em?: string | null }
  | { ok: false; erro: string }

function inteiroNaoNegativo(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0
}

/** Lê com segurança o jsonb devolvido pelo banco. Resposta estranha (negativo, campo faltando) = inválido, nunca desconto. */
export function interpretarResgate(data: unknown): ResultadoResgate {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.ok === true && inteiroNaoNegativo(d.resgate_centavos)) {
    const saldoOk = d.saldo_centavos === undefined || inteiroNaoNegativo(d.saldo_centavos)
    if (saldoOk) {
      return {
        ok: true,
        resgate_centavos: d.resgate_centavos,
        ...(typeof d.uso_id === 'string' ? { uso_id: d.uso_id } : {}),
        ...(d.saldo_centavos !== undefined ? { saldo_centavos: d.saldo_centavos as number } : {}),
        ...(typeof d.vence_em === 'string' || d.vence_em === null ? { vence_em: d.vence_em as string | null } : {}),
      }
    }
    return { ok: false, erro: 'invalido' }
  }
  if (d.ok === false && typeof d.erro === 'string') return { ok: false, erro: d.erro }
  return { ok: false, erro: 'invalido' }
}

/** Texto simples para o cliente. Código desconhecido cai na mensagem genérica (nunca vaza detalhe interno). */
export function mensagemDoErroCashback(erro: string): string {
  switch (erro) {
    case 'sem_cliente':
      return 'Confirme seu telefone para usar seu saldo.'
    case 'sem_saldo':
      return 'Você não tem saldo disponível.'
    case 'itens_baixos':
      return 'O saldo não pode pagar todo o pedido.'
    case 'cupom_e_saldo':
      return 'Cupom e saldo não somam. Use um por pedido.'
    default:
      return 'Não foi possível usar o saldo agora. Tente de novo.'
  }
}

/**
 * Desconto do pedido: cupom OU saldo, nunca os dois. // SUPOSIÇÃO-CASHBACK-4 (spec §20.4): um benefício por pedido.
 * Lança RangeError se os dois forem maiores que zero (o chamador já devolveu 422 antes; isto é a rede de segurança).
 */
export function descontoDoBeneficio(cupomCentavos: number, cashbackCentavos: number): number {
  if (cupomCentavos > 0 && cashbackCentavos > 0) throw new RangeError('cupom e saldo não somam: um benefício por pedido')
  return cupomCentavos + cashbackCentavos
}
