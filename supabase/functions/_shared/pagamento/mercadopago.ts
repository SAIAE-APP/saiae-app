// Provedor Mercado Pago (Payments API). Comportamento IDÊNTICO ao que
// criar-pagamento-pix e webhook-mercadopago faziam antes da camada de provedores:
// só foi movido pra trás da interface ProvedorPix.
//
// Payments API (não Orders): a Orders API rejeita `notification_url` no body
// ("additionalProperties '$.notification_url' not allowed") e lá o webhook só
// existe configurado no painel da aplicação MP. Como cada barraca usa o PRÓPRIO
// token/app do Mercado Pago, depender do painel de cada dono é frágil — em
// /v1/payments a notification_url vai por pagamento.
import {
  ErroProvedor,
  valorDecimalParaCentavos,
  centavosParaDecimal,
  type ConsultaPagamento,
  type Notificacao,
  type ParamsCobranca,
  type ProvedorPix,
  type QrPix,
  type ResultadoAssinatura,
  type StatusPagamento,
} from './tipos.ts'

export const MERCADOPAGO_API_URL = 'https://api.mercadopago.com/v1/payments'

type MercadoPagoQr = {
  ticket_url?: string
  qr_code?: string
  qr_code_base64?: string
}

/** approved → aprovado; cancelled/expired → expirado; rejected → rejeitado; o resto
 * (pending, in_process, refunded, charged_back...) → pendente: não muda nada, espera. */
export function statusDoMercadoPago(status: unknown): StatusPagamento {
  switch (status) {
    case 'approved':
      return 'aprovado'
    case 'cancelled':
    case 'expired':
      return 'expirado'
    case 'rejected':
      return 'rejeitado'
    default:
      return 'pendente'
  }
}

export function extrairQrMercadoPago(pagamento: unknown): Omit<QrPix, 'idExterno'> {
  const dados = (pagamento as { point_of_interaction?: { transaction_data?: MercadoPagoQr } } | null)
    ?.point_of_interaction?.transaction_data
  return {
    copiaECola: dados?.qr_code ?? null,
    qrCodeBase64: dados?.qr_code_base64 ?? null,
    ticketUrl: dados?.ticket_url ?? null,
  }
}

/** O MP pede date_of_expiration com offset de Brasília (ex.: 2026-09-29T12:00:00.000-03:00). */
export function dataExpiracaoMercadoPago(expiraEm: Date): string {
  const brasilia = new Date(expiraEm.getTime() - 3 * 60 * 60 * 1000)
  return brasilia.toISOString().replace('Z', '-03:00')
}

export function montarCorpoCobrancaMercadoPago(p: ParamsCobranca): Record<string, unknown> {
  return {
    transaction_amount: centavosParaDecimal(p.valorCentavos),
    payment_method_id: 'pix',
    description: p.descricao,
    external_reference: p.referencia,
    date_of_expiration: dataExpiracaoMercadoPago(p.expiraEm),
    // Mercado Pago exige um e-mail de pagador; o cardápio público não coleta e-mail
    // do cliente final, então usa um endereço por pedido num domínio nosso.
    payer: { email: p.pagador?.email ?? `pedido-${p.referencia}@saiae.com.br` },
    // O id do pendente vai na URL: o webhook precisa saber de qual barraca é o token
    // pra consultar o pagamento, e só o MP guarda o dono do pagamento.
    notification_url: p.urlNotificacao,
  }
}

/**
 * Notificação do MP: `data.id`/`id` e `type`/`topic` na URL; se faltar, no corpo
 * JSON (`data.id`, `type`/`topic`). Só `payment` interessa. Sem id, ou de outro
 * tipo, é ignorada (o MP exige 200 rápido, senão reenvia pra sempre).
 */
