// Código de verificação, sessão e limites do perfil do cliente final. Funções puras (Deno e Node).

export const CODIGO_DIGITOS = 6
export const VALIDADE_CODIGO_MS = 5 * 60 * 1000
export const MAX_TENTATIVAS = 5
export const REENVIO_MIN_MS = 60 * 1000
export const VALIDADE_SESSAO_MS = 30 * 24 * 60 * 60 * 1000
export const LIMITE_TELEFONE_HORA = 3
export const LIMITE_IP_HORA = 10

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 6 dígitos uniformes (rejeição para não enviesar), com zeros à esquerda. */
export function gerarCodigo(): string {
  const limite = 4294967296 - (4294967296 % 1_000_000)
  const buf = new Uint32Array(1)
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limite)
  return String(buf[0] % 1_000_000).padStart(CODIGO_DIGITOS, '0')
}

/** Aceita "123 456", "123-456" e "123.456"; qualquer outra coisa que não seja 6 dígitos vira null. */
export function limparCodigo(texto: string | null | undefined): string | null {
  const limpo = String(texto ?? '').replace(/[\s.-]/g, '')
  return /^\d{6}$/.test(limpo) ? limpo : null
}

/** HMAC-SHA256 em hex de `${escopo}:${valor}` com a pimenta do servidor. Nunca guardar o valor em claro. */
export async function hashSegredo(pimenta: string, escopo: string, valor: string): Promise<string> {
  const chave = await crypto.subtle.importKey('raw', encoder.encode(pimenta), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', chave, encoder.encode(`${escopo}:${valor}`)))
}

/** 32 bytes aleatórios em base64url (43 caracteres). */
export function gerarTokenSessao(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Comparação em tempo constante (mesmo tamanho). */
export function iguaisConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export type RegistroCodigo = { codigo_hash: string; usado_em: string | null; tentativas: number; expira_em: string }
export type DecisaoCodigo = 'ok' | 'expirado' | 'usado' | 'excedido' | 'incorreto'

/** Ordem: usado, expirado, excedido, incorreto. O chamador conta a tentativa só em 'incorreto'. */
export function avaliarCodigo(reg: RegistroCodigo, hashInformado: string, agora: number): DecisaoCodigo {
  if (reg.usado_em) return 'usado'
  if (agora > Date.parse(reg.expira_em)) return 'expirado'
  if (reg.tentativas >= MAX_TENTATIVAS) return 'excedido'
  return iguaisConstante(reg.codigo_hash, hashInformado) ? 'ok' : 'incorreto'
}

export type EntradaLimites = {
  pedidosTelefoneHora: number
  pedidosIpHora: number
  enviosLoja24h: number
  tetoLoja: number
  /** ms desde o último código enviado a este telefone nesta loja; null se nunca. */
  msDesdeUltimoEnvio: number | null
}
export type DecisaoLimite = 'ok' | 'muito_cedo' | 'limite_telefone' | 'limite_ip' | 'limite_loja'

export function decidirLimites(e: EntradaLimites): DecisaoLimite {
  if (e.tetoLoja <= 0 || e.enviosLoja24h >= e.tetoLoja) return 'limite_loja'
  if (e.msDesdeUltimoEnvio !== null && e.msDesdeUltimoEnvio < REENVIO_MIN_MS) return 'muito_cedo'
  if (e.pedidosTelefoneHora >= LIMITE_TELEFONE_HORA) return 'limite_telefone'
  if (e.pedidosIpHora >= LIMITE_IP_HORA) return 'limite_ip'
  return 'ok'
}

export function sessaoValida(reg: { expira_em: string; revogada_em: string | null }, agora: number): boolean {
  return !reg.revogada_em && Date.parse(reg.expira_em) > agora
}

// --- Verificação: limites próprios (não consomem o limite de PEDIR código: o dono do telefone sempre
// pode usar o código que já recebeu) ---
export const LIMITE_VERIFICAR_TELEFONE_HORA = 20
export const LIMITE_VERIFICAR_IP_HORA = 40

export function decidirLimiteVerificar(e: { verificacoesTelefoneHora: number; verificacoesIpHora: number }): 'ok' | 'limite' {
  return e.verificacoesTelefoneHora >= LIMITE_VERIFICAR_TELEFONE_HORA || e.verificacoesIpHora >= LIMITE_VERIFICAR_IP_HORA
    ? 'limite'
    : 'ok'
}

/** O código simulado (devolvido na resposta, sem WhatsApp) só vale no STAGING: lista branca pelo ref. */
export const STAGING_REF = 'qzcqwovbbylqxljcrqhk'
export function codigoSimuladoPermitido(flag: string | undefined, supabaseUrl: string | undefined): boolean {
  return flag === '1' && String(supabaseUrl ?? '').includes(STAGING_REF)
}

/** `ultimo_uso_em` só é regravado 1x por hora (evita escrita a cada chamada). */
export function precisaAtualizarUso(ultimoUsoEm: string | null | undefined, agora: number): boolean {
  return !ultimoUsoEm || agora - Date.parse(ultimoUsoEm) >= 3600_000
}

export const MENSAGEM_CODIGO_INVALIDO = 'Código inválido ou expirado. Peça um novo.'
