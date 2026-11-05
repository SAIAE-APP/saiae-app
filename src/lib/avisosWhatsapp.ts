import { montarMensagemPronto } from './avisoPronto.ts'

export const AVISO_TIPOS = ['recebido', 'pronto', 'saiu_entrega', 'entregue', 'cancelado'] as const
export type AvisoTipo = (typeof AVISO_TIPOS)[number]

export type AvisoConfig = { ativo: boolean; texto: string | null }
export type AvisosConfig = Record<AvisoTipo, AvisoConfig>

export const MAX_TEXTO_AVISO = 500

export const AVISOS_PADRAO: Record<AvisoTipo, { ativo: true; texto: string }> = {
  recebido: { ativo: true, texto: 'Olá {nome}! Recebemos seu pedido {senha} na {barraca}.' },
  pronto: { ativo: true, texto: 'Olá {nome}! Seu pedido {senha} da {barraca} está pronto. Pode retirar!' },
  saiu_entrega: { ativo: true, texto: 'Olá {nome}! Seu pedido {senha} da {barraca} saiu para a entrega.' },
  entregue: { ativo: true, texto: 'Olá {nome}! Seu pedido {senha} da {barraca} foi entregue. Bom apetite!' },
  cancelado: { ativo: true, texto: 'Olá {nome}! Seu pedido {senha} da {barraca} foi cancelado.' },
}

/** Aceita null/lixo; devolve sempre as cinco chaves, descartando as desconhecidas. */
export function normalizarAvisos(bruto: unknown): AvisosConfig {
  const origem = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {}
  const saida = {} as AvisosConfig
  for (const tipo of AVISO_TIPOS) {
    const item = origem[tipo]
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const texto = typeof o.texto === 'string' ? o.texto.trim() : ''
    saida[tipo] = {
      ativo: typeof o.ativo === 'boolean' ? o.ativo : true,
      texto: texto && texto.length <= MAX_TEXTO_AVISO ? texto : null,
    }
  }
  return saida
}

export function textoDoAviso(
  tipo: AvisoTipo,
  config: AvisosConfig,
  valores: { nome?: string | null; senha: number | string | null; barraca: string },
): string {
  // Texto que fica vazio depois de trocar as variáveis (ex.: só "{nome}" sem nome) vale como "sem texto": usa o padrão.
  return (
    montarMensagemPronto(config[tipo].texto ?? AVISOS_PADRAO[tipo].texto, valores) ||
    montarMensagemPronto(AVISOS_PADRAO[tipo].texto, valores)
  )
}
