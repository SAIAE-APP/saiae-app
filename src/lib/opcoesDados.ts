// Acesso ao banco do cadastro de grupos e opções (Ajustes). As tabelas têm RLS por barraca
// (usuario_tem_acesso_barraca); aqui só se lê e escreve com a sessão do dono/funcionário logado.
// Não há transação entre as tabelas: a criação desfaz o que já gravou se uma etapa falhar, e a
// edição é idempotente (salvar de novo conserta uma falha no meio).
import { supabase } from './supabase'
import {
  limitesDoGrupo,
  diffLigacoes,
  precoCentavosDaOpcao,
  type GrupoCadastro,
  type LigacaoCadastro,
  type OpcaoCadastro,
  type RascunhoGrupo,
} from './opcoesCadastro'

export type ItemParaLigar = { id: string; nome: string; ativo: boolean }

export type CadastroDeOpcoes = {
  grupos: GrupoCadastro[]
  opcoes: OpcaoCadastro[]
  ligacoes: LigacaoCadastro[]
  itens: ItemParaLigar[]
}

/** Traduz constraint do banco em frase para o dono (o resto vai com a causa real). */
export function mensagemDeErroOpcoes(erro: { message?: string } | null | undefined): string {
  const m = erro?.message ?? ''
  if (/itens_grupos_uma_variacao/.test(m)) return 'Um item só pode ter uma variação. Tire a variação anterior do item antes.'
  if (/grupos_opcoes_variacao_um_a_um/.test(m)) return 'Variação é sempre de escolha única e obrigatória.'
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(m)) return 'Sem internet. Não foi salvo.'
  return m ? `Não foi possível salvar: ${m}` : 'Não foi possível salvar. Tente novamente.'
}

function falhar(erro: { message?: string } | null): never {
  throw new Error(mensagemDeErroOpcoes(erro))
}

export async function carregarCadastro(barracaId: string): Promise<CadastroDeOpcoes> {
  const [g, o, l, i] = await Promise.all([
    supabase.from('grupos_opcoes').select('id, nome, tipo, min_escolhas, max_escolhas, ordem, ativo').eq('barraca_id', barracaId).order('ordem').order('criado_em'),
    supabase.from('opcoes').select('id, grupo_id, nome, preco_centavos, ordem, ativo, esgotado').eq('barraca_id', barracaId).order('ordem'),
    supabase.from('itens_grupos').select('item_id, grupo_id, ordem').eq('barraca_id', barracaId),
    supabase.from('itens').select('id, nome, ativo').eq('barraca_id', barracaId).order('ordem'),
  ])
  const erro = g.error ?? o.error ?? l.error ?? i.error
  if (erro) throw new Error(erro.message)
  return {
    grupos: (g.data ?? []) as GrupoCadastro[],
    opcoes: (o.data ?? []) as OpcaoCadastro[],
    ligacoes: (l.data ?? []) as LigacaoCadastro[],
    itens: (i.data ?? []) as ItemParaLigar[],
  }
}

function linhasDeOpcoes(grupoId: string, barracaId: string, r: RascunhoGrupo) {
  return r.opcoes.map((o, ordem) => ({
    ...(o.id ? { id: o.id } : {}),
    grupo_id: grupoId,
    barraca_id: barracaId,
    nome: o.nome.trim(),
    preco_centavos: precoCentavosDaOpcao(o),
    ordem,
    ativo: o.ativo,
    esgotado: o.esgotado,
  }))
}

/** Variação aparece antes dos adicionais no item. */
const ordemDaLigacao = (r: RascunhoGrupo) => (r.tipo === 'variacao' ? 0 : 1)

/** Cria (grupoId = null) ou atualiza um grupo com as opções e os itens ligados. O rascunho deve ter
 * passado em `validarRascunho`. `ligacoesAtuais` são os itens hoje ligados ao grupo. */
export async function salvarGrupo(
  barracaId: string,
  grupoId: string | null,
  r: RascunhoGrupo,
  opts: { ordemNova: number; ligacoesAtuais: string[] },
): Promise<void> {
  const { min, max } = limitesDoGrupo(r)

  if (grupoId === null) {
    const { data, error } = await supabase
      .from('grupos_opcoes')
      .insert({ barraca_id: barracaId, nome: r.nome.trim(), tipo: r.tipo, min_escolhas: min, max_escolhas: max, ordem: opts.ordemNova, ativo: r.ativo })
      .select('id')
      .single()
    if (error || !data) falhar(error)
    const novoId = (data as { id: string }).id
    try {
      const o = await supabase.from('opcoes').insert(linhasDeOpcoes(novoId, barracaId, r))
      if (o.error) falhar(o.error)
      if (r.itemIds.length > 0) {
        const l = await supabase
          .from('itens_grupos')
          .insert(r.itemIds.map((item_id) => ({ item_id, grupo_id: novoId, barraca_id: barracaId, ordem: ordemDaLigacao(r) })))
        if (l.error) falhar(l.error)
      }
    } catch (e) {
      // Desfaz o grupo meio criado (apaga em cascata opções e ligações).
      await supabase.from('grupos_opcoes').delete().eq('id', novoId)
      throw e
    }
    return
  }

  // tipo é imutável no banco: não vai no update.
  const g = await supabase
    .from('grupos_opcoes')
    .update({ nome: r.nome.trim(), min_escolhas: min, max_escolhas: max, ativo: r.ativo })
    .eq('id', grupoId)
    .eq('barraca_id', barracaId)
    .select('id')
  if (g.error) falhar(g.error)
  if (!g.data || g.data.length === 0) falhar({ message: 'sem permissão para alterar este grupo.' })

  const linhas = linhasDeOpcoes(grupoId, barracaId, r)
  const existentes = linhas.filter((l) => 'id' in l)
  const novas = linhas.filter((l) => !('id' in l))
  if (existentes.length > 0) {
    const u = await supabase.from('opcoes').upsert(existentes, { onConflict: 'id' })
    if (u.error) falhar(u.error)
  }
  if (novas.length > 0) {
    const n = await supabase.from('opcoes').insert(novas)
    if (n.error) falhar(n.error)
  }

  const { inserir, remover } = diffLigacoes(opts.ligacoesAtuais, r.itemIds)
  if (remover.length > 0) {
    const d = await supabase.from('itens_grupos').delete().eq('grupo_id', grupoId).in('item_id', remover)
    if (d.error) falhar(d.error)
  }
  if (inserir.length > 0) {
    const i = await supabase
      .from('itens_grupos')
      .insert(inserir.map((item_id) => ({ item_id, grupo_id: grupoId, barraca_id: barracaId, ordem: ordemDaLigacao(r) })))
    if (i.error) falhar(i.error)
  }
}

/** Apaga o grupo (opções e ligações vão junto, em cascata). Pedidos antigos não mudam: guardam snapshot. */
export async function apagarGrupo(barracaId: string, grupoId: string): Promise<void> {
  const { error } = await supabase.from('grupos_opcoes').delete().eq('id', grupoId).eq('barraca_id', barracaId)
  if (error) falhar(error)
}
