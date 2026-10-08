// QR code do link da loja (Atendente IA). Usa a biblioteca `qrcode-generator` (MIT, versão fixa) só para gerar a
// matriz de módulos; o desenho é feito em SVG pelo componente, sem HTML injetado. Importa só a biblioteca, então é
// testável no Node.
import qrcode from 'qrcode-generator'

export const MAX_TEXTO_QR = 400

/** Matriz quadrada de módulos (true = escuro) para o texto, com correção de erro M. Lança se o texto for vazio ou
 * grande demais, para a tela nunca mostrar um QR cortado ou em branco. */
export function matrizQr(texto: string): boolean[][] {
  if (!texto || texto.length > MAX_TEXTO_QR) throw new Error('texto inválido para QR')
  const qr = qrcode(0, 'M') // versão 0 = automática (menor que couber)
  qr.addData(texto, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const matriz: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const linha: boolean[] = []
    for (let c = 0; c < n; c++) linha.push(qr.isDark(r, c))
    matriz.push(linha)
  }
  return matriz
}

/** Os módulos escuros agrupados em faixas horizontais ({x, y, w}) para desenhar poucos retângulos. */
export function faixasEscuras(matriz: boolean[][]): { x: number; y: number; w: number }[] {
  const faixas: { x: number; y: number; w: number }[] = []
  matriz.forEach((linha, y) => {
    let inicio = -1
    for (let x = 0; x <= linha.length; x++) {
      const escuro = x < linha.length && linha[x]
      if (escuro && inicio < 0) inicio = x
      if (!escuro && inicio >= 0) {
        faixas.push({ x: inicio, y, w: x - inicio })
        inicio = -1
      }
    }
  })
  return faixas
}
