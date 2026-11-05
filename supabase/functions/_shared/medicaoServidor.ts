// Purchase pelo servidor: Meta Conversions API + GA4 Measurement Protocol. Sem imports de Deno (testado em
// tests/medicaoServidor.test.ts com fetch simulado). Regras: só com consentimento (decidido por quem chama), e-mail só
// em hash SHA-256, mesmo event_id do navegador não existe (Purchase é SÓ do servidor), timeout curto, falha nunca sobe.

export const PIXEL_ID_PADRAO = '442066388679102'
export const GA4_ID_PADRAO = 'G-R72CK0Q5DV'
const TIMEOUT_MS = 3000

export type DadosPurchase = {
  /** Id da fatura da Stripe (in_...): o MESMO nos dois destinos, para a deduplicação e a idempotência. */
  eventId: string
  valorCentavos: number
  email: string | null
  fbp: string | null
  fbc: string | null
  gaClientId: string | null
  /** Para o client_id do GA4 quando o navegador não deu o do _ga. */
  usuarioId: string
  eventoEmSegundos: number
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Meta pede o e-mail normalizado (minúsculas, sem espaços) antes do hash. */
export async function hashEmail(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase())
}

export async function montarPayloadMeta(d: DadosPurchase, testEventCode?: string) {
  const userData: Record<string, unknown> = {}
  if (d.email) userData.em = [await hashEmail(d.email)]
  if (d.fbp) userData.fbp = d.fbp
  if (d.fbc) userData.fbc = d.fbc
  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: d.eventoEmSegundos,
        event_id: d.eventId,
        action_source: 'website',
        event_source_url: 'https://app.saiae.com.br/assinar',
        user_data: userData,
        custom_data: { value: d.valorCentavos / 100, currency: 'BRL' },
      },
    ],
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  }
}

export async function montarPayloadGa4(d: DadosPurchase) {
  return {
    client_id: d.gaClientId ?? (await sha256Hex(d.usuarioId)).slice(0, 20),
    events: [
      { name: 'purchase', params: { transaction_id: d.eventId, value: d.valorCentavos / 100, currency: 'BRL' } },
    ],
  }
}

export type DepsMedicao = {
  fetch: typeof fetch
  metaToken: string | undefined
  ga4Secret: string | undefined
  pixelId?: string
  ga4Id?: string
  testEventCode?: string
}

async function postar(f: typeof fetch, url: string, corpo: unknown): Promise<number> {
  const resp = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return resp.status
}

/** Envia aos dois destinos em paralelo. NUNCA lança; o log traz só o destino e o status (sem dados pessoais). */
export async function enviarPurchase(d: DadosPurchase, deps: DepsMedicao): Promise<{ meta: boolean; ga4: boolean }> {
  const resultado = { meta: false, ga4: false }
  const tarefas: Promise<void>[] = []
  if (deps.metaToken) {
    tarefas.push(
      (async () => {
        const payload = { ...(await montarPayloadMeta(d, deps.testEventCode)), access_token: deps.metaToken }
        const status = await postar(deps.fetch, `https://graph.facebook.com/v21.0/${deps.pixelId ?? PIXEL_ID_PADRAO}/events`, payload)
        resultado.meta = status >= 200 && status < 300
        if (!resultado.meta) console.warn(`medicao: Meta respondeu ${status}`)
      })().catch((e) => console.warn('medicao: Meta falhou', e instanceof Error ? e.name : 'erro')),
    )
  }
  if (deps.ga4Secret) {
    tarefas.push(
      (async () => {
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${deps.ga4Id ?? GA4_ID_PADRAO}&api_secret=${deps.ga4Secret}`
        const status = await postar(deps.fetch, url, await montarPayloadGa4(d))
        resultado.ga4 = status >= 200 && status < 300
        if (!resultado.ga4) console.warn(`medicao: GA4 respondeu ${status}`)
      })().catch((e) => console.warn('medicao: GA4 falhou', e instanceof Error ? e.name : 'erro')),
    )
  }
  await Promise.all(tarefas)
  return resultado
}
