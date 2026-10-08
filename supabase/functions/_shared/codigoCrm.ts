// Pede ao CRM que envie o código de verificação pelo modelo de autenticação da Meta.
// Mesmo esquema de assinatura dos eventos (INTEGRACAO.md §2): X-Saiae-Event-Id/Timestamp/Signature.
import { cabecalhosDoEvento, urlPermitida } from './eventosSaida.ts'

export type EnvioCodigo = {
  url: string
  segredo: string
  barracaId: string
  telefone: string
  codigo: string
  requestId: string
}
export type ResultadoEnvio = { ok: true } | { ok: false; motivo: string }

const TIMEOUT_MS = 10_000

export async function enviarCodigoAoCrm(a: EnvioCodigo, fetchFn: typeof fetch = fetch): Promise<ResultadoEnvio> {
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const corpo = JSON.stringify({
    barraca_id: a.barracaId,
    telefone: a.telefone,
    codigo: a.codigo,
    request_id: a.requestId,
  })
  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const resposta = await fetchFn(a.url, {
      method: 'POST',
      headers: await cabecalhosDoEvento(a.segredo, a.requestId, timestamp, corpo),
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await resposta.body?.cancel()
    return resposta.status >= 200 && resposta.status < 300
      ? { ok: true }
      : { ok: false, motivo: `CRM respondeu ${resposta.status}` }
  } catch (e) {
    return { ok: false, motivo: `erro de rede: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}
