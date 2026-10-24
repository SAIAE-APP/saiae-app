// Disparos de WhatsApp (fase 3) com o CRM (contrato v1: docs/contrato/v1/whatsapp-disparos.md).
// Mesmo esquema de assinatura de crmConexao.ts (X-Saiae-Event-Id/Timestamp/Signature). Funções puras, testadas em
// tests/disparosCrm.test.ts. Nunca devolve erro cru do CRM.
import { cabecalhosDoEvento, urlPermitida } from './eventosSaida.ts'

export type AcaoDisparo = 'previa' | 'enviar' | 'historico' | 'cancelar'
export type TipoDisparo = 'promocao' | 'reativacao'
export const DIAS_REATIVACAO = [15, 30, 60, 90] as const
export const MAX_DESTINATARIOS = 500
export const MAX_TEXTO = 600

export type Destinatario = { telefone: string; nome: string | null }
export type CorpoCrm =
  | { acao: 'criar'; tipo: TipoDisparo; texto: string; barraca_nome: string; destinatarios: Destinatario[] }
  | { acao: 'historico' }
  | { acao: 'cancelar'; campanha_id: string }

export type RespostaCriar =
  | { ok: true; campanha_id: string; total: number; invalidos: number; repetido: boolean }
  | { ok: false; motivo: 'whatsapp_desconectado' | 'campanha_em_andamento' | 'limite_campanhas_dia' | 'sem_destinatarios_validos' }
export type Campanha = {
  id: string
  tipo: TipoDisparo
  estado: 'em_andamento' | 'concluida' | 'cancelada' | 'expirada'
  criada_em: string
  total: number
  enviados: number
  falhas: number
  pulados: number
  na_fila: number
}
export type ItemAvaliacao = { pedido_id: string; nota: number; comentario: string | null; em: string }
export type RespostaHistorico = {
  ok: true
  campanhas: Campanha[]
  avaliacoes: { media: number | null; total: number; enviadas_30d: number; itens: ItemAvaliacao[] }
}
export type RespostaCancelar = { ok: true; cancelados: number }
export type ResultadoCrm<T> = { ok: true; dados: T } | { ok: false; motivo: string }

const TIMEOUT_MS = 10_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MOTIVOS_CRIAR = ['whatsapp_desconectado', 'campanha_em_andamento', 'limite_campanhas_dia', 'sem_destinatarios_validos']
const ESTADOS = ['em_andamento', 'concluida', 'cancelada', 'expirada']

/** Enviar e cancelar disparam ou param mensagens da loja: só o dono. Prévia e histórico, qualquer vínculo. */
export function podeDisparar(acao: AcaoDisparo, papel: string | null): boolean {
  return papel === 'dono' || acao === 'previa' || acao === 'historico'
}

/** CRM_WHATSAPP_DISPAROS_URL; sem ela, deriva da URL da conexão trocando o final `whatsapp-conexao` por `whatsapp-disparos`. */
export function urlDisparos(env: { disparos?: string; conexao?: string }): string | null {
  const direta = env.disparos?.trim()
  if (direta) return direta
  const base = env.conexao?.trim() ?? ''
  return /\/whatsapp-conexao\/?$/.test(base) ? base.replace(/\/whatsapp-conexao\/?$/, '/whatsapp-disparos') : null
}

/** Variáveis {x} do texto que não estão na lista permitida (sem as chaves). Vazio = texto ok. */
export function variaveisInvalidas(texto: string, permitidas: readonly string[]): string[] {
  const usadas = [...texto.matchAll(/{([^{}]*)}/g)].map((m) => m[1])
  return [...new Set(usadas.filter((v) => !permitidas.includes(v)))]
}
export const VARIAVEIS_CAMPANHA = ['nome', 'barraca'] as const

export const requestIdValido = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export type Publico = { tipo: TipoDisparo; dias: number | null }

/** Tipo e (para reativação) dias. Promoção ignora `dias`. */
export function validarPublico(b: unknown): Publico | null {
  if (typeof b !== 'object' || b === null) return null
  const o = b as Record<string, unknown>
  if (o.tipo === 'promocao') return { tipo: 'promocao', dias: null }
  if (o.tipo !== 'reativacao') return null
  if (typeof o.dias !== 'number' || !(DIAS_REATIVACAO as readonly number[]).includes(o.dias)) return null
  return { tipo: 'reativacao', dias: o.dias }
}

export function validarEnvio(b: unknown): (Publico & { texto: string }) | null {
  const p = validarPublico(b)
  if (!p) return null
  const texto = (b as Record<string, unknown>).texto
  if (typeof texto !== 'string') return null
  const t = texto.trim()
  if (t.length < 1 || t.length > MAX_TEXTO) return null
  if (variaveisInvalidas(t, VARIAVEIS_CAMPANHA).length > 0) return null
  return { ...p, texto: t }
}

