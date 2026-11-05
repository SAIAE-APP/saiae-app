import type { BadgeVariant } from '../components/ui/Badge'

export type EstadoAdminBarraca = 'trial' | 'ativa' | 'vencida' | 'cancelada'
export type FiltroAdminBarracas = 'vence_7d' | 'trial_acabando' | 'vencida'

/** Linha de `admin_listar_barracas` (migration 20261028100000). */
export type AdminBarraca = {
  barraca_id: string
  nome: string
  slug: string
  email_dono: string
  plano: 'essencial' | 'pro' | null
  estado: EstadoAdminBarraca
  tem_acesso: boolean
  inicio_em: string | null
  vencimento_em: string | null
  dias_restantes: number | null
  origem_cobranca: 'stripe' | null
  ultimo_pagamento_em: string | null
  total: number
}

export const FILTROS_ADMIN: { valor: FiltroAdminBarracas | null; rotulo: string }[] = [
  { valor: null, rotulo: 'Todas' },
  { valor: 'vence_7d', rotulo: 'Vence em 7 dias' },
  { valor: 'trial_acabando', rotulo: 'Trial acabando' },
  { valor: 'vencida', rotulo: 'Vencidas' },
]

export const NOME_ESTADO_ADMIN: Record<EstadoAdminBarraca, string> = {
  trial: 'Trial',
  ativa: 'Ativa',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
}

export const VARIANTE_ESTADO_ADMIN: Record<EstadoAdminBarraca, BadgeVariant> = {
  trial: 'info',
  ativa: 'success',
  vencida: 'danger',
  cancelada: 'neutral',
}

export function textoDiasRestantes(dias: number | null): string {
  if (dias === null) return 'sem prazo'
  if (dias < 0) return `venceu há ${-dias} d`
  if (dias === 0) return 'vence hoje'
  return `${dias} d`
}

/** Resposta de `admin_resumo_ativas` (migration 20261028110000). */
export type AdminResumo = {
  janela_horas: number
  ativas_agora: number
  pedidos_hoje: number
  pedidos_hoje_por_barraca: { barraca_id: string; nome: string; slug: string; pedidos: number }[]
  barracas_novas_7d: number
  trials_acabando_7d: number
  pararam: { barraca_id: string; nome: string; slug: string; ultimo_pedido_em: string }[]
  pedidos_por_dia: { dia: string; pedidos: number }[]
}

/** "2026-10-17" -> "17/10", sem passar por Date (evita virar o dia por fuso). */
export function rotuloDia(dia: string): string {
  const [, mes, d] = dia.split('-')
  return `${d}/${mes}`
}

/** Resposta de `admin_alertas` (migration 20261028120000). */
export type AdminAlertas = {
  parou: { barraca_id: string; nome: string; ultimo_pedido_em: string }[]
  pico_erros: { versao: string; erros: number }[]
  webhook_falhas: number
}

/** Linha de `admin_saude_barracas`. Os `bigint` chegam como número no JSON. */
export type AdminSaude = {
  barraca_id: string
  nome: string
  slug: string
  versao_app: string | null
  plataforma: string | null
  versao_vista_em: string | null
  pedidos_7d: number
  pedidos_semana_anterior: number
  erros_24h: number
}

export function temAlerta(a: AdminAlertas): boolean {
  return a.parou.length > 0 || a.pico_erros.length > 0 || a.webhook_falhas > 0
}

/** Versão mais usada entre as barracas; quem está em outra está "desatualizada". */
export function versaoMaisUsada(linhas: AdminSaude[]): string | null {
  const contagem = new Map<string, number>()
  for (const l of linhas) if (l.versao_app) contagem.set(l.versao_app, (contagem.get(l.versao_app) ?? 0) + 1)
  let melhor: string | null = null
  let n = 0
  for (const [v, c] of contagem) if (c > n) [melhor, n] = [v, c]
  return melhor
}

/** Semana atual com menos da metade dos pedidos da anterior (e a anterior com pelo menos 5). */
export function quedaDePedidos(l: AdminSaude): boolean {
  return l.pedidos_semana_anterior >= 5 && l.pedidos_7d * 2 < l.pedidos_semana_anterior
}
