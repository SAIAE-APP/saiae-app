// Garante o QR code no DANFCe (HTML da FocusNFe) baixado: a página aberta como arquivo local pode perder o QR que a
// FocusNFe monta por script. Função pura, sem DOM. O QR é um SVG inline (sem script nem imagem externa).
import { faixasEscuras, matrizQr } from './qr.ts'

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Extrai o conteúdo de <qrCode> do XML da NFC-e (aceita CDATA). Devolve null se não houver. */
export function qrDoXml(xml: string | null | undefined): string | null {
  const m = xml?.match(/<qrCode>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/qrCode>/i)
  const valor = (m?.[1] ?? m?.[2] ?? '').trim()
  return valor || null
}

/** SVG do QR (módulos agrupados em faixas), com borda de 4 módulos. Lança se o texto for inválido para QR. */
export function qrSvg(texto: string): string {
  const matriz = matrizQr(texto)
  const n = matriz.length
  const total = n + 8
  const faixas = faixasEscuras(matriz)
    .map((f) => `<rect x="${f.x + 4}" y="${f.y + 4}" width="${f.w}" height="1"/>`)
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="200" height="200" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code da NFC-e"><rect width="${total}" height="${total}" fill="#fff"/>` +
    `<g fill="#000">${faixas}</g></svg>`
  )
}

/** Acrescenta ao DANFCe um bloco com o QR e "Consulte pela Chave de Acesso" antes de </body>, salvo se o HTML já
 * tiver um QR em <img>/<svg>/<canvas>. Sem QR utilizável, devolve o HTML intacto. */
export function garantirQrNoDanfce(html: string, qrUrl: string | null | undefined, xml?: string | null): string {
  if (/<(img|svg|canvas)\b[^>]*(qr|data:image)/i.test(html)) return html
  // DANFCe da FocusNFe: o QR nasce por script (qrcode.min.js) dentro de <div id='qr-code0'>.
  if (/id\s*=\s*['"]qr-code\d*['"]|qrcode\.min\.js/i.test(html)) return html
  const url = (qrUrl ?? '').trim() || qrDoXml(xml)
  if (!url) return html
  let svg: string
  try {
    svg = qrSvg(url)
  } catch {
    return html // shortcut: URL longa demais para o QR (400 caracteres), a nota segue sem o bloco extra
  }
  const bloco =
    `<div style="text-align:center;margin:16px auto;font-family:sans-serif;font-size:12px">` +
    `<div>${svg}</div><p>Consulte pela Chave de Acesso</p>` +
    `<p style="word-break:break-all"><a href="${escaparHtml(url)}">${escaparHtml(url)}</a></p></div>`
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${bloco}</body>`) : html + bloco
}
