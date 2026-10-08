// Expiração do Pix por barraca. Espelhado em src/lib/pixExpiracao.ts (o front não
// importa de supabase/functions); manter os dois iguais e o CHECK da migration
// 20261014110000 (35..60).

/** Mínimo do Mercado Pago (30 min) + folga de relógio. Também é o padrão. */
export const PIX_EXPIRACAO_MIN_MINUTOS = 35
export const PIX_EXPIRACAO_MAX_MINUTOS = 60
export const PIX_EXPIRACAO_PADRAO_MINUTOS = 35

/** Valor lido da barraca → minutos válidos. Ausente/inválido = padrão; fora da faixa = limite. */
export function minutosExpiracaoPix(valor: unknown): number {
  const n = Math.floor(Number(valor))
  if (valor === null || valor === undefined || !Number.isFinite(n)) return PIX_EXPIRACAO_PADRAO_MINUTOS
  return Math.min(PIX_EXPIRACAO_MAX_MINUTOS, Math.max(PIX_EXPIRACAO_MIN_MINUTOS, n))
}
