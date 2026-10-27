// Cashback no cardápio digital (lado do cliente). PURO (sem imports): testável no Node. Aqui só se
// interpreta a resposta do servidor e se monta o corpo da cobrança; o saldo e o desconto SEMPRE são
// calculados no servidor. Qualquer dúvida sobre o recurso = desligado.

export type DadosCashback = {
  habilitado: boolean
  saldoCentavos: number
  disponivelCentavos: number
  venceEm: string | null
  percentualBp: number
  tetoUsoPct: number
  lancamentos: Array<{ tipo: string; valorCentavos: number; criadoEm: string }>
}

const inteiro = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)
const naoNegativo = (n: unknown): n is number => inteiro(n) && n >= 0

/** Resposta da ação `cashback` de `cliente-sessao`. Inteiro negativo ou fora de forma = `null`
 * (a tela não mostra saldo inventado). Os lançamentos podem ter valor negativo (resgate, expiração). */
export function interpretarCashback(corpo: unknown): DadosCashback | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const c = corpo as Record<string, unknown>
  if (typeof c.habilitado !== 'boolean') return null
  if (!naoNegativo(c.saldo_centavos) || !naoNegativo(c.disponivel_centavos)) return null
  if (!naoNegativo(c.percentual_bp) || !naoNegativo(c.teto_uso_pct)) return null
  if (c.vence_em !== null && typeof c.vence_em !== 'string') return null
  if (!Array.isArray(c.lancamentos)) return null
  const lancamentos: DadosCashback['lancamentos'] = []
  for (const l of c.lancamentos) {
    if (typeof l !== 'object' || l === null) return null
    const { tipo, valor_centavos: valor, criado_em: criado } = l as Record<string, unknown>
    if (typeof tipo !== 'string' || !inteiro(valor) || typeof criado !== 'string') return null
    lancamentos.push({ tipo, valorCentavos: valor, criadoEm: criado })
  }
  return {
    habilitado: c.habilitado,
    saldoCentavos: c.saldo_centavos,
    disponivelCentavos: c.disponivel_centavos,
    venceEm: c.vence_em,
    percentualBp: c.percentual_bp,
    tetoUsoPct: c.teto_uso_pct,
    lancamentos,
  }
}

export type ConfigCashback = { habilitado: boolean; percentualBp: number; tetoUsoPct: number; validadeDias: number }
const DESLIGADO: ConfigCashback = { habilitado: false, percentualBp: 0, tetoUsoPct: 0, validadeDias: 0 }

/** `cashback_config(slug)`: só liga com `habilitado === true` e números inteiros não negativos. Função
 * ausente (banco sem a migration), erro, resposta vazia ou fora de forma = desligado. */
export function decidirCashbackConfig(resposta: { data: unknown; error: unknown }): ConfigCashback {
  if (resposta.error) return DESLIGADO
  const linha = Array.isArray(resposta.data) ? resposta.data[0] : null
  if (typeof linha !== 'object' || linha === null) return DESLIGADO
  const l = linha as Record<string, unknown>
  if (l.habilitado !== true) return DESLIGADO
  if (!naoNegativo(l.percentual_bp) || !naoNegativo(l.teto_uso_pct) || !naoNegativo(l.validade_dias)) return DESLIGADO
  return { habilitado: true, percentualBp: l.percentual_bp, tetoUsoPct: l.teto_uso_pct, validadeDias: l.validade_dias }
}

/** Parte do corpo de `criar-pagamento-pix` que pede o uso do saldo. Sem uso, não manda nada (chamada idêntica à de antes). */
export function corpoCashback(usar: boolean): { usar_cashback?: true } {
  return usar ? { usar_cashback: true } : {}
}
