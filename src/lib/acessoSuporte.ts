/** Alfabeto do código de suporte — mesmo princípio de `ia_gerar_codigo()`
 * (migration 20261019100000_ia_atendente.sql): sem 0/O/1/I pra não
 * confundir quem está digitando à mão. */
export const ALFABETO_CODIGO_SUPORTE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

const REGEX_FORA_DO_ALFABETO = new RegExp(`[^${ALFABETO_CODIGO_SUPORTE}]`, 'g')

/** Maiúsculas e só o alfabeto do código — tolera espaços/traços que
 * alguém digite copiando errado. */
export function normalizarCodigoSuporte(input: string): string {
  return input.toUpperCase().replace(REGEX_FORA_DO_ALFABETO, '')
}

export function formatoCodigoSuporteValido(codigo: string): boolean {
  return new RegExp(`^[${ALFABETO_CODIGO_SUPORTE}]{8}$`).test(codigo)
}
