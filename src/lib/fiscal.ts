// Regras fiscais puras (sem rede): CPF do consumidor e valor aproximado de
// tributos da Lei 12.741/2012. A edge function `emitir-nfce` repete essas
// contas (Deno não importa de src/) — mexeu aqui, mexa lá também.

/** Telefone do PROCON exigido nas notas/cupons — fixo, igual pra todo o país. */
export const TELEFONE_PROCON = '151'

export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

/** Máscara progressiva 000.000.000-00 enquanto digita. */
export function formatarCpf(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Dígitos verificadores do CPF; rejeita sequências repetidas (111.111.111-11). */
export function cpfValido(valor: string): boolean {
  const d = apenasDigitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    const digito = ((soma * 10) % 11) % 10
    if (digito !== Number(d[tamanho])) return false
  }
  return true
}

/**
 * Valor aproximado de tributos de uma linha, em centavos, pela alíquota em
 * pontos-base (1850 = 18,50%). Arredonda por linha, como o total impresso é
 * a soma das linhas (a FocusNFe recebe o mesmo número por item).
 */
export function tributosDaLinhaCentavos(totalLinhaCentavos: number, aliquotaBps: number): number {
  return Math.round((totalLinhaCentavos * aliquotaBps) / 10000)
}

export function tributosDoPedidoCentavos(
  linhasCentavos: number[],
  aliquotaBps: number | null | undefined,
): number | null {
  if (aliquotaBps === null || aliquotaBps === undefined) return null
  return linhasCentavos.reduce((soma, linha) => soma + tributosDaLinhaCentavos(linha, aliquotaBps), 0)
}
