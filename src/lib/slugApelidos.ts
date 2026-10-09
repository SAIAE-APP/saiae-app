// Endereço do cardápio (slug) com apelidos (H7, spec 2026-10-19-slug-cardapio-apelidos-design.md): link, QR ou atalho
// com o endereço ANTIGO continuam funcionando; a tela descobre o slug atual (`barraca_slug_atual`) e redireciona.
// PURO, testado em tests/slugApelidosFront.test.ts.

/** Troca o PRIMEIRO segmento do caminho (`/antigo/cardapio?x=1#y` → `/novo/cardapio?x=1#y`). Só troca se o primeiro
 * segmento for exatamente o slug antigo; senão devolve o caminho como veio. */
export function trocarSlugNoCaminho(caminho: string, slugAntigo: string, slugNovo: string): string {
  const m = /^\/([^/?#]+)(.*)$/s.exec(caminho)
  if (!m || m[1] !== slugAntigo) return caminho
  return `/${slugNovo}${m[2]}`
}

/** O que fazer com a resposta de `barraca_slug_atual`: redirecionar só quando existe um slug DIFERENTE do pedido. */
export function slugParaRedirecionar(slugPedido: string, resposta: unknown): string | null {
  if (typeof resposta !== 'string' || resposta === '' || resposta === slugPedido) return null
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(resposta) ? resposta : null
}
