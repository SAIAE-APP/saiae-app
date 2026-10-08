// Camada de provedores de pagamento Pix (Sprint 5, Story A).
//
// `criar-pagamento-pix` e `webhook-mercadopago` falam com QUALQUER provedor só
// por esta interface. Cada provedor mora num arquivo (mercadopago.ts primeiro) e
// é registrado em registro.ts. O dono usa a PRÓPRIA conta/token do provedor: o
// Sai aê nunca custodia dinheiro.
//
// Regras que NÃO mudam com o provedor (ficam nas functions, não aqui): preço e
// taxa resolvidos no servidor, webhook nunca confia no corpo da notificação
// (consulta o provedor de volta com o token da barraca e confere referência e
// valor = itens + taxa do snapshot), idempotência por client_uuid/pendente, e
// pedido só nasce depois da aprovação confirmada.

export const PROVEDORES = ['mercadopago', 'pagbank', 'asaas', 'woovi', 'abacatepay'] as const
export type ProvedorChave = (typeof PROVEDORES)[number]

/** Provedor padrão: pendentes antigos e URLs de notificação sem `p` valem como Mercado Pago. */
export const PROVEDOR_PADRAO: ProvedorChave = 'mercadopago'

export function ehProvedorValido(valor: unknown): valor is ProvedorChave {
  return typeof valor === 'string' && (PROVEDORES as readonly string[]).includes(valor)
}

export type StatusPagamento = 'aprovado' | 'pendente' | 'rejeitado' | 'expirado'

export type ParamsCobranca = {
  /** Token (credencial) da conta do dono no provedor. */
  token: string
  /** Total em centavos INTEIROS (itens + taxa). */
  valorCentavos: number
  /** Id do pendente em `pagamentos_pendentes`: volta na consulta e é a chave de idempotência. */
  referencia: string
  descricao: string
  expiraEm: Date
  /** URL que o provedor chama quando o pagamento muda (já com `?pendente=…&p=…`). */
  urlNotificacao: string
  /** Opcional: o cardápio público não coleta dados do pagador. */
  pagador?: { email?: string; nome?: string }
}

export type QrPix = {
  /** Id do pagamento/cobrança no provedor (fica em `pagamentos_pendentes.mercadopago_order_id`, coluna histórica). */
  idExterno: string
  /** Pix copia e cola. */
  copiaECola: string | null
  qrCodeBase64: string | null
  /** Link de pagamento do provedor, quando existir (só informativo). */
  ticketUrl?: string | null
}

export type ConsultaPagamento = {
  status: StatusPagamento
  /** Valor pago/cobrado em centavos INTEIROS (nunca ponto flutuante). */
  valorCentavos: number
  /** `referencia` enviada na cobrança (id do pendente). */
  referencia: string
}

/**
 * valida: assinatura confere. invalida: veio assinatura e NÃO confere (rejeitar).
 * sem_segredo: a barraca não cadastrou o segredo (segue só com a consulta).
 * sem_assinatura: há segredo, mas a notificação veio sem cabeçalho de assinatura (segue só com a consulta).
 */
export type ResultadoAssinatura = 'valida' | 'invalida' | 'sem_segredo' | 'sem_assinatura'

export type Notificacao =
  /** Não é notificação de pagamento (ou não traz id): responder 200 e ignorar. */
  | { ignorar: true }
  | { ignorar?: false; idExterno: string }

/** Falha ao falar com o provedor. `rede` = nem chegou a responder. */
export class ErroProvedor extends Error {
  rede: boolean
  detalhe: unknown
  constructor(mensagem: string, opcoes: { rede?: boolean; detalhe?: unknown } = {}) {
    super(mensagem)
    this.name = 'ErroProvedor'
    this.rede = opcoes.rede ?? false
    this.detalhe = opcoes.detalhe
  }
}

export interface ProvedorPix {
  readonly chave: ProvedorChave
  /** Nome pra mensagens ao usuário ("Falha ao contatar o Mercado Pago"). */
  readonly nome: string

  /** Cria a cobrança Pix. Idempotente por `referencia` quando o provedor permite. Lança ErroProvedor. */
  criarCobranca(params: ParamsCobranca): Promise<QrPix>

  /** QR de uma cobrança já emitida (retry do mesmo client_uuid). Nunca cria cobrança nova. */
  recuperarQr(params: { token: string; idExterno: string }): Promise<Omit<QrPix, 'idExterno'>>

  /** Consulta o pagamento DE VOLTA no provedor (única fonte de verdade do status). Lança ErroProvedor. */
  consultarPagamento(params: { token: string; idExterno: string }): Promise<ConsultaPagamento>

  /** Lê o id do pagamento da notificação. `lerCorpo` só é chamado se a URL não bastar (corpo lido uma vez). */
  extrairIdDaNotificacao(url: URL, lerCorpo: () => Promise<unknown>): Promise<Notificacao>

  /**
   * Assinatura da notificação, quando o provedor tiver. `segredo` é o segredo de assinatura da
   * barraca (null = o dono ainda não cadastrou). Ausente = só a confirmação por consulta.
   * A assinatura é uma camada EXTRA: a garantia de verdade continua sendo consultar o
   * provedor de volta com o token da barraca.
   */
  validarNotificacao?(req: Request, segredo: string | null): Promise<ResultadoAssinatura>
}

/** "12.34" | 12.34 | "12" → 1234 (centavos inteiros, sem erro de ponto flutuante). */
export function valorDecimalParaCentavos(valor: unknown): number {
  return Math.round(Number(valor) * 100)
}

/** 1234 → 12.34 (só pra provedores cuja API recebe decimal). */
export function centavosParaDecimal(centavos: number): number {
  return centavos / 100
}
