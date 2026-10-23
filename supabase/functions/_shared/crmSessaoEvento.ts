// Evento de sessão do WhatsApp (CRM → Sai aê, contrato v1 §3): validação do corpo e tratamento da requisição.
// Funções puras (sem Deno/Supabase), testadas em tests/crmSessaoEvento.test.ts. A assinatura é a mesma da rota
// ia-contexto (iaAssinatura.ts), com o segredo de plataforma WHATSAPP_CONEXAO_SEGREDO.
import { TAMANHO_MAX_CORPO, verificarAssinaturaIa } from './iaAssinatura.ts'

export type EventoSessao = { barracaId: string; estado: 'conectado' | 'desconectado' | 'caiu'; em: string }
export type RespostaSessao = { status: number; corpo?: { ok: true } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHAVES = ['barraca_id', 'estado', 'occurred_at', 'request_id']
const ESTADOS = ['conectado', 'desconectado', 'caiu']
const FUTURO_MAX_MS = 5 * 60 * 1000

/** Só as quatro chaves do contrato; `occurred_at` em ISO-8601 e no máximo 5 min no futuro (um relógio doido não trava
 * os eventos seguintes). */
export function validarEventoSessao(
  corpo: unknown,
  agoraMs: number = Date.now(),
): { ok: true; evento: EventoSessao } | { ok: false } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false }
  const o = corpo as Record<string, unknown>
  if (Object.keys(o).some((k) => !CHAVES.includes(k))) return { ok: false }
  if (typeof o.barraca_id !== 'string' || !UUID.test(o.barraca_id)) return { ok: false }
  if (typeof o.request_id !== 'string' || !UUID.test(o.request_id)) return { ok: false }
  if (typeof o.estado !== 'string' || !ESTADOS.includes(o.estado)) return { ok: false }
  if (typeof o.occurred_at !== 'string') return { ok: false }
  const ms = Date.parse(o.occurred_at)
  if (Number.isNaN(ms) || ms > agoraMs + FUTURO_MAX_MS) return { ok: false }
  return { ok: true, evento: { barracaId: o.barraca_id, estado: o.estado as EventoSessao['estado'], em: new Date(ms).toISOString() } }
}

export async function tratarEventoSessao(
  r: { corpoBruto: string; timestamp: string | null; assinatura: string | null; segredo: string | undefined; agoraMs?: number },
  gravar: (e: EventoSessao) => Promise<'ok' | 'ignorado' | 'erro'>,
): Promise<RespostaSessao> {
  // Sem segredo de verdade a rota não existe: nunca aceita nada.
  if (!r.segredo || r.segredo.length < 16) return { status: 503 }
  if (new TextEncoder().encode(r.corpoBruto).length > TAMANHO_MAX_CORPO) return { status: 413 }
  if (!(await verificarAssinaturaIa(r.segredo, r.timestamp, r.assinatura, r.corpoBruto, r.agoraMs))) return { status: 401 }
  let json: unknown
  try {
    json = JSON.parse(r.corpoBruto)
  } catch {
    return { status: 422 }
  }
  const v = validarEventoSessao(json, r.agoraMs)
  if (!v.ok) return { status: 422 }
  const resultado = await gravar(v.evento)
  // 'ignorado' cobre evento atrasado, replay e barraca desconhecida: a resposta é a mesma do sucesso.
  return resultado === 'erro' ? { status: 500 } : { status: 200, corpo: { ok: true } }
}
