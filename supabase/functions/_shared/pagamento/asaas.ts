// Provedor Asaas, pelo QR Code Pix ESTÁTICO (POST /v3/pix/qrCodes/static).
//
// Por que estático e não cobrança dinâmica: a cobrança dinâmica exige criar antes
// um `customer` com `name` e `cpfCnpj` (obrigatórios na doc), e o cardápio público
// não coleta o CPF do pagador. O QR estático não precisa de cliente: "não é
// necessário criar uma cobrança ou definir o cliente previamente" (doc Asaas). Em
// troca o dono informa a chave Pix dele cadastrada no Asaas (`addressKey`), guardada
// junto do token (`barracas_pagamento_token.chave_pix`).
//
// Cada pendente ganha um QR próprio, com valor fixo, `allowsMultiplePayments: false`,
// expiração e `externalReference` = id do pendente. O id do QR é o id externo
// (pagamentos_pendentes.mercadopago_order_id).
//
// Notificação: o Asaas NÃO aceita URL por pagamento — o webhook é da CONTA. Por isso,
// antes de criar o primeiro QR, `garantirWebhook` cria na conta do dono (se ainda não
// existir) um webhook apontando pra `webhook-mercadopago?p=asaas&b=<barraca>` com um
// authToken derivado (HMAC da chave de serviço do projeto + barraca; nada novo a
// configurar, nada armazenado). O Asaas devolve esse authToken no header
// `asaas-access-token`, que `validarNotificacao` confere. Se o webhook não puder ser
// garantido, NÃO cria o QR (pagar sem ser avisado deixaria o pedido preso).
//
// Confirmação: o webhook nunca é confiado. A notificação só entrega o `pixQrCodeId`;
// o status e o valor vêm de `GET /v3/payments?pixQrCodeId=<id>` com o token da barraca.
import {
  ErroProvedor,
  centavosParaDecimal,
  valorDecimalParaCentavos,
  type ConsultaPagamento,
  type Notificacao,
  type ParamsCobranca,
  type ProvedorPix,
  type StatusPagamento,
} from './tipos.ts'

/** Produção por padrão; pra testar no sandbox, defina o secret ASAAS_API_URL da function
 * (https://api-sandbox.asaas.com/v3) e remova depois. */
export const ASAAS_API_URL_PADRAO = 'https://api.asaas.com/v3'

/** Eventos que significam "Pix recebido". */
export const EVENTOS_ASAAS_PAGO = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'] as const

const EMAIL_PADRAO_WEBHOOK = 'bugs@saiae.com.br'

function lerEnv(nome: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
  return deno?.env.get(nome)
}

/** Chave de serviço do projeto (já existe nas functions): só usada como chave do HMAC do webhook. */
function segredoDoProjeto(): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
  return deno?.env.get('SUPABASE_SERVICE_ROLE_KEY')
}

function apiUrl(): string {
  return (lerEnv('ASAAS_API_URL') || ASAAS_API_URL_PADRAO).replace(/\/+$/, '')
}

function cabecalhos(token: string): Record<string, string> {
  return { access_token: token, 'Content-Type': 'application/json', 'User-Agent': 'SaiAe' }
}

/** PENDING → pendente; RECEIVED/CONFIRMED → aprovado; o resto não confirma pagamento. */
export function statusDoAsaas(status: unknown): StatusPagamento {
  switch (status) {
    case 'RECEIVED':
    case 'CONFIRMED':
      return 'aprovado'
    default:
      return 'pendente'
  }
}

/** authToken do webhook da conta (32+ caracteres, sem espaços): HMAC-SHA256 hex. */
export async function tokenWebhookAsaas(segredo: string, barracaId: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`asaas-webhook:${barracaId}`))
  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Comparação sem sair no primeiro byte diferente. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

/** URL do webhook da conta do dono (uma por barraca). */
export function urlWebhookAsaas(urlNotificacao: string, barracaId: string): string {
  const base = new URL(urlNotificacao)
  return `${base.origin}${base.pathname}?p=asaas&b=${barracaId}`
}

export function montarCorpoQrEstaticoAsaas(p: ParamsCobranca, chavePix: string): Record<string, unknown> {
  const segundos = Math.max(60, Math.round((p.expiraEm.getTime() - Date.now()) / 1000))
  return {
    addressKey: chavePix,
    description: p.descricao.slice(0, 140),
    value: centavosParaDecimal(p.valorCentavos),
    format: 'ALL',
    expirationSeconds: segundos,
    // Um pagamento por QR: nada de pagar duas vezes o mesmo pedido.
    allowsMultiplePayments: false,
    externalReference: p.referencia,
  }
}

/**
 * Notificação da conta: só interessa PAYMENT_RECEIVED/PAYMENT_CONFIRMED de pagamento
 * que veio de QR estático (traz `payment.pixQrCodeId`). O resto é ignorado (200).
 */
export async function extrairNotificacaoAsaas(
  _url: URL,
  lerCorpo: () => Promise<unknown>,
): Promise<Notificacao> {
  const corpo = (await lerCorpo().catch(() => null)) as {
    event?: string
    payment?: { pixQrCodeId?: unknown }
  } | null
  if (!corpo?.event || !(EVENTOS_ASAAS_PAGO as readonly string[]).includes(corpo.event)) return { ignorar: true }
  const qr = corpo.payment?.pixQrCodeId
  if (qr == null || String(qr) === '') return { ignorar: true }
  return { idExterno: String(qr) }
}

type PagamentoAsaas = {
  value?: unknown
  status?: unknown
  externalReference?: unknown
}