export async function extrairNotificacaoMercadoPago(
  url: URL,
  lerCorpo: () => Promise<unknown>,
): Promise<Notificacao> {
  let idExterno = url.searchParams.get('data.id') ?? url.searchParams.get('id')
  let tipo = url.searchParams.get('type') ?? url.searchParams.get('topic')

  if (!idExterno || !tipo) {
    const corpo = (await lerCorpo().catch(() => null)) as {
      data?: { id?: unknown }
      type?: string
      topic?: string
    } | null
    idExterno = idExterno ?? (corpo?.data?.id != null ? String(corpo.data.id) : null)
    tipo = tipo ?? corpo?.type ?? corpo?.topic ?? null
  }

  if (!idExterno || (tipo && tipo !== 'payment')) return { ignorar: true }
  return { idExterno }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Comparação em tempo constante de duas strings hex do mesmo tamanho. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

/**
 * Valida o cabeçalho `x-signature` do Mercado Pago (`ts=<epoch>,v1=<hmac>`). O HMAC-SHA256
 * (hex) é calculado com o segredo do app sobre o manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`,
 * omitindo a parte cujo valor não veio. `data.id` vem da query da URL (minúsculo, quando alfanumérico).
 * Formato conforme a documentação de Webhooks do Mercado Pago.
 */
export async function validarAssinaturaMercadoPago(params: {
  xSignature: string
  xRequestId: string | null
  dataId: string | null
  segredo: string
}): Promise<boolean> {
  const partes = Object.fromEntries(
    params.xSignature.split(',').map((p) => {
      const i = p.indexOf('=')
      return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const ts = partes.ts
  const v1 = (partes.v1 ?? '').toLowerCase()
  if (!ts || !v1) return false

  let manifesto = ''
  if (params.dataId) manifesto += `id:${params.dataId.toLowerCase()};`
  if (params.xRequestId) manifesto += `request-id:${params.xRequestId};`
  manifesto += `ts:${ts};`

  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(params.segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const esperado = hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(manifesto)))
  return iguaisEmTempoConstante(esperado, v1)
}

export const mercadoPago: ProvedorPix = {
  chave: 'mercadopago',
  nome: 'Mercado Pago',

  async criarCobranca(params) {
    let resposta: Response
    try {
      resposta = await fetch(MERCADOPAGO_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
          // Um pagamento por pendente: retry do mesmo pendente devolve o mesmo
          // pagamento em vez de cobrar duas vezes.
          'X-Idempotency-Key': params.referencia,
        },
        body: JSON.stringify(montarCorpoCobrancaMercadoPago(params)),
      })
    } catch (erroRede) {
      throw new ErroProvedor('Falha ao contatar o Mercado Pago', { rede: true, detalhe: String(erroRede) })
    }

    const resultado = await resposta.json().catch(() => null)
    if (!resposta.ok || !resultado?.id) {
      const mensagem = resultado?.message ?? resultado?.error ?? 'Erro desconhecido no Mercado Pago'
      throw new ErroProvedor(mensagem, { detalhe: resultado })
    }

    return { idExterno: String(resultado.id), ...extrairQrMercadoPago(resultado) }
  },

  async recuperarQr({ token, idExterno }) {
    const resposta = await fetch(`${MERCADOPAGO_API_URL}/${idExterno}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return extrairQrMercadoPago(await resposta.json().catch(() => null))
  },

  async consultarPagamento({ token, idExterno }): Promise<ConsultaPagamento> {
    let resposta: Response
    try {
      resposta = await fetch(`${MERCADOPAGO_API_URL}/${idExterno}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch (erroRede) {
      throw new ErroProvedor('Falha ao contatar o Mercado Pago', { rede: true, detalhe: String(erroRede) })
    }
    const pagamento = await resposta.json().catch(() => null)
    if (!resposta.ok || !pagamento) {
      throw new ErroProvedor('falha ao confirmar status na API do Mercado Pago', { detalhe: pagamento })
    }
    return {
      status: statusDoMercadoPago(pagamento.status),
      valorCentavos: valorDecimalParaCentavos(pagamento.transaction_amount),
      referencia: String(pagamento.external_reference ?? ''),
    }
  },

  extrairIdDaNotificacao: extrairNotificacaoMercadoPago,

  async validarNotificacao(req, segredo): Promise<ResultadoAssinatura> {
    if (!segredo) return 'sem_segredo'
    const xSignature = req.headers.get('x-signature')
    if (!xSignature) return 'sem_assinatura'
    const url = new URL(req.url)
    const ok = await validarAssinaturaMercadoPago({
      xSignature,
      xRequestId: req.headers.get('x-request-id'),
      dataId: url.searchParams.get('data.id') ?? url.searchParams.get('id'),
      segredo,
    })
    return ok ? 'valida' : 'invalida'
  },
}
