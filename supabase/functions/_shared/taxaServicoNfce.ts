// Taxa de serviço da comanda na NFC-e (interruptor `barracas.nfce_incluir_taxas`, padrão desligado). A NFC-e
// continua uma nota por rodada, então a taxa da comanda fechada é rateada entre as rodadas e, dentro da nota,
// entre os itens: a FocusNFe recebe o acréscimo POR ITEM (`valor_outras_despesas`, tag vOutro). Funções puras
// (Deno e Node); tudo em centavos inteiros.

/**
 * Rateia `taxaCentavos` proporcionalmente a `totaisItensCentavos` pelo método do maior resto: cada parte é o
 * piso da proporção e os centavos que sobram vão, um a um, para os maiores restos (empate: menor índice). A soma
 * devolvida é exatamente `taxaCentavos`. Total 0 recebe 0; se a soma dos totais é 0 não há base para ratear e
 * todos recebem 0 (o fechamento da comanda nunca cobra taxa com subtotal 0). Determinístico: a mesma lista dá
 * sempre as mesmas partes, seja qual for a ordem em que as notas são emitidas.
 */
export function ratearTaxaServico(totaisItensCentavos: number[], taxaCentavos: number): number[] {
  const totais = totaisItensCentavos.map((v) => Math.max(0, Math.floor(v)))
  const base = totais.reduce((s, v) => s + v, 0)
  const alvo = Math.max(0, Math.floor(taxaCentavos))
  if (base === 0 || alvo === 0) return totais.map(() => 0)

  const parte = totais.map((v) => Math.floor((v * alvo) / base))
  let sobra = alvo - parte.reduce((s, v) => s + v, 0)
  const porResto = totais
    .map((v, i) => ({ i, resto: (v * alvo) % base }))
    .filter((r) => totais[r.i] > 0)
    .sort((a, b) => b.resto - a.resto || a.i - b.i)
  for (let k = 0; sobra > 0; k = (k + 1) % porResto.length, sobra--) parte[porResto[k].i] += 1
  return parte
}
