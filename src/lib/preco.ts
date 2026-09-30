export const CENTAVOS_MAX = 99999999

export function formatarPrecoBR(centavos: number): string {
  const valorAbsoluto = Math.round(Math.abs(centavos))
  const inteiro = Math.floor(valorAbsoluto / 100)
  const decimal = String(valorAbsoluto % 100).padStart(2, '0')
  const inteiroFormatado = inteiro.toLocaleString('pt-BR')
  const sinal = centavos < 0 ? '-' : ''
  return `${sinal}R$ ${inteiroFormatado},${decimal}`
}

export function centavosParaReais(centavos: number): number {
  return centavos / 100
}

/**
 * Converte string/number em reais (aceita vírgula ou ponto) para centavos,
 * truncando em 2 decimais via manipulação de string — evita erros de ponto
 * flutuante como 29.99 * 100 = 2998.9999999999995.
 */
export function reaisParaCentavos(reais: number | string): number {
  const texto = String(reais).trim().replace(',', '.')
  if (!texto) return 0

  const negativo = texto.startsWith('-')
  const semSinal = negativo ? texto.slice(1) : texto

  const [parteInteira, parteDecimal = ''] = semSinal.split('.')
  const inteiro = parteInteira.replace(/\D/g, '') || '0'
  const decimal = (parteDecimal.replace(/\D/g, '') + '00').slice(0, 2)

  const centavos = Number(inteiro) * 100 + Number(decimal)
  if (!Number.isFinite(centavos)) return 0

  const resultado = negativo ? -centavos : centavos
  return Math.max(0, Math.min(CENTAVOS_MAX, resultado))
}

/** Filtro de campo de preço: mantém só dígitos, vírgula e ponto. */
export function filtrarEntradaPreco(texto: string): string {
  return texto.replace(/[^\d.,]/g, '')
}
