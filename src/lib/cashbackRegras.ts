// Cashback: regras puras de dinheiro, em centavos inteiros (spec 2026-10-27, §7.3 base de cálculo,
// §7.5 resgate, §7.6 validade). O servidor SEMPRE recalcula; o front só mostra prévia.
// As funções SQL cashback_calcular_credito/cashback_calcular_resgate (migration
// 20261106120000_cashback_funcoes_conta.sql) espelham estas fórmulas; a paridade é provada pelos
// vetores de tests/fixtures/cashback-vetores.json. Sem imports de app: roda no Node.
// Arredondamento: SEMPRE floor, em aritmética inteira, num único ponto por regra.

/** Crédito máximo por pedido: R$ 20,00. Constante no servidor, fora da configuração da barraca. */
export const CASHBACK_CREDITO_MAX_CENTAVOS = 2000
/** Piso pago em dinheiro nos itens: o saldo nunca zera os itens (R$ 1,00). */
export const CASHBACK_PISO_ITENS_CENTAVOS = 100

// SUPOSIÇÃO-CASHBACK-3 (spec §20.3): 5% e 60 dias por padrão; faixas 1–15% e 30–90 dias; teto de uso 10–90%.
export const CASHBACK_PADRAO = { percentualBp: 500, validadeDias: 60, tetoUsoPct: 50 }
export const CASHBACK_FAIXAS = {
  percentualBp: [100, 1500],
  validadeDias: [30, 90],
  tetoUsoPct: [10, 90],
} as const

function inteiroNaoNegativo(valor: number, nome: string): void {
  if (!Number.isInteger(valor) || valor < 0) throw new RangeError(`${nome} deve ser um inteiro não negativo (centavos)`)
}

/** Itens menos o benefício do pedido (cupom OU saldo), nunca negativo. */
export function itensLiquidosCentavos(itens: number, beneficio: number): number {
  inteiroNaoNegativo(itens, 'itens')
  inteiroNaoNegativo(beneficio, 'beneficio')
  return Math.max(0, itens - beneficio)
}

/** Crédito do pedido: floor(itensLiquidos × bp / 10000), limitado a R$ 20,00. */
export function calcularCredito(itensLiquidos: number, percentualBp: number): number {
  inteiroNaoNegativo(itensLiquidos, 'itensLiquidos')
  inteiroNaoNegativo(percentualBp, 'percentualBp')
  return Math.min(Math.floor((itensLiquidos * percentualBp) / 10000), CASHBACK_CREDITO_MAX_CENTAVOS)
}

/** Resgate: min(saldo disponível, floor(itens × teto%/100), itens − R$ 1,00), nunca negativo. */
export function calcularResgate(a: { saldoDisponivel: number; itens: number; tetoUsoPct: number }): number {
  inteiroNaoNegativo(a.saldoDisponivel, 'saldoDisponivel')
  inteiroNaoNegativo(a.itens, 'itens')
  inteiroNaoNegativo(a.tetoUsoPct, 'tetoUsoPct')
  const teto = Math.floor((a.itens * a.tetoUsoPct) / 100)
  return Math.max(0, Math.min(a.saldoDisponivel, teto, a.itens - CASHBACK_PISO_ITENS_CENTAVOS))
}

/** Soma `dias` corridos (UTC) à data-base e devolve ISO. */
export function expiraEm(baseISO: string, dias: number): string {
  const base = new Date(baseISO)
  if (Number.isNaN(base.getTime())) throw new RangeError('baseISO inválida')
  if (!Number.isInteger(dias)) throw new RangeError('dias deve ser inteiro')
  return new Date(base.getTime() + dias * 86_400_000).toISOString()
}

/**
 * Saldo do cliente: o saldo inteiro vence quando o MAIOR `expira_em` passa (novo crédito renova o saldo todo;
 * resgate não tem `expira_em` e não renova). Vencido = saldo 0. Vence exatamente no instante de `expira_em`.
 */
export function saldoVigente(a: {
  lancamentos: Array<{ valor_centavos: number; expira_em?: string | null }>
  agoraISO: string
}): { saldo: number; venceEm: string | null } {
  const agora = new Date(a.agoraISO).getTime()
  if (Number.isNaN(agora)) throw new RangeError('agoraISO inválida')
  let venceEm: string | null = null
  let venceMs = -Infinity
  let soma = 0
  for (const l of a.lancamentos) {
    soma += l.valor_centavos
    if (l.expira_em) {
      const ms = new Date(l.expira_em).getTime()
      if (ms > venceMs) {
        venceMs = ms
        venceEm = l.expira_em
      }
    }
  }
  if (venceEm === null || venceMs <= agora) return { saldo: 0, venceEm: null }
  return { saldo: Math.max(0, soma), venceEm }
}

type CampoConfig = 'percentualBp' | 'validadeDias' | 'tetoUsoPct'

const ROTULOS: Record<CampoConfig, string> = {
  percentualBp: 'O percentual de volta',
  validadeDias: 'A validade do saldo',
  tetoUsoPct: 'O teto de uso por pedido',
}

/** Confere a configuração da barraca contra as faixas. Devolve o primeiro campo inválido. */
export function validarConfigCashback(c: {
  percentualBp: number
  validadeDias: number
  tetoUsoPct: number
}): { ok: true } | { ok: false; campo: CampoConfig; mensagem: string } {
  const textos: Record<CampoConfig, string> = {
    percentualBp: 'entre 1% e 15%',
    validadeDias: 'entre 30 e 90 dias',
    tetoUsoPct: 'entre 10% e 90% dos itens',
  }
  for (const campo of ['percentualBp', 'validadeDias', 'tetoUsoPct'] as const) {
    const [min, max] = CASHBACK_FAIXAS[campo]
    const v = c[campo]
    if (!Number.isInteger(v) || v < min || v > max) return { ok: false, campo, mensagem: `${ROTULOS[campo]} deve ficar ${textos[campo]}.` }
  }
  return { ok: true }
}
