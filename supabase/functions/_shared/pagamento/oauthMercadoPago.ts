// OAuth do Mercado Pago (marketplace): a barraca conecta a própria conta e as cobranças saem com o token DELA.
// Funções puras + chamadas HTTP com fetch injetável, sem imports de jsr:/Deno, para os testes de node executarem
// este código. NUNCA registra token, código ou client_secret (nem em erro): só o status HTTP.
//
// Refresh tokens ROTACIONAM: cada renovação devolve um refresh_token novo e o antigo deixa de valer, então quem
// chama sempre grava o que veio na resposta.

export const URL_AUTORIZACAO_MP = 'https://auth.mercadopago.com/authorization'
export const URL_TOKEN_MP = 'https://api.mercadopago.com/oauth/token'

export type TokensMp = {
  accessToken: string
  refreshToken: string
  expiraEmSegundos: number
  userId: string
  /** Chave pública do VENDEDOR: o token do cartão é criado no navegador com ela. Nula se o MP não mandar. */
  publicKey: string | null
}

/** Falha do MP no OAuth. `status` 0 = erro de rede/resposta ilegível. Só 4xx é recusa definitiva. */
export class ErroOauthMp extends Error {
  status: number
  constructor(status: number) {
    super(`oauth_mp_${status}`)
    this.status = status
  }
  get definitivo(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429
  }
}

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/**
 * `redirectUri` precisa ser IGUAL, caractere por caractere (barra final inclusive), à URL de redirecionamento
 * cadastrada no app do Mercado Pago, senão o MP recusa a troca do código.
 */
export function montarUrlAutorizacao(p: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state: p.state,
    redirect_uri: p.redirectUri,
  })
  return `${URL_AUTORIZACAO_MP}?${q.toString()}`
}

/** Verdadeiro se faltam menos de `folgaMinutos` para vencer (ou se a data é ilegível). */
export function precisaRenovar(expiraEmIso: string, agora: Date, folgaMinutos = 60): boolean {
  const expira = new Date(expiraEmIso).getTime()
  if (Number.isNaN(expira)) return true
  return expira - agora.getTime() < folgaMinutos * 60_000
}

function lerTokens(dados: unknown): TokensMp {
  const d = (dados ?? {}) as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const accessToken = texto(d.access_token)
  const refreshToken = texto(d.refresh_token)
  const expira = Number(d.expires_in)
  if (!accessToken || !refreshToken || !Number.isFinite(expira) || expira <= 0 || d.user_id == null) {
    throw new ErroOauthMp(0)
  }
  return { accessToken, refreshToken, expiraEmSegundos: expira, userId: String(d.user_id), publicKey: texto(d.public_key) }
}

async function pedirToken(corpo: Record<string, string>, fetchFn: FetchFn): Promise<TokensMp> {
  let resp
  try {
    resp = await fetchFn(URL_TOKEN_MP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    })
  } catch {
    throw new ErroOauthMp(0)
  }
  if (!resp.ok) throw new ErroOauthMp(resp.status)
  let dados: unknown
  try {
    dados = await resp.json()
  } catch {
    throw new ErroOauthMp(0)
  }
  return lerTokens(dados)
}

// Não enviar `test_token`: o modo de teste vem da conta do vendedor, não do pedido.
export function trocarCodigo(
  p: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<TokensMp> {
  return pedirToken(
    { client_id: p.clientId, client_secret: p.clientSecret, grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri },
    fetchFn,
  )
}

export function renovar(
  p: { clientId: string; clientSecret: string; refreshToken: string },
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<TokensMp> {
  return pedirToken(
    { client_id: p.clientId, client_secret: p.clientSecret, grant_type: 'refresh_token', refresh_token: p.refreshToken },
    fetchFn,
  )
}

/** Destino do redirecionamento do callback: ok ou erro, sempre em /ajustes. */
export function urlRetornoApp(baseApp: string, ok: boolean): string {
  return `${baseApp.replace(/\/+$/, '')}/ajustes?mp=${ok ? 'ok' : 'erro'}`
}

export const VALIDADE_STATE_MINUTOS = 10
