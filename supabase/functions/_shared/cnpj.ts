// CNPJ: normaliza (só dígitos) e valida o dígito verificador. Reaproveita a regra de consultaExterna.ts.
import { cnpjValido, soDigitos } from './consultaExterna.ts'

/** 14 dígitos validados, ou null se o texto não for um CNPJ válido (inclusive todos os dígitos iguais). */
export function normalizarCnpj(texto: unknown): string | null {
  const digitos = soDigitos(texto)
  return cnpjValido(digitos) ? digitos : null
}
