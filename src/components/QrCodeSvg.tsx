import { useMemo } from 'react'
import { faixasEscuras, matrizQr } from '../lib/qr'

const MARGEM = 4 // módulos de "zona silenciosa" exigidos pela leitura

/** QR code em SVG (sem HTML injetado). Preto sobre branco de propósito, mesmo no tema escuro: leitor de QR precisa do
 * contraste fixo, então esta é a única exceção à regra de "sem cor escrita no componente". Se o texto não puder ser
 * codificado, não desenha nada (nunca um QR em branco ou cortado). */
export function QrCodeSvg({ texto, tamanho = 192, rotulo }: { texto: string; tamanho?: number; rotulo: string }) {
  const desenho = useMemo(() => {
    try {
      const m = matrizQr(texto)
      return { n: m.length, faixas: faixasEscuras(m) }
    } catch {
      return null
    }
  }, [texto])

  if (!desenho) return null
  const lado = desenho.n + MARGEM * 2
  return (
    <svg
      role="img"
      aria-label={rotulo}
      viewBox={`0 0 ${lado} ${lado}`}
      width={tamanho}
      height={tamanho}
      shapeRendering="crispEdges"
      className="max-w-full rounded-mesa-md"
    >
      <rect width={lado} height={lado} fill="#fff" />
      {desenho.faixas.map((f) => (
        <rect key={`${f.x}-${f.y}`} x={f.x + MARGEM} y={f.y + MARGEM} width={f.w} height={1} fill="#000" />
      ))}
    </svg>
  )
}
