// Contrato SAI-002 (CRM -> Comanda): assinatura e corpo da rota `ia-contexto`. Funções puras (sem Deno/Supabase),
// testadas em tests/iaAssinatura.test.ts. Mesma família de assinatura dos eventos (SAI-001):
//   X-Saiae-Timestamp = segundos desde 1970; X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, `${timestamp}.${corpo}`)
// com `corpo` = os bytes exatos recebidos, e janela de 5 minutos. O segredo é de PLATAFORMA (IA_CONTEXTO_SEGREDO).
import { assinarEvento, segredosIguais } from './eventosSaida.ts'

export const JANELA_ASSINATURA_S = 300
export const TAMANHO_MAX_CORPO = 4096

/** Verdadeiro só com segredo configurado, timestamp canônico dentro da janela e assinatura idêntica
 * (comparação em tempo constante). Qualquer dúvida = falso; nada aqui lança. */
export async function verificarAssinaturaIa(
  segredo: string | undefined,
  timestamp: string | null,
  assinatura: string | null,
  corpoBruto: string,
  agoraMs: number = Date.now(),
): Promise<boolean> {
  try {
    if (!segredo || !timestamp || !assinatura) return false
    if (!/^[0-9]{1,12}$/.test(timestamp) || String(Number(timestamp)) !== timestamp) return false
    const ts = Number(timestamp)
    if (Math.abs(Math.floor(agoraMs / 1000) - ts) > JANELA_ASSINATURA_S) return false
    if (!/^sha256=[0-9a-f]{64}$/.test(assinatura)) return false
    const esperada = await assinarEvento(segredo, ts, corpoBruto)
    return segredosIguais(assinatura, esperada)
  } catch {
    return false
  }
}

export type CorpoIa = { ok: true; codigo: string; telefone: string | null } | { ok: false }

/** `{ codigo_loja, telefone }`: código de 6 caracteres [A-Z0-9] e telefone só dígitos (10 a 13). Só essas duas
 * chaves, de verdade strings; qualquer outra forma é recusada. */
export function validarCorpoIa(corpoBruto: string): CorpoIa {
  if (corpoBruto.length === 0 || new TextEncoder().encode(corpoBruto).length > TAMANHO_MAX_CORPO) return { ok: false }
  let v: unknown
  try {
    v = JSON.parse(corpoBruto)
  } catch {
    return { ok: false }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false }
  const { codigo_loja: codigo, telefone } = v as Record<string, unknown>
  if (typeof codigo !== 'string' || !/^[A-Z0-9]{6}$/.test(codigo)) return { ok: false }
  // Telefone ausente (o WhatsApp ocultou o número): o cliente é tratado como novo. Se vier, precisa ser válido.
  if (telefone === undefined || telefone === null) return { ok: true, codigo, telefone: null }
  if (typeof telefone !== 'string' || !/^[0-9]{10,13}$/.test(telefone)) return { ok: false }
  return { ok: true, codigo, telefone }
}
