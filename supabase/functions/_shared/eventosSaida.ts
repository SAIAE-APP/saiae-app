// Worker de eventos Comanda -> CRM (SAI-013). Funções puras (sem Deno/Supabase), testadas em
// tests/eventosSaida.test.ts. Contrato: INTEGRACAO.md §2.

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** `sha256=` + HMAC-SHA256(segredo, `${timestamp}.${corpo}`) — corpo = os bytes exatos enviados. */
export async function assinarEvento(segredo: string, timestamp: number, corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', encoder.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const assinatura = await crypto.subtle.sign('HMAC', chave, encoder.encode(`${timestamp}.${corpo}`))
  return `sha256=${hex(assinatura)}`
}

/** Cabeçalhos do contrato. `timestamp` em segundos (o CRM rejeita diferença > 5 min). */
export async function cabecalhosDoEvento(
  segredo: string,
  eventoId: string,
  timestamp: number,
  corpo: string,
): Promise<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    'X-Saiae-Event-Id': eventoId,
    'X-Saiae-Timestamp': String(timestamp),
    'X-Saiae-Signature': await assinarEvento(segredo, timestamp, corpo),
  }
}

const HOST_BLOQUEADO = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i

/** Só https público. A URL é cadastrada pelo dono da barraca e o servidor da Comanda faz a chamada,
 * então recusa host interno/literal de IP privado (SSRF). Não cobre DNS que aponta para IP privado. */
export function urlPermitida(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const host = u.hostname
  if (HOST_BLOQUEADO.test(host)) return false
  if (host.includes(':') || host.startsWith('[')) return false // IPv6 literal: não aceito
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    const privado =
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    if (privado) return false
  }
  return true
}

/** Comparação em tempo constante do segredo do worker. */
export function segredosIguais(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
