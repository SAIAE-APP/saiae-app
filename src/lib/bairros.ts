import { supabase } from './supabase'
import { reaisParaCentavos } from './preco'
import type { Barraca, PoliticaBairroNaoListado, TaxaEntregaBairro } from '../types/database'

/** Espelha `public.normalizar_bairro` (SQL): minúsculo, sem acento, espaços colapsados. */
export function normalizarBairro(bairro: string): string {
  return bairro
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
}

export type ConfigBairros = {
  /** Política pra bairro fora da lista. */
  naoListado: PoliticaBairroNaoListado
  taxaPadraoCentavos: number
  taxaHabilitada: boolean
}

export type BairroTaxa = { bairro: string; valorCentavos: number; ativo?: boolean }

export type TaxaDoBairro = {
  permitido: boolean
  taxaCentavos: number
  origem: 'bairro' | 'padrao' | 'bloqueado' | 'sem_taxa'
}

/** Mesma regra de `public.taxa_entrega_do_bairro` (SQL), pra preview no front.
 * O servidor SEMPRE recalcula; isto nunca é fonte de verdade de cobrança. */
export function taxaDoBairro(config: ConfigBairros, bairros: BairroTaxa[], bairro: string): TaxaDoBairro {
  const chave = normalizarBairro(bairro)
  const achado = chave
    ? bairros.find((b) => b.ativo !== false && normalizarBairro(b.bairro) === chave)
    : undefined
  if (achado) return { permitido: true, taxaCentavos: achado.valorCentavos, origem: 'bairro' }
  if (config.naoListado === 'bloquear') return { permitido: false, taxaCentavos: 0, origem: 'bloqueado' }
  if (config.taxaHabilitada) return { permitido: true, taxaCentavos: config.taxaPadraoCentavos, origem: 'padrao' }
  return { permitido: true, taxaCentavos: 0, origem: 'sem_taxa' }
}

export function configBairrosDaBarraca(
  barraca: Pick<Barraca, 'entrega_bairro_nao_listado' | 'taxa_entrega_habilitada' | 'taxa_entrega_centavos'> | null,
): ConfigBairros {
  return {
    naoListado: barraca?.entrega_bairro_nao_listado === 'bloquear' ? 'bloquear' : 'taxa_padrao',
    taxaPadraoCentavos: Math.max(0, barraca?.taxa_entrega_centavos ?? 0),
    taxaHabilitada: barraca?.taxa_entrega_habilitada ?? false,
  }
}

export function bairrosDaTabela(linhas: TaxaEntregaBairro[]): BairroTaxa[] {
  return linhas.map((l) => ({ bairro: l.bairro, valorCentavos: l.valor_centavos, ativo: l.ativo }))
}

export type LinhaInvalida = { numero: number; texto: string; motivo: string }
export type ResultadoListaColada = { validos: { bairro: string; valorCentavos: number }[]; invalidas: LinhaInvalida[] }

const VALOR_VALIDO = /^\d{1,6}([.,]\d{1,2})?$/

/**
 * Lê a lista colada: uma por linha, `Bairro; 5,00` ou `Bairro;5.00`. Ignora
 * linhas vazias, devolve as inválidas com o motivo e, se o mesmo bairro
 * aparece de novo, vale a última linha.
 */
export function parsearListaBairros(texto: string): ResultadoListaColada {
  const porChave = new Map<string, { bairro: string; valorCentavos: number }>()
  const invalidas: LinhaInvalida[] = []

  texto.split(/\r?\n/).forEach((bruta, indice) => {
    const linha = bruta.trim()
    if (!linha) return
    const numero = indice + 1
    const partes = linha.split(';')
    if (partes.length !== 2) {
      invalidas.push({ numero, texto: linha, motivo: 'use "Bairro; valor"' })
      return
    }
    const bairro = partes[0].trim().replace(/\s+/g, ' ')
    const valor = partes[1].trim().replace(/^R\$\s*/i, '')
    if (!bairro) {
      invalidas.push({ numero, texto: linha, motivo: 'bairro vazio' })
      return
    }
    if (bairro.length > 80) {
      invalidas.push({ numero, texto: linha, motivo: 'nome muito longo' })
      return
    }
    if (!VALOR_VALIDO.test(valor)) {
      invalidas.push({ numero, texto: linha, motivo: 'valor inválido' })
      return
    }
    porChave.set(normalizarBairro(bairro), { bairro, valorCentavos: reaisParaCentavos(valor) })
  })

  return { validos: [...porChave.values()], invalidas }
}

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

export type BairrosPublicos = { config: ConfigBairros; bairros: BairroTaxa[] }

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
