// Taxa fixa do Sai aê sobre pagamento online (comissão do marketplace do Mercado Pago).
// Regras puras, em centavos inteiros; sem rede nem banco.

export const TAXA_PLATAFORMA_CENTAVOS = 99

/** Soma a taxa ao total cobrado. Pedido grátis (total 0) não paga taxa: não há cobrança. */
export function aplicarTaxaPlataforma(totalSemTaxaCentavos: number): { taxaPlataformaCentavos: number; totalCentavos: number } {
  const taxaPlataformaCentavos = totalSemTaxaCentavos > 0 ? TAXA_PLATAFORMA_CENTAVOS : 0
  return { taxaPlataformaCentavos, totalCentavos: totalSemTaxaCentavos + taxaPlataformaCentavos }
}
