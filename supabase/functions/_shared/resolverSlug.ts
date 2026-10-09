// Endereço do cardápio (slug) com apelidos (H7): uma barraca pode ter mudado de endereço, e o app/QR/aba antiga ainda manda
// o slug ANTIGO. Estas funções acham a loja pelo slug atual e, se não houver, pelo apelido (`barraca_slug_atual`).
// Sem a função no banco (migration ainda não aplicada) ou com erro: devolve null, como antes. Testado em
// tests/resolverSlug.test.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/** Slug a procurar DEPOIS de a busca direta não achar nada: o atual do apelido, ou null (nada a fazer). */
export function slugDoApelido(slugPedido: string, resposta: unknown): string | null {
  if (typeof resposta !== 'string' || resposta === '' || resposta === slugPedido) return null
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(resposta) ? resposta : null
}

/** A loja pelo slug atual ou, se não existir, pelo apelido. `colunas` como em `.select()`. */
export async function buscarBarracaPorSlug<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  slug: string,
  colunas: string,
): Promise<T | null> {
  const direta = await supabase.from('barracas').select(colunas).eq('slug', slug).maybeSingle()
  if (direta.data) return direta.data as unknown as T
  const { data, error } = await supabase.rpc('barraca_slug_atual', { p_slug: slug })
  const atual = error ? null : slugDoApelido(slug, data)
  if (!atual) return null
  const viaApelido = await supabase.from('barracas').select(colunas).eq('slug', atual).maybeSingle()
  return (viaApelido.data as unknown as T | null) ?? null
}
