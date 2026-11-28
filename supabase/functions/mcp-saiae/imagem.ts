// Download seguro de imagem para a ferramenta `definir_foto_item` (módulo puro, sem globais do Deno: o DNS e o fetch
// entram por parâmetro, então roda nos testes com `node --test`).
// Defesas, nesta ordem: só https na porta 443, sem usuário/senha na URL; o nome é resolvido por DNS e TODO endereço
// precisa ser público (loopback, rede privada, link-local, metadata em 169.254.169.254, CGNAT e multicast são
// recusados); redirect só até 3 vezes e cada destino é revalidado do zero; o corpo é lido em fluxo e cortado em 5 MB;
// o formato vem dos BYTES (jpg/png/webp), nunca do Content-Type; as dimensões são lidas do cabeçalho do arquivo.
// LIMITAÇÃO CONHECIDA: o `fetch` do Deno resolve o nome de novo por conta própria, então um DNS que muda entre a
// nossa consulta e a conexão (DNS rebinding) não é fechado aqui; o que reduz o risco é a rede de saída da plataforma e a
// checagem dos bytes (só imagem sai daqui). Não há redimensionamento: o limite de bytes e de dimensões é a defesa.

export const LIMITE_BYTES_IMAGEM = 5 * 1024 * 1024
export const LIMITE_LADO_IMAGEM = 8000
export const MAX_REDIRECTS = 3
const TEMPO_LIMITE_MS = 10_000

export type TipoImagem = 'jpg' | 'png' | 'webp'
export type ImagemBaixada = { bytes: Uint8Array; tipo: TipoImagem; mime: string; largura: number; altura: number }
export type ResultadoImagem = { ok: true; imagem: ImagemBaixada } | { ok: false; motivo: string }
export type DependenciasImagem = {
  fetchFn: (url: string, init: RequestInit) => Promise<Response>
  /** Devolve os endereços (IPv4 e IPv6) do nome; lança se não resolver. */
  resolverDns: (host: string) => Promise<string[]>
}

const MIME: Record<TipoImagem, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

function ipv4Publico(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false // link-local e metadata de nuvem
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function lerIpv4(texto: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(texto)
  if (!m) return null
  const p = m.slice(1).map(Number)
  return p.every((n) => n <= 255) ? (p as [number, number, number, number]) : null
}

/** Expande um IPv6 em 8 grupos de 16 bits (aceita "::" e IPv4 no final); null se não for IPv6 válido. */
function lerIpv6(texto: string): number[] | null {
  let t = texto.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!t.includes(':')) return null
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t)
  if (v4) {
    const o = lerIpv4(v4[1])
    if (!o) return null
    t = t.slice(0, t.length - v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const duplo = t.split('::')
  if (duplo.length > 2) return null
  const lado = (s: string) => (s === '' ? [] : s.split(':'))
  const esq = lado(duplo[0])
  const dir = duplo.length === 2 ? lado(duplo[1]) : []
  if (duplo.length === 1 && esq.length !== 8) return null
  if (duplo.length === 2 && esq.length + dir.length > 7) return null
  const grupos = [...esq, ...Array(duplo.length === 2 ? 8 - esq.length - dir.length : 0).fill('0'), ...dir]
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return grupos.map((g) => parseInt(g, 16))
}

/** true só para endereço IP público e roteável. Texto que não é IP válido devolve false (fecha por padrão). */
export function ipPublico(texto: string): boolean {
  const v4 = lerIpv4(texto)
  if (v4) return ipv4Publico(v4[0], v4[1], v4[2])
  const g = lerIpv6(texto)
  if (!g) return false
  // IPv4 embutido (::ffff:a.b.c.d, ::a.b.c.d e 64:ff9b::/96): vale a regra do IPv4.
  const semOito = g.slice(0, 5).every((x) => x === 0)
  if ((semOito && (g[5] === 0xffff || g[5] === 0)) || (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))) {
    return ipv4Publico(g[6] >> 8, g[6] & 255, g[7] >> 8)
  }
  // Só unicast global (2000::/3); fora disso fica o ::1, fc00::/7, fe80::/10, ff00::/8 e o resto.
  if ((g[0] & 0xe000) !== 0x2000) return false
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false // documentação e Teredo
  if (g[0] === 0x2002) return false // 6to4 embute IPv4 qualquer
  return true
}

export type UrlValida = { ok: true; url: URL } | { ok: false; motivo: string }

/** Confere só a URL (sem rede): https, porta 443, sem credenciais e nome plausível. IP literal passa pela mesma regra. */
export function validarUrlImagem(texto: unknown): UrlValida {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > 2000) return { ok: false, motivo: 'imagem_url inválida.' }
  let url: URL
  try {
    url = new URL(texto.trim())
  } catch {
    return { ok: false, motivo: 'imagem_url inválida.' }
  }
  if (url.protocol !== 'https:') return { ok: false, motivo: 'Só aceito endereço https.' }
  if (url.username || url.password) return { ok: false, motivo: 'O endereço não pode ter usuário e senha.' }
  if (url.port !== '' && url.port !== '443') return { ok: false, motivo: 'Só aceito a porta padrão do https.' }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, motivo: 'Endereço não permitido.' }
  }
  const ehIp = lerIpv4(host) !== null || host.includes(':')
  if (ehIp && !ipPublico(host)) return { ok: false, motivo: 'Endereço não permitido.' }
  // Nome sem ponto ("intranet") ou só numérico em formatos exóticos (0x7f.1, 2130706433) nunca é host público de imagem.
  if (!ehIp && (!host.includes('.') || /^[0-9.x]+$/i.test(host))) return { ok: false, motivo: 'Endereço não permitido.' }
  return { ok: true, url }
}