/**
 * Entre os pagamentos do QR, o aprovado (se houver) manda; senão vale o primeiro. A
 * referência volta do pagamento quando o Asaas a propaga; se não propagar, vale o
 * vínculo QR↔pendente (o QR foi criado por nós pra este pendente, com valor fixo e uso
 * único) e devolvemos a referência esperada. Referência DIFERENTE sempre é devolvida
 * como veio, e o webhook recusa.
 */
export function leituraDePagamentosAsaas(pagamentos: PagamentoAsaas[], referenciaEsperada: string): ConsultaPagamento {
  const aprovado = pagamentos.find((p) => statusDoAsaas(p.status) === 'aprovado')
  const escolhido = aprovado ?? pagamentos[0]
  if (!escolhido) return { status: 'pendente', valorCentavos: 0, referencia: referenciaEsperada }
  const referencia =
    escolhido.externalReference != null && String(escolhido.externalReference) !== ''
      ? String(escolhido.externalReference)
      : referenciaEsperada
  return {
    status: statusDoAsaas(escolhido.status),
    valorCentavos: valorDecimalParaCentavos(escolhido.value),
    referencia,
  }
}

async function chamar(url: string, token: string, init: RequestInit = {}) {
  let resposta: Response
  try {
    resposta = await fetch(url, { ...init, headers: { ...cabecalhos(token), ...(init.headers ?? {}) } })
  } catch (erroRede) {
    throw new ErroProvedor('Falha ao contatar o Asaas', { rede: true, detalhe: String(erroRede) })
  }
  const corpo = await resposta.json().catch(() => null)
  return { ok: resposta.ok, corpo }
}

function mensagemDeErro(corpo: unknown, padrao: string): string {
  const erros = (corpo as { errors?: { description?: string }[] } | null)?.errors
  return erros?.[0]?.description ?? padrao
}

/** Garante, na conta do dono, o webhook que avisa o Sai aê dos Pix recebidos. */
async function garantirWebhook(token: string, barracaId: string, urlNotificacao: string) {
  const segredo = segredoDoProjeto()
  if (!segredo) throw new ErroProvedor('Configuração do servidor incompleta')
  const url = urlWebhookAsaas(urlNotificacao, barracaId)

  const lista = await chamar(`${apiUrl()}/webhooks?limit=100`, token)
  if (!lista.ok) {
    throw new ErroProvedor(mensagemDeErro(lista.corpo, 'Não foi possível verificar o webhook no Asaas'), { detalhe: lista.corpo })
  }
  const existentes = ((lista.corpo as { data?: { url?: string; enabled?: boolean }[] } | null)?.data ?? [])
  if (existentes.some((w) => w.url === url && w.enabled !== false)) return

  const criado = await chamar(`${apiUrl()}/webhooks`, token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Sai ae - pedidos do cardapio',
      url,
      email: lerEnv('ASAAS_WEBHOOK_EMAIL') || EMAIL_PADRAO_WEBHOOK,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: await tokenWebhookAsaas(segredo, barracaId),
      sendType: 'SEQUENTIALLY',
      events: [...EVENTOS_ASAAS_PAGO],
    }),
  })
  if (!criado.ok) {
    throw new ErroProvedor(mensagemDeErro(criado.corpo, 'Não foi possível configurar o webhook no Asaas'), { detalhe: criado.corpo })
  }
}

export const asaas: ProvedorPix = {
  chave: 'asaas',
  nome: 'Asaas',
  configExtraObrigatoria: ['chave_pix'],
  qrRecuperavel: false,

  async criarCobranca(params) {
    const chavePix = params.configExtra?.chave_pix
    if (!chavePix) throw new ErroProvedor('Chave Pix do Asaas não configurada')

    await garantirWebhook(params.token, params.barracaId, params.urlNotificacao)

    const r = await chamar(`${apiUrl()}/pix/qrCodes/static`, params.token, {
      method: 'POST',
      body: JSON.stringify(montarCorpoQrEstaticoAsaas(params, chavePix)),
    })
    const corpo = r.corpo as { id?: string; payload?: string; encodedImage?: string } | null
    if (!r.ok || !corpo?.id) {
      throw new ErroProvedor(mensagemDeErro(r.corpo, 'Erro desconhecido no Asaas'), { detalhe: r.corpo })
    }
    return {
      idExterno: String(corpo.id),
      copiaECola: corpo.payload ?? null,
      qrCodeBase64: corpo.encodedImage ?? null,
      ticketUrl: null,
    }
  },

  // O QR estático não tem GET por id documentado: por isso `qrRecuperavel: false` e o QR emitido
  // fica guardado no pendente (qr_payload), de onde o retry do mesmo client_uuid o devolve.
  async recuperarQr() {
    return { copiaECola: null, qrCodeBase64: null, ticketUrl: null }
  },

  async consultarPagamento({ token, idExterno, referenciaEsperada }): Promise<ConsultaPagamento> {
    const r = await chamar(`${apiUrl()}/payments?pixQrCodeId=${encodeURIComponent(idExterno)}&limit=100`, token)
    if (!r.ok) {
      throw new ErroProvedor('falha ao confirmar status na API do Asaas', { detalhe: r.corpo })
    }
    const pagamentos = ((r.corpo as { data?: PagamentoAsaas[] } | null)?.data ?? []) as PagamentoAsaas[]
    return leituraDePagamentosAsaas(pagamentos, referenciaEsperada ?? '')
  },

  extrairIdDaNotificacao: extrairNotificacaoAsaas,

  async validarNotificacao(req) {
    const segredo = segredoDoProjeto()
    const barracaId = new URL(req.url).searchParams.get('b')
    const recebido = req.headers.get('asaas-access-token')
    if (!segredo || !barracaId || !recebido) return false
    return iguaisEmTempoConstante(recebido, await tokenWebhookAsaas(segredo, barracaId))
  },
}
