// Conexão do WhatsApp da barraca com o CRM (contrato v1: docs/contrato/v1/whatsapp-conexao.md).
// Mesmo esquema de assinatura dos eventos (INTEGRACAO.md §2): X-Saiae-Event-Id/Timestamp/Signature.
import { cabecalhosDoEvento, urlPermitida } from './eventosSaida.ts'

export type AcaoConexao = 'iniciar' | 'status' | 'desconectar' | 'historico'
export type AvisoHistorico = {
  pedido_id: string
  tipo: 'recebido' | 'pronto' | 'saiu_entrega' | 'entregue' | 'cancelado'
  estado: 'pendente' | 'enviado' | 'falhou' | 'pulado_sem_telefone' | 'pulado_optout' | 'pulado_desconectado' | 'pulado_nao_aplica'
  motivo: string | null
  em: string
}
export type EstadoConexao = {
  estado: 'sem_sessao' | 'aguardando_qr' | 'conectado' | 'desconectado'
  qr: string | null
  numero: string | null
  avisos: AvisoHistorico[]
}
export type ResultadoConexao = { ok: true; dados: EstadoConexao } | { ok: false; motivo: string }

const TIMEOUT_MS = 10_000
const MAX_AVISOS = 20
const ESTADOS = ['sem_sessao', 'aguardando_qr', 'conectado', 'desconectado']
const TIPOS = ['recebido', 'pronto', 'saiu_entrega', 'entregue', 'cancelado']
const ESTADOS_AVISO = ['pendente', 'enviado', 'falhou', 'pulado_sem_telefone', 'pulado_optout', 'pulado_desconectado', 'pulado_nao_aplica']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Iniciar e desconectar mexem na conexão da loja: só o dono. Ver o estado e o histórico, qualquer vínculo. */
export function podeExecutar(acao: AcaoConexao, papel: string | null): boolean {
  return papel === 'dono' || acao === 'status' || acao === 'historico'
}

function validarAviso(a: unknown): AvisoHistorico | null {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, unknown>
  if (typeof o.pedido_id !== 'string' || !UUID.test(o.pedido_id)) return null
  if (typeof o.tipo !== 'string' || !TIPOS.includes(o.tipo)) return null
  if (typeof o.estado !== 'string' || !ESTADOS_AVISO.includes(o.estado)) return null
  if (o.motivo !== null && typeof o.motivo !== 'string') return null
  if (typeof o.em !== 'string' || Number.isNaN(Date.parse(o.em))) return null
  return o as unknown as AvisoHistorico
}

function validarResposta(bruto: unknown): EstadoConexao | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const o = bruto as Record<string, unknown>
  if (typeof o.estado !== 'string' || !ESTADOS.includes(o.estado)) return null
  if (o.qr !== null && typeof o.qr !== 'string') return null
  if (o.numero !== null && (typeof o.numero !== 'string' || !/^[0-9]{8,15}$/.test(o.numero))) return null
  if (!Array.isArray(o.avisos)) return null
  const avisos: AvisoHistorico[] = []
  for (const a of o.avisos.slice(0, MAX_AVISOS)) {
    const v = validarAviso(a)
    if (!v) return null
    avisos.push(v)
  }
  const estado = o.estado as EstadoConexao['estado']
  // Conectado não tem QR: nunca repassa um QR velho.
  return { estado, qr: estado === 'aguardando_qr' ? (o.qr as string | null) : null, numero: o.numero as string | null, avisos }
}

export async function chamarConexaoCrm(
  a: { url: string; segredo: string; barracaId: string; acao: AcaoConexao; requestId: string },
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoConexao> {
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const corpo = JSON.stringify({ barraca_id: a.barracaId, acao: a.acao, request_id: a.requestId })
  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const resposta = await fetchFn(a.url, {
      method: 'POST',
      headers: await cabecalhosDoEvento(a.segredo, a.requestId, timestamp, corpo),
      body: corpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resposta.status < 200 || resposta.status >= 300) {
      await resposta.body?.cancel()
      return { ok: false, motivo: `CRM respondeu ${resposta.status}` }
    }
    let json: unknown
    try {
      json = await resposta.json()
    } catch {
      return { ok: false, motivo: 'resposta do CRM inválida' }
    }
    const dados = validarResposta(json)
    return dados ? { ok: true, dados } : { ok: false, motivo: 'resposta do CRM inválida' }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error && e.name === 'TimeoutError' ? 'tempo esgotado' : 'erro de rede' }
  }
}
