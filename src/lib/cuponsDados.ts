// Acesso ao banco do painel de cupons (Ajustes). `cupons` tem RLS por barraca (dono/funcionário); os números de uso
// vêm só agregados por `cupons_resumo` (cupom_usos não é legível pelo painel); apagar passa por `cupom_apagar`.
import { supabase } from './supabase'
import type { Cupom, DadosCupom, ResumoCupom } from './cupons'

export type CuponsDaLoja = { cupons: Cupom[]; resumo: Map<string, ResumoCupom> }

const COLUNAS = 'id, codigo, tipo, valor, inicio_em, fim_em, limite_usos, uma_por_cliente, pedido_minimo_centavos, ativo'

/** Traduz o erro do banco em frase para o dono (o resto vai com a causa real). */
export function mensagemErroCupom(erro: { message?: string; code?: string } | null | undefined): string {
  const m = erro?.message ?? ''
  if (erro?.code === '23505' || /duplicate|unique/i.test(m)) return 'Já existe um cupom com esse código.'
  if (/cupom_com_uso/.test(m)) return 'Este cupom já foi usado e não pode ser apagado. Pause-o.'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return 'Sem internet. Não foi salvo.'
  return m ? `Não foi possível salvar: ${m}` : 'Não foi possível salvar. Tente novamente.'
}

export async function carregarCupons(barracaId: string): Promise<CuponsDaLoja> {
  const [c, r] = await Promise.all([
    supabase.from('cupons').select(COLUNAS).eq('barraca_id', barracaId).order('criado_em', { ascending: false }),
    supabase.rpc('cupons_resumo', { p_barraca_id: barracaId }),
  ])
  if (c.error) throw c.error
  if (r.error) throw r.error
  const resumo = new Map<string, ResumoCupom>()
  for (const linha of (r.data ?? []) as { cupom_id: string; usos_confirmados: number; desconto_total_centavos: number | string }[]) {
    resumo.set(linha.cupom_id, {
      cupom_id: linha.cupom_id,
      usos_confirmados: Number(linha.usos_confirmados),
      desconto_total_centavos: Number(linha.desconto_total_centavos),
    })
  }
  return { cupons: (c.data ?? []) as Cupom[], resumo }
}

/** Cria (id = null) ou atualiza. O RLS garante a barraca; erro de código repetido volta como frase. */
export async function salvarCupom(barracaId: string, id: string | null, dados: DadosCupom): Promise<void> {
  const { error } = id
    ? await supabase.from('cupons').update(dados).eq('id', id).eq('barraca_id', barracaId)
    : await supabase.from('cupons').insert({ ...dados, barraca_id: barracaId })
  if (error) throw new Error(mensagemErroCupom(error))
}

export async function definirAtivo(barracaId: string, id: string, ativo: boolean): Promise<void> {
  const { data, error } = await supabase.from('cupons').update({ ativo }).eq('id', id).eq('barraca_id', barracaId).select('id')
  if (error) throw new Error(mensagemErroCupom(error))
  if (!data || data.length === 0) throw new Error('Não foi possível salvar: sem permissão para alterar este cupom.')
}

export async function apagarCupom(id: string): Promise<void> {
  const { error } = await supabase.rpc('cupom_apagar', { p_cupom_id: id })
  if (error) throw new Error(mensagemErroCupom(error))
}
