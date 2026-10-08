// Perfil do cliente final: token no aparelho + chamadas às edge functions. O token só existe aqui
// (no banco fica o hash); valer 30 dias e some ao sair, ao vencer ou quando o servidor recusar.
import { supabase } from './supabase'
import { guardarSessao, lerSessao, limparSessao, type SessaoCliente } from './clienteSessaoLocal.ts'

export { lerSessao, limparSessao }
export type { SessaoCliente }

async function corpoDoErro(error: unknown): Promise<{ erro?: string; tentativas_restantes?: number; codigo?: string; status?: number } | null> {
  const contexto = (error as { context?: unknown } | null)?.context
  if (contexto instanceof Response) {
    const corpo = await contexto.json().catch(() => null)
    return { ...(corpo ?? {}), status: contexto.status }
  }
  return null
}

export type RespostaPedirCodigo = { ok: true; reenvio_em_s: number; codigo_simulado?: string } | { ok: false; erro: string }

export async function pedirCodigo(args: { slug: string; nome: string; telefone: string; honeypot: string; msNoCheckout: number }): Promise<RespostaPedirCodigo> {
  const { data, error } = await supabase.functions.invoke('cliente-pedir-codigo', {
    body: { barraca_slug: args.slug, nome: args.nome, telefone: args.telefone, website: args.honeypot, ms_no_checkout: args.msNoCheckout },
  })
  if (error || !data?.ok) {
    const corpo = await corpoDoErro(error)
    return { ok: false, erro: corpo?.erro ?? 'Não conseguimos enviar o código. Tente de novo.' }
  }
  return { ok: true, reenvio_em_s: data.reenvio_em_s ?? 60, codigo_simulado: data.codigo_simulado }
}

export type RespostaVerificar = { ok: true; sessao: SessaoCliente } | { ok: false; erro: string; tentativasRestantes?: number }

export async function verificarCodigo(args: { slug: string; nome: string; telefone: string; codigo: string; aceitaPromocoes: boolean }): Promise<RespostaVerificar> {
  const { data, error } = await supabase.functions.invoke('cliente-verificar-codigo', {
    body: {
      barraca_slug: args.slug, nome: args.nome, telefone: args.telefone, codigo: args.codigo,
      aceita_promocoes: args.aceitaPromocoes, aparelho: navigator.userAgent.slice(0, 80),
    },
  })
  if (error || !data?.token) {
    const corpo = await corpoDoErro(error)
    return { ok: false, erro: corpo?.erro ?? 'Código inválido ou expirado. Peça um novo.', tentativasRestantes: corpo?.tentativas_restantes }
  }
  const sessao: SessaoCliente = { token: data.token, expira_em: data.expira_em, nome: data.cliente.nome, telefone: data.cliente.telefone }
  guardarSessao(args.slug, sessao)
  return { ok: true, sessao }
}

export type RespostaSessao<T> = { ok: true; dados: T } | { ok: false; sessaoInvalida: boolean; erro: string }

/** Chama `cliente-sessao`. Em 401 apaga a sessão do aparelho e avisa para voltar à etapa do código. */
export async function chamarSessao<T = Record<string, unknown>>(slug: string, acao: string, dados?: Record<string, unknown>): Promise<RespostaSessao<T>> {
  const sessao = lerSessao(slug)
  if (!sessao) return { ok: false, sessaoInvalida: true, erro: 'Sessão expirada' }
  const { data, error } = await supabase.functions.invoke('cliente-sessao', {
    body: { barraca_slug: slug, token: sessao.token, acao, dados },
  })
  if (error || !data || data.erro) {
    const corpo = await corpoDoErro(error)
    if (corpo?.status === 401) {
      limparSessao(slug)
      return { ok: false, sessaoInvalida: true, erro: 'Sua sessão expirou. Confirme seu telefone de novo.' }
    }
    return { ok: false, sessaoInvalida: false, erro: corpo?.erro ?? 'Não foi possível concluir. Tente de novo.' }
  }
  if (acao === 'sair' || acao === 'apagar') limparSessao(slug)
  return { ok: true, dados: data as T }
}
