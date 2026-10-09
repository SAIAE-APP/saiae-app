// Confirmação do WhatsApp do dono (docs/contrato/v1/ia-dono-confirmar.md). Dois sentidos, ambos assinados como o
// SAI-002 (X-Saiae-Timestamp em segundos; X-Saiae-Signature = "sha256=" + HMAC-SHA256(segredo, `${timestamp}.${corpo}`)):
//   * Comanda → CRM: pedir que o CRM mande o template ia_chamar_dono ao número cadastrado ("responda CONFIRMAR #CODIGO");
//   * CRM → Comanda: o dono respondeu; a rota `ia-dono-confirmar` grava a confirmação.
// Funções puras (sem Deno/Supabase), testadas em tests/iaDono.test.ts.
import { assinarEvento, urlPermitida } from './eventosSaida.ts'

const TIMEOUT_MS = 8_000

export type MotivoCrm = 'sem_whatsapp' | 'ia_inativa' | 'limite' | 'falha_envio'
export type ResultadoPedido =
  | { ok: true; enviado: true }
  | { ok: true; enviado: false; motivo: MotivoCrm }
  | { ok: false; motivo: string }

const MOTIVOS: MotivoCrm[] = ['sem_whatsapp', 'ia_inativa', 'limite', 'falha_envio']

/** Corpo que o CRM recebe: só código da loja e o telefone CADASTRADO (do banco, nunca do navegador). */
export function corpoDoPedido(codigoLoja: string, telefone: string): string | null {
  if (!/^[A-Z0-9]{6}$/.test(codigoLoja)) return null
  if (!/^[0-9]{10,13}$/.test(telefone)) return null
  return JSON.stringify({ codigo_loja: codigoLoja, telefone })
}

/** Resposta do CRM → resultado; qualquer forma diferente do contrato vira falha. */
export function interpretarRespostaPedido(corpo: unknown): ResultadoPedido {
  if (typeof corpo !== 'object' || corpo === null) return { ok: false, motivo: 'resposta do CRM fora do formato' }
  const { enviado, motivo } = corpo as Record<string, unknown>
  if (enviado === true) return { ok: true, enviado: true }
  if (enviado === false && typeof motivo === 'string' && (MOTIVOS as string[]).includes(motivo)) {
    return { ok: true, enviado: false, motivo: motivo as MotivoCrm }
  }
  return { ok: false, motivo: 'resposta do CRM fora do formato' }
}

export async function pedirConfirmacaoAoCrm(
  a: { url: string | undefined; segredo: string | undefined; codigoLoja: string; telefone: string },
  fetchFn: typeof fetch = fetch,
  agoraMs: number = Date.now(),
): Promise<ResultadoPedido> {
  if (!a.url || !a.segredo) return { ok: false, motivo: 'não configurado' }
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const corpo = corpoDoPedido(a.codigoLoja, a.telefone)
  if (!corpo) return { ok: false, motivo: 'dados inválidos' }
  const timestamp = Math.floor(agoraMs / 1000)
  try {
    const resposta = await fetchFn(a.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Saiae-Timestamp': String(timestamp),
        'X-Saiae-Signature': await assinarEvento(a.segredo, timestamp, corpo),
      },
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resposta.status !== 200) {
      await resposta.body?.cancel()
      return { ok: false, motivo: `CRM respondeu ${resposta.status}` }
    }
    return interpretarRespostaPedido(await resposta.json().catch(() => null))
  } catch (e) {
    return { ok: false, motivo: `erro de rede: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }
  }
}

export type EstadoConfirmar = 'ok' | 'ja_confirmado' | 'numero_diferente' | 'loja_inexistente'

/** Resposta da rota `ia-dono-confirmar` ao CRM: `confirmado: true` só quando a Comanda gravou (ou já estava gravado). */
export function respostaDaConfirmacao(estado: unknown): { confirmado: true } | { confirmado: false; motivo: string } {
  if (estado === 'ok' || estado === 'ja_confirmado') return { confirmado: true }
  if (estado === 'numero_diferente' || estado === 'loja_inexistente') return { confirmado: false, motivo: estado }
  return { confirmado: false, motivo: 'erro' }
}
