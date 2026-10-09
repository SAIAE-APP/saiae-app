// Chamadas do assistente de configuração ao banco (RPCs da migration 20261020100000). Cada passo SALVA na hora.
import { supabase } from './supabase'
import { mensagemErroOnboarding, type HorarioDia, type RespostaConsulta, horariosParaRpc } from './onboardingConfig'
import type { Barraca } from '../types/database'

type Resultado<T = void> = { ok: true; dados: T } | { ok: false; erro: string }

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  try {
    const { data, error } = await supabase.rpc(nome, args)
    if (error) return { ok: false, erro: mensagemErroOnboarding(error.message) }
    return { ok: true, dados: data as T }
  } catch (e) {
    return { ok: false, erro: mensagemErroOnboarding(e instanceof Error ? e.message : '') }
  }
}

/** Telemetria mínima (sem texto livre): nunca atrapalha o fluxo. */
export function registrarEvento(barracaId: string | null, passo: number, acao: 'visto' | 'concluido' | 'pulado' | 'abandonou'): void {
  void rpc('onboarding_evento', { p_barraca_id: barracaId, p_passo: passo, p_acao: acao })
}

export const slugDisponivel = async (slug: string): Promise<boolean | null> => {
  const r = await rpc<boolean>('slug_disponivel', { p_slug: slug })
  return r.ok ? r.dados === true : null // null = não deu para saber (não bloqueia; o banco confere ao criar)
}

export const salvarOrigem = (origem: string | null, detalhe: string | null, categoria: string | null) =>
  rpc('onboarding_salvar_origem', { p_origem: origem ?? '', p_detalhe: detalhe ?? '', p_categoria: categoria ?? '' })

export const criarBarraca = (nome: string, slug: string) => rpc<Barraca>('criar_barraca', { p_nome: nome, p_slug: slug })

const salvarPasso = <T = unknown>(barracaId: string, etapa: number, dados: Record<string, unknown> = {}) =>
  rpc<T>('onboarding_salvar_passo', { p_barraca_id: barracaId, p_etapa: etapa, p_dados: dados })

export const concluirMarca = (barracaId: string) => salvarPasso(barracaId, 3)
export const salvarHorarios = (barracaId: string, semana: HorarioDia[]) => salvarPasso(barracaId, 6, { horarios: horariosParaRpc(semana) })
export const salvarMetodos = (barracaId: string, metodos: string[]) => salvarPasso(barracaId, 7, { metodos })
export const salvarModos = (barracaId: string, modos: string[]) => salvarPasso(barracaId, 8, { modos })
export const salvarCnpj = (barracaId: string, d: { cnpj: string | null; semCnpj: boolean; razaoSocial: string | null }) =>
  salvarPasso(barracaId, 4, { cnpj: d.cnpj, sem_cnpj: d.semCnpj, razao_social: d.razaoSocial })
export const salvarEndereco = (barracaId: string, e: { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string }) =>
  salvarPasso(barracaId, 5, { ...e })
export const salvarTaxa = (barracaId: string, habilitada: boolean, centavos: number) =>
  salvarPasso(barracaId, 9, { habilitada, centavos })

export type DadosCnpj = {
  razao_social: string
  nome_fantasia: string
  ativa: boolean
  situacao: string
  endereco: { cep: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string }
}
export type DadosCep = { cep: string; rua: string; bairro: string; cidade: string; uf: string }

/** Consulta CNPJ ou CEP pela função nossa (o navegador não chama terceiros). Qualquer falha => "indisponivel":
 * o passo nunca trava, o dono preenche à mão. */
export async function consultarExterno<T>(tipo: 'cnpj' | 'cep', valor: string): Promise<RespostaConsulta<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('consultar-externo', { body: { tipo, valor } })
    if (error && !data) return { ok: false, motivo: 'indisponivel' }
    const r = data as { ok?: boolean; dados?: T; motivo?: string } | null
    if (r?.ok && r.dados) return { ok: true, dados: r.dados }
    const motivo = r?.motivo
    return { ok: false, motivo: motivo === 'nao_encontrado' || motivo === 'limite' || motivo === 'invalido' ? motivo : 'indisponivel' }
  } catch {
    return { ok: false, motivo: 'indisponivel' }
  }
}
export const consultarCnpj = (cnpj: string) => consultarExterno<DadosCnpj>('cnpj', cnpj)
export const consultarCep = (cep: string) => consultarExterno<DadosCep>('cep', cep)

export const concluirAssistente = (barracaId: string) => salvarPasso<{ concluido: boolean }>(barracaId, 10)

/** Situação do onboarding das barracas do usuário. Falha (migration ausente, sem rede) = "concluído":
 * o assistente NUNCA bloqueia por erro. */
export async function barracasComOnboardingPendente(ids: string[]): Promise<Pick<Barraca, 'id' | 'onboarding_etapa' | 'onboarding_concluido_em'>[]> {
  if (ids.length === 0) return []
  try {
    const { data, error } = await supabase.from('barracas').select('id, onboarding_etapa, onboarding_concluido_em').in('id', ids)
    if (error || !data) return []
    return (data as Pick<Barraca, 'id' | 'onboarding_etapa' | 'onboarding_concluido_em'>[]).filter((b) => b.onboarding_concluido_em === null)
  } catch {
    return []
  }
}

export async function carregarBarracaCompleta(id: string): Promise<Barraca | null> {
  try {
    const { data, error } = await supabase.from('barracas').select('*').eq('id', id).maybeSingle()
    return error ? null : ((data as Barraca | null) ?? null)
  } catch {
    return null
  }
}

export async function carregarSemana(barracaId: string) {
  try {
    const { data } = await supabase
      .from('horarios_funcionamento')
      .select('dia_semana, aberto, hora_abertura, hora_fechamento')
      .eq('barraca_id', barracaId)
    return (data ?? []) as { dia_semana: number; aberto: boolean; hora_abertura: string | null; hora_fechamento: string | null }[]
  } catch {
    return []
  }
}
