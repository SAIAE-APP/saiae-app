// Regras puras da tela de campanhas e avaliação do WhatsApp (fase 3). Contrato: docs/contrato/v1/whatsapp-disparos.md.
import { montarMensagemPronto } from './avisoPronto.ts'

export const TIPOS_DISPARO = ['reativacao', 'promocao'] as const
export type TipoDisparo = (typeof TIPOS_DISPARO)[number]
export const ROTULO_TIPO: Record<TipoDisparo, string> = { reativacao: 'Reativar quem sumiu', promocao: 'Promoção do dia' }

export const DIAS_REATIVACAO = [15, 30, 60, 90] as const
export const MAX_TEXTO_DISPARO = 600
export const MAX_ENVIO_DISPARO = 500
export const MAX_TEXTO_AVALIACAO = 500
export const RODAPE_SAIR = 'Para não receber mais mensagens, responda SAIR.'
export const TEXTO_AVALIACAO_PADRAO =
  'Olá {nome}! Como foi seu pedido {senha} na {barraca}? Responda com uma nota de 1 a 5 (5 = ótimo) e, se quiser, deixe um comentário.'

export const TEXTOS_SUGERIDOS: Record<TipoDisparo, string[]> = {
  reativacao: [
    'Olá {nome}! Faz um tempinho que você não pede na {barraca}. Estamos com saudade, vem matar a vontade!',
    'Oi {nome}, tudo bem? A {barraca} está de cardápio cheio de novidades. Que tal fazer um pedido hoje?',
  ],
  promocao: [
    'Olá {nome}! Hoje tem promoção especial na {barraca}. Aproveite, é só por hoje!',
    'Oi {nome}! Passando para avisar que a {barraca} preparou uma oferta de hoje para você. Peça já!',
  ],
}

export type EstadoCampanha = 'em_andamento' | 'concluida' | 'cancelada' | 'expirada'
export type CampanhaResumo = {
  id: string
  tipo: 'promocao' | 'reativacao'
  estado: EstadoCampanha
  criada_em: string
  total: number
  enviados: number
  falhas: number
  pulados: number
  na_fila: number
}
export type ItemAvaliacao = { pedido_id: string; nota: number; comentario: string | null; em: string }
export type HistoricoDisparos = {
  campanhas: CampanhaResumo[]
  avaliacoes: { media: number | null; total: number; enviadas_30d: number; itens: ItemAvaliacao[] }
}

export const textoDisparoValido = (t: string): boolean => {
  const n = t.trim().length
  return n >= 1 && n <= MAX_TEXTO_DISPARO
}

const ESTADOS: Record<EstadoCampanha, string> = {
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  expirada: 'Expirada',
}
export const rotuloEstadoCampanha = (e: EstadoCampanha): string => ESTADOS[e] ?? 'Desconhecida'

export const resumoCampanha = (c: Pick<CampanhaResumo, 'enviados' | 'total'>): string => `${c.enviados} de ${c.total} enviadas`

/** Média com uma casa decimal, ou null sem notas. */
export function mediaAvaliacoes(itens: { nota: number }[]): number | null {
  if (itens.length === 0) return null
  return Math.round((itens.reduce((s, i) => s + i.nota, 0) / itens.length) * 10) / 10
}

export function estrelas(n: number): string {
  const cheias = Math.max(0, Math.min(5, Math.round(n)))
  return '★'.repeat(cheias) + '☆'.repeat(5 - cheias)
}

export function fraseDaPrevia(p: { total: number; enviaveis: number }): string {
  if (p.total === 0) return 'Nenhum cliente aceitou receber ofertas nesse grupo.'
  if (p.total > p.enviaveis) return `Mostrando ${p.enviaveis} de ${p.total}; envie de novo depois para o restante.`
  return p.total === 1 ? 'Vai para 1 cliente que aceitou receber ofertas.' : `Vai para ${p.total} clientes que aceitaram receber ofertas.`
}

/** Como a mensagem chega (nome de exemplo). Variável sem valor some, nunca sobra "Olá !". */
export const previaDoTexto = (texto: string, barraca: string): string =>
  montarMensagemPronto(texto, { nome: 'Maria', senha: null, barraca })

export const VARIAVEIS_CAMPANHA = ['nome', 'barraca'] as const
export const VARIAVEIS_AVALIACAO = ['nome', 'senha', 'barraca'] as const

/** Variáveis {x} que não existem para esse tipo de texto (sem as chaves). Vazio = ok. */
export function variaveisInvalidas(texto: string, permitidas: readonly string[]): string[] {
  const usadas = [...texto.matchAll(/{([^{}]*)}/g)].map((m) => m[1])
  return [...new Set(usadas.filter((v) => !permitidas.includes(v)))]
}

export const fraseVariaveis = (invalidas: string[]): string =>
  `Variável não reconhecida: ${invalidas.map((v) => `{${v}}`).join(' ')}. Use só as listadas abaixo do campo.`

/** Erro devolvido pela function (corpo do 403/4xx) em frase para o dono. */
export function fraseErroDisparo(codigo: string | undefined): string {
  if (codigo === 'modulo_desligado') return 'Este recurso não está liberado para a sua loja.'
  if (codigo === 'sem_permissao') return 'Só o dono da loja pode fazer isso.'
  return 'Não foi possível falar com o WhatsApp agora. Tente de novo em instantes.'
}

const FRASES: Record<string, string> = {
  whatsapp_desconectado: 'O WhatsApp da loja está desconectado. Conecte e tente de novo.',
  campanha_em_andamento: 'Já existe uma campanha em andamento. Espere terminar ou cancele a atual.',
  limite_campanhas_dia: 'Limite de 2 campanhas por dia atingido. Tente de novo amanhã.',
  sem_destinatarios_validos: 'Nenhum dos telefones desse grupo é válido para envio.',
  sem_publico: 'Nenhum cliente aceitou receber ofertas nesse grupo.',
}
export const fraseMotivo = (motivo: string | undefined): string =>
  (motivo && FRASES[motivo]) || 'Não foi possível enviar agora. Tente de novo em instantes.'

export function fraseMotivoSalvar(estado: string | undefined): string {
  if (estado === 'modulo_desligado') return 'Este recurso ainda não está liberado para a sua loja.'
  if (estado === 'dados_invalidos') return 'Confira o texto: ele precisa ter de 1 a 500 caracteres.'
  if (estado === 'sem_acesso') return 'Sem permissão para alterar esta loja.'
  return 'Não foi possível salvar agora. Tente de novo.'
}
