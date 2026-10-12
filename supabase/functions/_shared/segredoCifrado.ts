// Criptografia em repouso dos tokens das lojas (FocusNFe e provedores de Pix). Plano:
// docs/superpowers/plans/2026-10-12-criptografar-tokens-em-repouso.md (opção A: AES-256-GCM na Edge Function,
// chave em secret FORA do banco). Sem imports de jsr:/Deno: o WebCrypto entra por parâmetro (default globalThis.crypto,
// igual em Deno e Node) para os testes EXECUTAREM este código.
//
// Formato guardado: `v<kid>.<iv base64url>.<cifrado+tag base64url>`. O AAD é `barracaId|campo`: um valor cifrado
// copiado para outra loja ou outro campo NÃO decifra.
//
// FAIL-SAFE DA LEITURA (fase 1 do plano): `lerSegredo` nunca derruba emissão/Pix por causa da cifra. Sem chave, chave
// errada ou valor corrompido ele usa o texto antigo se existir. Só devolve null quando não há de onde ler. NUNCA
// registra token, chave ou texto decifrado: só códigos.
//
// Secrets: TOKENS_CHAVE_V1..V9 (32 bytes em base64) e, opcional, TOKENS_CHAVE_ATUAL (ex.: "2"). Sem ATUAL vale a maior
// versão presente. Rotação = cadastrar V2, ATUAL=2, recifrar (backfill) e só depois aposentar a V1.

export type EnvMinimo = { get: (nome: string) => string | undefined }
export type ConfigCripto = {
  /** versão → chave de 32 bytes em base64 (valor bruto do secret). */
  chaves: Record<string, string>
  /** versão usada para cifrar, ou null se não há chave configurada. */
  atual: string | null
}
export type ContextoSegredo = { barracaId: string; campo: string }

export type CodigoErroSegredo =
  | 'sem_chave'
  | 'chave_invalida'
  | 'formato_invalido'
  | 'versao_desconhecida'
  | 'falha_decifrar'

export class ErroSegredo extends Error {
  codigo: CodigoErroSegredo
  constructor(codigo: CodigoErroSegredo) {
    super(codigo)
    this.codigo = codigo
  }
}

const VERSOES = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const TAMANHO_IV = 12

/** Lê os secrets de chave. Nada é validado aqui (chave malformada só falha quando usada). */
export function configDoEnv(env: EnvMinimo | undefined): ConfigCripto {
  const chaves: Record<string, string> = {}
  if (env) {
    for (const v of VERSOES) {
      const valor = env.get(`TOKENS_CHAVE_V${v}`)
      if (valor && valor.trim()) chaves[v] = valor.trim()
    }
  }
  const presentes = Object.keys(chaves)
  const pedida = env?.get('TOKENS_CHAVE_ATUAL')?.trim()
  const atual = pedida && chaves[pedida] ? pedida : presentes.length ? presentes[presentes.length - 1] : null
  return { chaves, atual }
}

function paraBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64(texto: string): Uint8Array {
  const limpo = texto.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(limpo + '='.repeat((4 - (limpo.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function importarChave(bruta: string, cripto: Crypto, uso: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  let bytes: Uint8Array
  try {
    bytes = deBase64(bruta)
  } catch {
    throw new ErroSegredo('chave_invalida')
  }
  if (bytes.length !== 32) throw new ErroSegredo('chave_invalida')
  return cripto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [uso])
}

const aad = (c: ContextoSegredo) => new TextEncoder().encode(`${c.barracaId}|${c.campo}`)

export async function cifrar(texto: string, contexto: ContextoSegredo, cfg: ConfigCripto, cripto: Crypto = globalThis.crypto): Promise<{ valor: string; kid: string }> {
  if (!cfg.atual || !cfg.chaves[cfg.atual]) throw new ErroSegredo('sem_chave')
  const chave = await importarChave(cfg.chaves[cfg.atual], cripto, 'encrypt')
  const iv = cripto.getRandomValues(new Uint8Array(TAMANHO_IV))
  const cifrado = new Uint8Array(
    await cripto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(contexto) }, chave, new TextEncoder().encode(texto)),
  )
  return { valor: `v${cfg.atual}.${paraBase64Url(iv)}.${paraBase64Url(cifrado)}`, kid: cfg.atual }
}

export async function decifrar(valor: string, contexto: ContextoSegredo, cfg: ConfigCripto, cripto: Crypto = globalThis.crypto): Promise<string> {
  const m = /^v(\d)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(valor)
  if (!m) throw new ErroSegredo('formato_invalido')
  const bruta = cfg.chaves[m[1]]
  if (!bruta) throw new ErroSegredo(Object.keys(cfg.chaves).length ? 'versao_desconhecida' : 'sem_chave')
  const chave = await importarChave(bruta, cripto, 'decrypt')
  try {
    const iv = deBase64(m[2])
    const claro = await cripto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(contexto) }, chave, deBase64(m[3]))
    return new TextDecoder().decode(claro)
  } catch {
    throw new ErroSegredo('falha_decifrar')
  }
}

export type LeituraSegredo = {
  valor: string | null
  origem: 'cifrado' | 'texto' | 'nenhum'
  /** Preenchido quando havia cifrado e ele NÃO pôde ser usado (mesmo que o texto tenha salvo a leitura). */
  erro?: CodigoErroSegredo
}

/**
 * "Cifrado, senão texto". Cifrado válido tem prioridade; qualquer problema com ele cai no texto se existir.
 * `aviso` recebe só o código e o nome do campo (default: console.warn), nunca valores.
 */
export async function lerSegredo(
  linha: { texto?: unknown; cifrado?: unknown },
  contexto: ContextoSegredo,
  cfg: ConfigCripto,
  opcoes: { cripto?: Crypto; aviso?: (codigo: CodigoErroSegredo, campo: string) => void } = {},
): Promise<LeituraSegredo> {
  const texto = typeof linha.texto === 'string' && linha.texto ? linha.texto : null
  const cifrado = typeof linha.cifrado === 'string' && linha.cifrado ? linha.cifrado : null
  if (!cifrado) return texto ? { valor: texto, origem: 'texto' } : { valor: null, origem: 'nenhum' }

  let erro: CodigoErroSegredo
  try {
    return { valor: await decifrar(cifrado, contexto, cfg, opcoes.cripto ?? globalThis.crypto), origem: 'cifrado' }
  } catch (e) {
    erro = e instanceof ErroSegredo ? e.codigo : 'falha_decifrar'
  }
  const aviso = opcoes.aviso ?? ((codigo, campo) => console.warn('segredo_cifrado_indisponivel', codigo, campo))
  aviso(erro, contexto.campo)
  return texto ? { valor: texto, origem: 'texto', erro } : { valor: null, origem: 'nenhum', erro }
}
