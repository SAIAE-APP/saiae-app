// Resumo de cashback do dono (resposta da RPC `cashback_resumo`, security invoker: quem não é da loja recebe zeros).
// Parte PURA: a leitura no banco fica em `cashbackResumoDados.ts` para esta interpretação rodar no Node sem rede.

export type ResumoCashback = {
  concedidoCentavos: number
  usadoCentavos: number
  vencidoCentavos: number
  estornadoCentavos: number
  excedenteCentavos: number
  saldoEmAbertoCentavos: number
}

function inteiroNaoNegativo(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null
}

/** A RPC devolve uma linha (os bigint podem chegar como texto). Resposta fora de forma = null, nunca número inventado. */
export function interpretarResumoCashback(data: unknown): ResumoCashback | null {
  const linha = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined
  if (!linha || typeof linha !== 'object') return null
  const campos = {
    concedidoCentavos: inteiroNaoNegativo(linha.concedido_centavos),
    usadoCentavos: inteiroNaoNegativo(linha.usado_centavos),
    vencidoCentavos: inteiroNaoNegativo(linha.vencido_centavos),
    estornadoCentavos: inteiroNaoNegativo(linha.estornado_centavos),
    excedenteCentavos: inteiroNaoNegativo(linha.excedente_centavos),
    saldoEmAbertoCentavos: inteiroNaoNegativo(linha.saldo_em_aberto_centavos),
  }
  if (Object.values(campos).some((v) => v === null)) return null
  return campos as ResumoCashback
}
