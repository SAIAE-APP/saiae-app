// Telefone do cliente final: mesma regra do app (src/lib/entrega.ts) e do trigger do banco.

export function somenteDigitos(texto: string): string {
  return String(texto ?? '').replace(/\D/g, '')
}

/** Só dígitos, sem o 55 do país (só sai com 12 ou 13 dígitos: com 10/11 o 55 é o DDD de Santa Maria/RS). */
export function normalizarTelefone(texto: string): string {
  const d = somenteDigitos(texto)
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
}

/** Telefone brasileiro com DDD: 10 (fixo) ou 11 (celular) dígitos. WhatsApp internacional fica fora desta versão. */
export function telefoneValido(texto: string): boolean {
  const d = normalizarTelefone(texto)
  return d.length === 10 || d.length === 11
}