/** Linhas do banco -> destinatários do contrato: telefone só com dígitos (8 a 15), nome até 60 ou null, no máximo 500. */
export function montarDestinatarios(linhas: { telefone: string | null; nome: string | null }[]): Destinatario[] {
  const saida: Destinatario[] = []
  for (const l of linhas) {
    const telefone = (l.telefone ?? '').replace(/\D/g, '')
    if (telefone.length < 8 || telefone.length > 15) continue
    saida.push({ telefone, nome: l.nome?.trim().slice(0, 60) || null })
    if (saida.length >= MAX_DESTINATARIOS) break
  }
  return saida
}

const inteiro = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const dataValida = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

export function validarRespostaCriar(bruto: unknown): RespostaCriar | null {
  if (typeof bruto !== 'object' || bruto === null) return null
  const o = bruto as Record<string, unknown>
  if (o.ok === false) {
    return typeof o.motivo === 'string' && MOTIVOS_CRIAR.includes(o.motivo) ? ({ ok: false, motivo: o.motivo } as RespostaCriar) : null
  }
  if (o.ok !== true || typeof o.campanha_id !== 'string' || o.campanha_id.length < 1 || o.campanha_id.length > 40) return null
  if (!inteiro(o.total) || !inteiro(o.invalidos) || typeof o.repetido !== 'boolean') return null
  return { ok: true, campanha_id: o.campanha_id, total: o.total, invalidos: o.invalidos, repetido: o.repetido }
}

function validarCampanha(c: unknown): Campanha | null {
  if (typeof c !== 'object' || c === null) return null
  const o = c as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length < 1 || o.id.length > 40) return null
  if (o.tipo !== 'promocao' && o.tipo !== 'reativacao') return null
  if (typeof o.estado !== 'string' || !ESTADOS.includes(o.estado) || !dataValida(o.criada_em)) return null
  for (const k of ['total', 'enviados', 'falhas', 'pulados', 'na_fila']) if (!inteiro(o[k])) return null
  return {
    id: o.id, tipo: o.tipo, estado: o.estado as Campanha['estado'], criada_em: o.criada_em as string,
    total: o.total as number, enviados: o.enviados as number, falhas: o.falhas as number, pulados: o.pulados as number, na_fila: o.na_fila as number,
  }
}

function validarItem(i: unknown): ItemAvaliacao | null {
  if (typeof i !== 'object' || i === null) return null
  const o = i as Record<string, unknown>
  if (typeof o.pedido_id !== 'string' || !UUID.test(o.pedido_id)) return null
  if (typeof o.nota !== 'number' || !Number.isInteger(o.nota) || o.nota < 1 || o.nota > 5) return null
  if (o.comentario !== null && typeof o.comentario !== 'string') return null
  if (!dataValida(o.em)) return null
  return { pedido_id: o.pedido_id, nota: o.nota, comentario: o.comentario === null ? null : (o.comentario as string).slice(0, 300), em: o.em as string }
}

export function validarRespostaHistorico(bruto: unknown): RespostaHistorico | null {
  if (typeof bruto !== 'object' || bruto === null) return null
  const o = bruto as Record<string, unknown>
  if (o.ok !== true || !Array.isArray(o.campanhas) || typeof o.avaliacoes !== 'object' || o.avaliacoes === null) return null
  const campanhas: Campanha[] = []
  for (const c of o.campanhas.slice(0, 10)) {
    const v = validarCampanha(c)
    if (!v) return null
    campanhas.push(v)
  }
  const a = o.avaliacoes as Record<string, unknown>
  if (a.media !== null && (typeof a.media !== 'number' || a.media < 1 || a.media > 5)) return null
  if (!inteiro(a.total) || !inteiro(a.enviadas_30d) || !Array.isArray(a.itens)) return null
  const itens: ItemAvaliacao[] = []
  for (const i of a.itens.slice(0, 20)) {
    const v = validarItem(i)
    if (!v) return null
    itens.push(v)
  }
  return { ok: true, campanhas, avaliacoes: { media: a.media as number | null, total: a.total, enviadas_30d: a.enviadas_30d, itens } }
}

export function validarRespostaCancelar(bruto: unknown): RespostaCancelar | null {
  if (typeof bruto !== 'object' || bruto === null) return null
  const o = bruto as Record<string, unknown>
  return o.ok === true && inteiro(o.cancelados) ? { ok: true, cancelados: o.cancelados } : null
}

export async function chamarDisparosCrm(
  a: { url: string; segredo: string; barracaId: string; requestId: string; corpo: CorpoCrm },
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoCrm<unknown>> {
  if (!urlPermitida(a.url)) return { ok: false, motivo: 'URL do CRM não permitida (precisa ser https público)' }
  const corpo = JSON.stringify({ barraca_id: a.barracaId, request_id: a.requestId, ...a.corpo })
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
    const validado =
      a.corpo.acao === 'criar' ? validarRespostaCriar(json) : a.corpo.acao === 'historico' ? validarRespostaHistorico(json) : validarRespostaCancelar(json)
    return validado ? { ok: true, dados: validado } : { ok: false, motivo: 'resposta do CRM inválida' }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error && e.name === 'TimeoutError' ? 'tempo esgotado' : 'erro de rede' }
  }
}
