// Desconto de cupom na NFC-e: a nota deve refletir o que o cliente pagou. A FocusNFe recebe o desconto
// POR ITEM (`valor_desconto`, opcional, junto de `valor_bruto`), então o desconto do pedido é rateado
// entre os itens. Funções puras (Deno e Node); tudo em centavos inteiros.

/**
 * Rateia `descontoCentavos` entre as linhas proporcionalmente ao valor bruto de cada uma (floor), manda
 * o resto de centavos para a ÚLTIMA linha e nunca deixa uma linha ter desconto maior que o próprio valor
 * (o excedente, se houver, volta para as outras linhas com folga). A soma devolvida é sempre igual ao
 * desconto pedido, limitado ao total bruto.
 */
export function ratearDesconto(brutosCentavos: number[], descontoCentavos: number): number[] {
  const n = brutosCentavos.length
  const total = brutosCentavos.reduce((s, v) => s + v, 0)
  const alvo = Math.max(0, Math.min(Math.floor(descontoCentavos), total))
  if (n === 0 || total <= 0 || alvo === 0) return brutosCentavos.map(() => 0)

  const parte = brutosCentavos.map((v) => Math.floor((v * alvo) / total))
  let resto = alvo - parte.reduce((s, v) => s + v, 0)
  // Resto na última linha; o que não couber nela (limite = valor da linha) segue para as anteriores.
  for (let i = n - 1; i >= 0 && resto > 0; i--) {
    const folga = brutosCentavos[i] - parte[i]
    const dar = Math.min(folga, resto)
    parte[i] += dar
    resto -= dar
  }
  return parte
}
