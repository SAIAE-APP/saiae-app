/**
 * Minutos entre dois instantes ISO, arredondados, NUNCA negativos.
 *
 * `criado_em` é gravado pelo SERVIDOR (now() em criar_pedido) e `pronto_em`/`entregue_em` pelo relógio do
 * APARELHO (quem toca "Pronto"/"Entregue" manda `new Date()`). Aparelho com relógio atrasado dá fim < início e a
 * conta saía "-1 min de preparo". Tempo de preparo negativo não existe: piso em 0. Data inválida também vira 0.
 */
export function minutosEntre(inicioIso: string, fimIso: string): number {
  const ms = new Date(fimIso).getTime() - new Date(inicioIso).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.round(ms / 60000))
}
