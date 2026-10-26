// Taxa de serviço Sai aê no pagamento online do cardápio (Pix e cartão). Espelho de
// supabase/functions/_shared/pagamento/taxaPlataforma.ts: o servidor sempre recalcula e recusa (409) se o total
// que o cliente viu divergir. Puro, centavos inteiros; testado em tests/taxaPlataforma.test.ts.

export const TAXA_PLATAFORMA_CENTAVOS = 99

/** Total com a taxa. Pedido grátis (total 0) não paga taxa: não há cobrança. */
export function totalComTaxaPlataforma(totalSemTaxaCentavos: number): number {
  if (!Number.isInteger(totalSemTaxaCentavos) || totalSemTaxaCentavos < 0) {
    throw new RangeError('total sem taxa deve ser inteiro em centavos e não negativo')
  }
  return totalSemTaxaCentavos > 0 ? totalSemTaxaCentavos + TAXA_PLATAFORMA_CENTAVOS : 0
}
