// Consumo mensal da IA do WhatsApp: a Comanda pergunta ao CRM (dono das conversas) quantas conversas a loja já usou
// no mês. Chamada servidor→servidor assinada como o SAI-002 (docs/contrato/v1/ia-contexto.md). Funções puras,
// testadas em tests/iaConsumo.test.ts.
//   GET {CRM_IA_CONSUMO_URL}?codigo_loja=ABCD23
//   X-Saiae-Timestamp = segundos; X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, `${timestamp}.${codigo_loja}`)
import { assinarEvento, urlPermitida } from './eventosSaida.ts'

export type Consumo = { mes: string; conversas: number; limite: number | null }
export type ResultadoConsumo = { ok: true; consumo: Consumo } | { ok: false; motivo: string }

const TIMEOUT_MS = 8_000

/** Formato fixo do contrato; qualquer outra coisa é recusada (a tela mostra "consumo indisponível"). */
export function interpretarConsumo(corpo: unknown): Consumo | null {
  if (typeof corpo !== 'object' || corpo === null) return null
  const { mes, conversas, limite } = corpo as Record<string, unknown>
  if (typeof mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null
  if (typeof conversas !== 'number' || !Number.isInteger(conversas) || conversas < 0) return null
  if (limite !== null && (typeof limite !== 'number' || !Number.isInteger(limite) || limite < 0)) return null
  return { mes, conversas, limite }
}

/** `https://crm/.../ia-consumo?codigo_loja=ABCD23`, preservando o que a URL base já tiver. Null se o código for inválido. */
export function urlDoConsumo(base: string, codigoLoja: string): string | null {
  if (!/^[A-Z0-9]{6}$/.test(codigoLoja)) return null
  try {
    const u = new URL(base)
    u.searchParams.set('codigo_loja', codigoLoja)
    return u.toString()
  } catch {
    return null
  }
}

export async function cabecalhosDoConsumo(segredo: string, timestamp: number, codigoLoja: string): Promise<Record<string, string>> {
  return {
    'X-Saiae-Timestamp': String(timestamp),
    'X-Saiae-Signature': await assinarEvento(segredo, timestamp, codigoLoja),
  }
}

export async function buscarConsumo(
  a: { url: string | undefined; segredo: string | undefined; codigoLoja: string },
  fetchFn: typeof fetch = fetch,
  agoraMs: number = Date.now(),
): Promise<ResultadoConsumo> {
  if (!a.url || !a.segredo) return { ok: false, motivo: 'não configurado' }
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const url = urlDoConsumo(a.url, a.codigoLoja)
  if (!url) return { ok: false, motivo: 'código da loja inválido' }
  try {
    const resposta = await fetchFn(url, {
      method: 'GET',
      headers: await cabecalhosDoConsumo(a.segredo, Math.floor(agoraMs / 1000), a.codigoLoja),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resposta.status !== 200) {
      await resposta.body?.cancel()
      return { ok: false, motivo: `CRM respondeu ${resposta.status}` }
    }
    const consumo = interpretarConsumo(await resposta.json().catch(() => null))
    return consumo ? { ok: true, consumo } : { ok: false, motivo: 'resposta do CRM fora do formato' }
  } catch (e) {
    return { ok: false, motivo: `erro de rede: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}

/** O limite de conversas é da Comanda (`ia_limites_plano`, plano do dono): é a fonte confiável. O do CRM é só o
 * último valor visto numa conversa (em memória, some no reinício), então entra apenas como reserva quando a Comanda
 * ainda não tem número para o plano. Nunca devolve valor inválido. */
export function escolherLimite(daComanda: number | null | undefined, doCrm: number | null | undefined): number | null {
  const valido = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (valido(daComanda)) return daComanda
  if (valido(doCrm)) return doCrm
  return null
}
