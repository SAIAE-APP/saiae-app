import { supabase } from './supabase'

const BUCKET = 'cardapio-fotos'
const LARGURA_MAXIMA = 1200
const QUALIDADE_JPEG = 0.82

/** Imagem de capa (hero, atrás do logo/nome no Cardápio Digital) — mesmo
 * bucket público `cardapio-fotos` dos banners/fotos de item, mesma
 * largura de banner (bem mais larga que o logo, que é só avatar). */
async function redimensionar(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, LARGURA_MAXIMA / bitmap.width)
  const largura = Math.round(bitmap.width * escala)
  const altura = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas não suportado')
  ctx.drawImage(bitmap, 0, 0, largura, altura)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar imagem'))),
      'image/jpeg',
      QUALIDADE_JPEG,
    )
  })
}

function caminhoDoUrl(url: string): string | null {
  const marcador = `/object/public/${BUCKET}/`
  const indice = url.indexOf(marcador)
  return indice === -1 ? null : url.slice(indice + marcador.length)
}

export async function enviarCapaBarraca(barracaId: string, arquivo: File): Promise<string> {
  const blob = await redimensionar(arquivo)
  const caminho = `${barracaId}/capa-${Date.now()}.jpg`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, blob, { contentType: 'image/jpeg', upsert: false })

  if (error) throw error

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(caminho)

  return publicUrl
}

/** Best-effort, mesmo espírito de apagarLogoBarraca/apagarImagemBanner. */
export async function apagarCapaBarraca(url: string): Promise<void> {
  const caminho = caminhoDoUrl(url)
  if (!caminho) return
  await supabase.storage.from(BUCKET).remove([caminho]).catch(() => {})
}
