/** Estado da conexão Mercado Pago em Ajustes (lógica pura, testada em tests/ajustesMercadoPago.test.ts). */
export type EstadoMercadoPago =
  | 'conectada'
  | 'desconectada'
  | 'aviso_corte'
  | 'bloqueada'
  | 'nao_configurada'

export function estadoMercadoPago(p: {
  conectada: boolean
  tokenAntigoConfigurado: boolean
  /** Já existiu conexão OAuth que hoje não está ativa (precisa reconectar). */
  jaConectou?: boolean
  agora: Date
  /** Corte do token colado; sem corte nunca bloqueia nem mostra contagem. */
  corte?: Date | null
}): EstadoMercadoPago {
  if (p.conectada) return 'conectada'
  if (p.jaConectou) return 'desconectada'
  if (p.tokenAntigoConfigurado) {
    return p.corte && p.agora.getTime() >= p.corte.getTime() ? 'bloqueada' : 'aviso_corte'
  }
  return 'nao_configurada'
}

/** ISO completo ou só data (AAAA-MM-DD = meia-noite de Brasília). Vazio ou inválido = null. */
export function lerCorte(iso: string | undefined | null): Date | null {
  if (!iso) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00-03:00` : iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "DD/MM" no fuso de Brasília. */
export function dataDoCorte(iso: string | undefined | null): string | null {
  const d = lerCorte(iso)
  if (!d) return null
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(d)
}

/** Resultado que o callback do OAuth devolve em `?mp=`. */
export function retornoOauthMp(search: string): 'ok' | 'erro' | null {
  const v = new URLSearchParams(search).get('mp')
  return v === 'ok' || v === 'erro' ? v : null
}

/** Slug da loja que iniciou o OAuth: o callback volta em /ajustes (sem slug) e usamos isto para achar a loja. */
export const CHAVE_SLUG_MP = 'saiae:mp-oauth-slug'
