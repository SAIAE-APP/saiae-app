// Leitura e gravação da tela "Revisar cardápio de exemplo" (kits iniciais, PR 5). Usa as mesmas tabelas e RLS do
// cadastro de itens e de opções: não há RPC nova. Só mexe em itens marcados como `kit_exemplo`.
import { supabase } from './supabase'
import { MSG_SEM_INTERNET } from '../hooks/useSalvarBarraca'
import { centavosParaCampo, type LinhaItemRevisao, type LinhaOpcaoRevisao, type PlanoDeRevisao } from './revisarKit'

export type DadosDaRevisao = {
  itens: LinhaItemRevisao[]
  opcoes: LinhaOpcaoRevisao[]
  /** Grupos de variação que já têm opção ativa. */
  variacoesAtivas: Set<string>
}

type Falha = { ok: false; erro: string }
const semInternet = () => typeof navigator !== 'undefined' && navigator.onLine === false

export async function carregarRevisao(barracaId: string): Promise<{ ok: true; dados: DadosDaRevisao } | Falha> {
  if (semInternet()) return { ok: false, erro: MSG_SEM_INTERNET }
  try {
    const [it, cat, lig] = await Promise.all([
      supabase.from('itens').select('id, nome, preco_centavos, categoria_id, ordem').eq('barraca_id', barracaId).eq('kit_exemplo', true).eq('ativo', false).order('ordem'),
      supabase.from('categorias').select('id, nome, ordem').eq('barraca_id', barracaId).order('ordem'),
      supabase.from('itens_grupos').select('item_id, grupo_id, tipo').eq('barraca_id', barracaId),
    ])
    if (it.error || cat.error || lig.error) return { ok: false, erro: 'Não foi possível carregar o cardápio de exemplo. Tente de novo.' }
    const itensBrutos = (it.data ?? []) as { id: string; nome: string; preco_centavos: number; categoria_id: string | null }[]
    const categorias = new Map(((cat.data ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]))
    const ligacoes = (lig.data ?? []) as { item_id: string; grupo_id: string; tipo: string }[]

    const idsItens = new Set(itensBrutos.map((i) => i.id))
    const grupoIds = [...new Set(ligacoes.filter((l) => idsItens.has(l.item_id)).map((l) => l.grupo_id))]
    const opcoes: LinhaOpcaoRevisao[] = []
    const variacoesAtivas = new Set<string>()
    if (grupoIds.length > 0) {
      const [gr, op] = await Promise.all([
        supabase.from('grupos_opcoes').select('id, nome, tipo, ordem').in('id', grupoIds).order('ordem'),
        supabase.from('opcoes').select('id, grupo_id, nome, preco_centavos, ativo, ordem').in('grupo_id', grupoIds).order('ordem'),
      ])
      if (gr.error || op.error) return { ok: false, erro: 'Não foi possível carregar as opções do exemplo. Tente de novo.' }
      const grupos = new Map(((gr.data ?? []) as { id: string; nome: string; tipo: 'variacao' | 'adicional' }[]).map((g) => [g.id, g]))
      for (const o of (op.data ?? []) as { id: string; grupo_id: string; nome: string; preco_centavos: number; ativo: boolean }[]) {
        const g = grupos.get(o.grupo_id)
        if (!g) continue
        if (o.ativo) {
          if (g.tipo === 'variacao') variacoesAtivas.add(g.id)
          continue // só aparecem as opções inativas (as grátis já nascem ativas)
        }
        opcoes.push({ id: o.id, grupoId: g.id, grupoNome: g.nome, tipo: g.tipo, nome: o.nome, precoTexto: centavosParaCampo(o.preco_centavos), usar: false })
      }
    }

    const variacaoDoItem = new Map<string, string>()
    for (const l of ligacoes) if (l.tipo === 'variacao') variacaoDoItem.set(l.item_id, l.grupo_id)
    const itens: LinhaItemRevisao[] = itensBrutos.map((i) => ({
      id: i.id,
      nome: i.nome,
      categoria: (i.categoria_id && categorias.get(i.categoria_id)) || 'Sem categoria',
      precoTexto: centavosParaCampo(i.preco_centavos),
      usar: false,
      variacaoId: variacaoDoItem.get(i.id) ?? null,
    }))
    return { ok: true, dados: { itens, opcoes, variacoesAtivas } }
  } catch {
    return { ok: false, erro: semInternet() ? MSG_SEM_INTERNET : 'Não foi possível carregar o cardápio de exemplo. Tente de novo.' }
  }
}

/** Grava o plano (já validado). Primeiro as opções, depois os itens: o item só passa a valer com tudo no lugar. */
export async function salvarRevisao(barracaId: string, plano: PlanoDeRevisao): Promise<{ ok: true } | Falha> {
  if (semInternet()) return { ok: false, erro: MSG_SEM_INTERNET }
  try {
    for (const o of plano.opcoes) {
      const { error } = await supabase.from('opcoes').update({ preco_centavos: o.preco_centavos, ativo: true }).eq('id', o.id).eq('barraca_id', barracaId)
      if (error) return { ok: false, erro: 'Não foi possível salvar as opções. Tente de novo.' }
    }
    for (const i of plano.itens) {
      const { error } = await supabase
        .from('itens')
        .update({ nome: i.nome, preco_centavos: i.preco_centavos, ativo: true })
        .eq('id', i.id)
        .eq('barraca_id', barracaId)
        .eq('kit_exemplo', true)
      if (error) return { ok: false, erro: 'Não foi possível salvar os itens. Tente de novo.' }
    }
    return { ok: true }
  } catch {
    return { ok: false, erro: semInternet() ? MSG_SEM_INTERNET : 'Não foi possível salvar agora. Tente de novo.' }
  }
}