/** Identifica jpg/png/webp pelos bytes e lê as dimensões do cabeçalho; null se não for uma imagem aceita. */
export function detectarImagem(b: Uint8Array): { tipo: TipoImagem; largura: number; altura: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1]
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const le24 = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
  const ascii = (i: number, t: string) => t.split('').every((c, k) => b[i + k] === c.charCodeAt(0))

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(12, 'IHDR')) {
    return { tipo: 'png', largura: u32(16), altura: u32(20) }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marcador = b[i + 1]
      if (marcador === 0xff) { i++; continue }
      if (marcador === 0xd8 || (marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) { i += 2; continue }
      const tam = u16(i + 2)
      if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
        return { tipo: 'jpg', altura: u16(i + 5), largura: u16(i + 7) }
      }
      if (tam < 2) return null
      i += 2 + tam
    }
    return null
  }
  if (b.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    if (ascii(12, 'VP8X')) return { tipo: 'webp', largura: le24(24) + 1, altura: le24(27) + 1 }
    if (ascii(12, 'VP8L') && b[20] === 0x2f) {
      const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return { tipo: 'webp', largura: (v & 0x3fff) + 1, altura: ((v >>> 14) & 0x3fff) + 1 }
    }
    if (ascii(12, 'VP8 ') && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { tipo: 'webp', largura: (b[26] | (b[27] << 8)) & 0x3fff, altura: (b[28] | (b[29] << 8)) & 0x3fff }
    }
  }
  return null
}

async function lerCorpoLimitado(resp: Response, limite: number): Promise<Uint8Array | null> {
  const declarado = Number(resp.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > limite) return null
  if (!resp.body) return null
  const leitor = resp.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    total += value.byteLength
    if (total > limite) {
      await leitor.cancel().catch(() => {})
      return null
    }
    partes.push(value)
  }
  const saida = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    saida.set(p, pos)
    pos += p.byteLength
  }
  return saida
}

/** Baixa e confere a imagem. Nunca lança: qualquer falha vira `{ ok: false, motivo }` em português. */
export async function baixarImagemSegura(entrada: unknown, deps: DependenciasImagem): Promise<ResultadoImagem> {
  try {
    let atual = validarUrlImagem(entrada)
    for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
      if (!atual.ok) return { ok: false, motivo: atual.motivo }
      const url = atual.url
      const host = url.hostname.replace(/^\[|\]$/g, '')
      // IP literal já foi conferido em validarUrlImagem; nome precisa resolver e TODOS os endereços têm de ser públicos.
      if (lerIpv4(host) === null && !host.includes(':')) {
        let ips: string[]
        try {
          ips = await deps.resolverDns(host)
        } catch {
          return { ok: false, motivo: 'Não consegui resolver o endereço da imagem.' }
        }
        if (ips.length === 0 || !ips.every(ipPublico)) return { ok: false, motivo: 'Endereço não permitido.' }
      }
      const resp = await deps.fetchFn(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'saiae-mcp/1' },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
      if (resp.status >= 300 && resp.status < 400) {
        await resp.body?.cancel().catch(() => {})
        const destino = resp.headers.get('location')
        if (!destino) return { ok: false, motivo: 'Redirecionamento inválido.' }
        if (salto === MAX_REDIRECTS) return { ok: false, motivo: 'Redirecionamentos demais.' }
        let proximo: string
        try {
          proximo = new URL(destino, url).toString()
        } catch {
          return { ok: false, motivo: 'Redirecionamento inválido.' }
        }
        atual = validarUrlImagem(proximo)
        continue
      }
      if (!resp.ok) {
        await resp.body?.cancel().catch(() => {})
        return { ok: false, motivo: `O endereço da imagem respondeu ${resp.status}.` }
      }
      const bytes = await lerCorpoLimitado(resp, LIMITE_BYTES_IMAGEM)
      if (!bytes) return { ok: false, motivo: 'A imagem passa do limite de 5 MB.' }
      const info = detectarImagem(bytes)
      if (!info) return { ok: false, motivo: 'O arquivo não é uma imagem JPG, PNG ou WebP.' }
      if (info.largura < 1 || info.altura < 1 || info.largura > LIMITE_LADO_IMAGEM || info.altura > LIMITE_LADO_IMAGEM) {
        return { ok: false, motivo: `A imagem tem dimensões inválidas (máximo ${LIMITE_LADO_IMAGEM} px de lado).` }
      }
      return { ok: true, imagem: { bytes, tipo: info.tipo, mime: MIME[info.tipo], largura: info.largura, altura: info.altura } }
    }
    return { ok: false, motivo: 'Redirecionamentos demais.' }
  } catch {
    return { ok: false, motivo: 'Não consegui baixar a imagem.' }
  }
}
