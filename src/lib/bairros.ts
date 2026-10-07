import { supabase } from './supabase'
import type { TaxaEntregaBairro } from '../types/database'
import type { BairrosPublicos } from './bairrosTaxa'

// Regras puras (normalização, taxa, parser da lista colada) moram em bairrosTaxa.ts, que
// não depende do Supabase e roda nos testes (npm test); aqui só o acesso ao banco.
export * from './bairrosTaxa'

/** Bairros da barraca (Ajustes, app do operador). */
export async function listarTaxasBairro(barracaId: string): Promise<TaxaEntregaBairro[]> {
  const { data, error } = await supabase
    .from('taxas_entrega_bairro')
    .select('id, barraca_id, bairro, bairro_normalizado, valor_centavos, ativo, criado_em')
    .eq('barraca_id', barracaId)
    .order('bairro_normalizado')
  if (error) throw error
  return (data ?? []) as TaxaEntregaBairro[]
}

/** Cria ou atualiza (por barraca + bairro normalizado) vários bairros de uma vez. */
export async function salvarTaxasBairro(
  barracaId: string,
  itens: { bairro: string; valorCentavos: number }[],
): Promise<void> {
  if (itens.length === 0) return
  const { error } = await supabase.from('taxas_entrega_bairro').upsert(
    itens.map((i) => ({
      barraca_id: barracaId,
      bairro: i.bairro,
      valor_centavos: i.valorCentavos,
      ativo: true,
    })),
    { onConflict: 'barraca_id,bairro_normalizado' },
  )
  if (error) throw error
}

export async function atualizarTaxaBairro(
  barracaId: string,
  id: string,
  campos: { valor_centavos?: number; ativo?: boolean },
): Promise<void> {
  const { error } = await supabase.from('taxas_entrega_bairro').update(campos).eq('id', id).eq('barraca_id', barracaId)
  if (error) throw error
}

export async function removerTaxaBairro(barracaId: string, id: string): Promise<void> {
  const { error } = await supabase.from('taxas_entrega_bairro').delete().eq('id', id).eq('barraca_id', barracaId)
  if (error) throw error
}

/** Lista pública do cardápio (RPC `bairros_entrega_publicos`). */
export async function buscarBairrosPublicos(slug: string): Promise<BairrosPublicos> {
  const { data, error } = await supabase.rpc('bairros_entrega_publicos', { p_slug: slug })
  if (error) throw error
  const linhas = (data ?? []) as {
    bairro: string | null
    valor_centavos: number | null
    nao_listado: string
    taxa_padrao_centavos: number
    taxa_habilitada: boolean
  }[]
  const primeira = linhas[0]
  return {
    config: {
      naoListado: primeira?.nao_listado === 'bloquear' ? 'bloquear' : 'taxa_padrao',
      taxaPadraoCentavos: primeira?.taxa_padrao_centavos ?? 0,
      taxaHabilitada: primeira?.taxa_habilitada ?? false,
    },
    bairros: linhas
      .filter((l) => l.bairro !== null)
      .map((l) => ({ bairro: l.bairro as string, valorCentavos: l.valor_centavos ?? 0 })),
  }
}
