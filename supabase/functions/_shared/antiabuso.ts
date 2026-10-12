// Defesas anti-bot das edge functions PÚBLICAS do cardápio (sem login). Funções
// puras, testáveis em Node e no Deno (ver antiabuso.test.ts).

/** Envio mais rápido que isso depois de abrir o checkout não é humano. */
export const MIN_MS_NO_CHECKOUT = 2000

/**
 * Honeypot preenchido, ou tempo no checkout curto demais. `ms_no_checkout` só é
 * exigido quando vem no corpo: cliente antigo (PWA em cache) não manda o campo e
 * não pode ser barrado; o honeypot e o teto por IP continuam valendo pra ele.
 */
export function pareceBot(body: { website?: unknown; ms_no_checkout?: unknown }, exigirTempo = false): boolean {
  if (String(body.website ?? '').length > 0) return true
  // `exigirTempo` (env EXIGIR_MS_NO_CHECKOUT=1, ligar só depois que o PWA novo estiver em todos os
  // aparelhos): script que omite o campo deixa de passar.
  if (body.ms_no_checkout === undefined || body.ms_no_checkout === null) return exigirTempo
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

/** Tetos por padrão. Por loja: soma de tudo que a loja recebe na janela (Pix + pagar na entrega). */
export const JANELA_TENTATIVAS_S = 300
export const LIMITE_TENTATIVAS_POR_LOJA_PADRAO = 400

export type DecisaoTentativa = 'ok' | 'limite_ip' | 'limite_barraca'

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/**
 * Registra a tentativa de forma ATÔMICA no banco (cardapio_registrar_tentativa: conta e grava na mesma
 * transação, com teto por IP e por loja). Se a RPC falhar (ex.: migration ainda não aplicada) NÃO derruba
 * a venda: registra no log e deixa passar, como o contador antigo fazia quando a consulta falhava.
 */
export async function registrarTentativa(
  supabase: ClienteRpc,
  args: { barracaId: string; ipHash: string; clientUuid: string; limiteIp: number; limiteBarraca?: number; janelaSegundos?: number },
): Promise<DecisaoTentativa> {
  const { data, error } = await supabase.rpc('cardapio_registrar_tentativa', {
    p_barraca_id: args.barracaId,
    p_ip_hash: args.ipHash,
    p_client_uuid: args.clientUuid,
    p_limite_ip: args.limiteIp,
    p_limite_barraca: args.limiteBarraca ?? LIMITE_TENTATIVAS_POR_LOJA_PADRAO,
    p_janela_segundos: args.janelaSegundos ?? JANELA_TENTATIVAS_S,
  })
  if (error) {
    console.error('cardapio_registrar_tentativa falhou (seguindo sem limite):', error.message)
    return 'ok'
  }
  if (data === 'limite_ip' || data === 'limite_barraca') return data
  return 'ok'
}

/** Limite por loja configurável sem deploy de código (env CARDAPIO_LIMITE_POR_LOJA; inválido = padrão). */
export function limitePorLoja(valor: string | undefined): number {
  const n = Number(valor)
  return Number.isInteger(n) && n >= 1 ? n : LIMITE_TENTATIVAS_POR_LOJA_PADRAO
}

/** SHA-256 hex de `<escopo>:<barraca>:<ip>`. O IP nunca é guardado em claro (LGPD). */
export async function hashIp(escopo: string, ip: string, barracaId: string): Promise<string> {
  const dados = new TextEncoder().encode(`${escopo}:${barracaId}:${ip}`)
  const digest = await crypto.subtle.digest('SHA-256', dados)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
