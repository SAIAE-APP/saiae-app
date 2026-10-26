// Regras puras da cobrança online do cardápio (Pix e cartão, marketplace do Mercado Pago).
// Sem rede e sem Deno: testadas em Node (pagamento.test.ts). A edge function criar-pagamento-pix só liga as peças.
import { totalCobrado } from '../cupom.ts'
import { aplicarTaxaPlataforma } from './taxaPlataforma.ts'
import type { ResultadoTokenVendedor } from './token.ts'
import type { StatusPagamento } from './tipos.ts'

export type MeioPagamento = 'pix' | 'cartao'

export type DadosCartao = { cardToken: string; paymentMethodId: string; issuerId?: string; emailPagador: string }

type Falha = { ok: false; status: number; corpo: { erro: string; codigo?: string } }

const textoCurto = (valor: unknown, max: number): string | null => {
  if (typeof valor === 'number' && Number.isFinite(valor)) valor = String(valor)
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  return t && t.length <= max ? t : null
}

/** Meio pedido no corpo. Ausente = Pix (cliente antigo). Cartão exige o token do cartão gerado no navegador. */
export function lerMeioPagamento(body: {
  meio?: unknown
  card_token?: unknown
  payment_method_id?: unknown
  issuer_id?: unknown
  email_pagador?: unknown
}): { ok: true; meio: 'pix' } | { ok: true; meio: 'cartao'; cartao: DadosCartao } | Falha {
  if (body.meio === undefined || body.meio === null || body.meio === 'pix') return { ok: true, meio: 'pix' }
  if (body.meio !== 'cartao') return { ok: false, status: 400, corpo: { erro: 'Meio de pagamento inválido' } }
  const cardToken = textoCurto(body.card_token, 200)
  const paymentMethodId = textoCurto(body.payment_method_id, 50)
  const email = textoCurto(body.email_pagador, 254)
  const issuerId = body.issuer_id === undefined || body.issuer_id === null || body.issuer_id === '' ? undefined : textoCurto(body.issuer_id, 30)
  if (!cardToken || !paymentMethodId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || issuerId === null) {
    return { ok: false, status: 422, corpo: { erro: 'Dados do cartão incompletos. Confira e tente de novo.', codigo: 'cartao_incompleto' } }
  }
  return { ok: true, meio: 'cartao', cartao: { cardToken, paymentMethodId, emailPagador: email, ...(issuerId ? { issuerId } : {}) } }
}

/** Corte do token colado (env CORTE_TOKEN_MP_ISO). Sem a variável, ou data inválida, o corte ainda NÃO chegou. */
export function corteTokenAtingido(corteIso: string | null | undefined, agora: Date): boolean {
  const corte = corteIso ? Date.parse(corteIso) : NaN
  return Number.isFinite(corte) && agora.getTime() >= corte
}

export type Credencial = { ok: true; modo: 'oauth'; token: string } | { ok: true; modo: 'token_colado' } | Falha

const NAO_CONECTADO: Falha = {
  ok: false,
  status: 409,
  corpo: { erro: 'Pagamento online indisponível nesta barraca. Escolha pagar na entrega.', codigo: 'mp_nao_conectado' },
}

/**
 * Qual credencial cobra. Barraca conectada por OAuth: sempre OAuth (com a taxa Sai aê). Sem OAuth: cartão nunca
 * (o token do cartão só existe no modo marketplace); Pix com o token colado só antes do corte (sem taxa).
 * Renovação do OAuth que falhou é falha (sem cair no token antigo): recusa definitiva já marca a barraca como
 * desconectada, e a próxima chamada vê `nao_conectada`.
 */
export function decidirCredencial(p: { vendedor: ResultadoTokenVendedor; corteAtingido: boolean; meio: MeioPagamento }): Credencial {
  if (p.vendedor.ok) return { ok: true, modo: 'oauth', token: p.vendedor.token }
  if (p.vendedor.motivo === 'renovacao_falhou') {
    return { ok: false, status: 503, corpo: { erro: 'Pagamento online indisponível agora. Tente de novo em instantes.', codigo: 'mp_indisponivel' } }
  }
  if (p.meio === 'cartao' || p.corteAtingido) return NAO_CONECTADO
  return { ok: true, modo: 'token_colado' }
}

/** Total cobrado = itens − cupom + entrega + taxa Sai aê (só no OAuth; pedido de total zero não paga taxa). */
export function totalDaCobranca(p: {
  subtotalItensCentavos: number
  descontoCentavos: number
  taxaEntregaCentavos: number
  modo: 'oauth' | 'token_colado'
}): { taxaPlataformaCentavos: number; totalCentavos: number } {
  const semTaxa = totalCobrado(p.subtotalItensCentavos, p.descontoCentavos, p.taxaEntregaCentavos)
  return p.modo === 'oauth' ? aplicarTaxaPlataforma(semTaxa) : { taxaPlataformaCentavos: 0, totalCentavos: semTaxa }
}

/** Pendente cobrado pelo OAuth? A taxa Sai aê só existe no OAuth, então taxa > 0 identifica a credencial. */
export function emitidoViaOauth(pendente: { taxa_plataforma_centavos?: unknown }): boolean {
  return Number(pendente.taxa_plataforma_centavos ?? 0) > 0
}

/** Status do cartão para o cliente. Cancelado/expirado conta como recusa (pode tentar de novo ou ir de Pix). */
export function statusCartaoParaCliente(status: StatusPagamento): 'aprovado' | 'pendente' | 'rejeitado' {
  return status === 'aprovado' || status === 'pendente' ? status : 'rejeitado'
}

type ClienteLeitura = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Chave pública do vendedor (para o navegador gerar o token do cartão), só de barraca com pagamento online
 * ligado e conectada por OAuth. Nunca devolve token. Qualquer falha = null (resposta genérica, sem enumerar).
 */
export async function chavePublicaDaBarraca(supabase: unknown, barracaId: unknown): Promise<string | null> {
  if (typeof barracaId !== 'string' || !UUID.test(barracaId)) return null
  const db = supabase as ClienteLeitura
  const [barraca, oauth] = await Promise.all([
    db.from('barracas').select('pagamento_online_habilitado').eq('id', barracaId),
    db.from('barracas_mp_oauth').select('status, public_key').eq('barraca_id', barracaId),
  ])
  if (barraca.error || oauth.error || barraca.data?.[0]?.pagamento_online_habilitado !== true) return null
  const linha = oauth.data?.[0]
  return linha?.status === 'conectada' && typeof linha.public_key === 'string' && linha.public_key ? linha.public_key : null
}
