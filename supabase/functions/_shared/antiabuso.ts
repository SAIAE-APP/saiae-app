// Defesas anti-bot das edge functions PÚBLICAS do cardápio (sem login). Funções
// puras, testáveis em Node e no Deno (ver antiabuso.test.ts).

/** Envio mais rápido que isso depois de abrir o checkout não é humano. */
export const MIN_MS_NO_CHECKOUT = 2000

/**
 * Honeypot preenchido, ou tempo no checkout curto demais. `ms_no_checkout` só é
 * exigido quando vem no corpo: cliente antigo (PWA em cache) não manda o campo e
 * não pode ser barrado; o honeypot e o teto por IP continuam valendo pra ele.
 */
export function pareceBot(body: { website?: unknown; ms_no_checkout?: unknown }): boolean {
  if (String(body.website ?? '').length > 0) return true
  if (body.ms_no_checkout === undefined || body.ms_no_checkout === null) return false
  const ms = Number(body.ms_no_checkout)
  return !Number.isFinite(ms) || ms < MIN_MS_NO_CHECKOUT
}

export function ipDoCliente(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'desconhecido'
  )
}

/** SHA-256 hex de `<escopo>:<barraca>:<ip>`. O IP nunca é guardado em claro (LGPD). */
export async function hashIp(escopo: string, ip: string, barracaId: string): Promise<string> {
  const dados = new TextEncoder().encode(`${escopo}:${barracaId}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', dados)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
