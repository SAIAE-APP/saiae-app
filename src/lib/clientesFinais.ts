import { supabase } from './supabase'
import { normalizarTelefone, type DadosEntrega } from './entrega'
import type { ClienteFinal } from '../types/database'
import { emLotes, type ClienteImportado } from './importarClientes'
import { bancoSemRecurso } from './semMigration'
import { camposDeEndereco } from './enderecoCliente'
import { nomeCasa, planoDeBusca } from './clientesBusca'

const COLUNAS_BASE = 'id, barraca_id, nome, telefone, rua, numero, bairro, referencia, criado_em, atualizado_em'
const COLUNAS_PERFIL = `${COLUNAS_BASE}, telefone_confirmado_em, consentimento_marketing_em`
let bancoComPerfil = true

/** Roda a consulta com as colunas do perfil; banco sem a migration (coluna inexistente) cai nas antigas. */
async function comColunas<T>(consulta: (colunas: string) => PromiseLike<{ data: T | null; error: unknown }>): Promise<{ data: T | null; error: unknown }> {
  if (bancoComPerfil) {
    const r = await consulta(COLUNAS_PERFIL)
    if (!r.error || !bancoSemRecurso(r.error)) return r
    bancoComPerfil = false
  }
  return consulta(COLUNAS_BASE)
}
const LIMITE_BUSCA = 5
/** O padrão de nome é largo (acento vira curinga): busca mais linhas e corta com `nomeCasa`. */
const FOLGA_BUSCA_NOME = 6

/**
 * Busca clientes da barraca por telefone (só dígitos, parcial) ou nome (parcial, sem caixa e sem acento, palavras na
 * mesma ordem). Sempre filtra por barraca_id além da RLS. As regras vivem em `clientesBusca.ts`.
 */
export async function buscarClientesFinais(
  barracaId: string,
  termo: string,
  limite = LIMITE_BUSCA,
): Promise<ClienteFinal[]> {
  const plano = planoDeBusca(termo)
  if (plano.tipo === 'vazio') return []

  const { data, error } = await comColunas((colunas) => {
    let consulta = supabase.from('clientes_finais').select(colunas).eq('barraca_id', barracaId)
    if (plano.tipo === 'telefone') {
      // Só dígitos entram no filtro, nada a escapar.
      consulta =
        plano.padroes.length > 1
          ? consulta.or(plano.padroes.map((p) => `telefone.like.${p}`).join(','))
          : consulta.like('telefone', plano.padroes[0])
      return consulta.order('nome').limit(limite)
    }
    return consulta.ilike('nome', plano.padrao).order('nome').limit(limite * FOLGA_BUSCA_NOME)
  })
  if (error) throw error
  const linhas = (data ?? []) as unknown as ClienteFinal[]
  if (plano.tipo === 'nome') {
    const palavras = plano.palavras
    return linhas.filter((c) => nomeCasa(c.nome, palavras)).slice(0, limite)
  }
  return linhas
}

const LIMITE_LISTA = 20

/** Lista pra tela de gestão (Ajustes): sem termo, os últimos atualizados;
 * com termo, a mesma busca de telefone/nome do pedido, só que mais longa. */
export async function listarClientesFinais(barracaId: string, termo: string): Promise<ClienteFinal[]> {
  if (termo.trim()) return buscarClientesFinais(barracaId, termo, LIMITE_LISTA)
  const { data, error } = await comColunas((colunas) =>
    supabase
      .from('clientes_finais')
      .select(colunas)
      .eq('barraca_id', barracaId)
      .order('atualizado_em', { ascending: false })
      .limit(LIMITE_LISTA),
  )
  if (error) throw error
  return (data ?? []) as unknown as ClienteFinal[]
}

/** Cadastra ou atualiza (por barraca + telefone) o cliente de um pedido de entrega. */
export async function salvarClienteFinal(barracaId: string, dados: DadosEntrega): Promise<ClienteFinal> {
  const { data, error } = await supabase
    .from('clientes_finais')
    .upsert(
      {
        barraca_id: barracaId,
        nome: dados.nome.trim(),
        telefone: normalizarTelefone(dados.telefone),
        rua: dados.rua.trim(),
        numero: dados.numero.trim(),
        bairro: dados.bairro.trim(),
        referencia: dados.referencia?.trim() || null,
      },
      { onConflict: 'barraca_id,telefone' },
    )
    .select(COLUNAS_BASE)
    .single()
  if (error) throw error
  return data as ClienteFinal
}

/** LGPD: apaga o cadastro. Pedidos já feitos mantêm o snapshot da entrega. */
export async function excluirClienteFinal(barracaId: string, clienteId: string): Promise<void> {
  const { error } = await supabase
    .from('clientes_finais')
    .delete()
    .eq('id', clienteId)
    .eq('barraca_id', barracaId)
  if (error) throw error
}

export function clienteParaDadosEntrega(c: ClienteFinal): DadosEntrega {
  return {
    nome: c.nome,
    telefone: c.telefone,
    ...camposDeEndereco(c),
  }
}

/** Telefones já cadastrados na barraca (normalizados), pra prévia da importação. */
export async function listarTelefonesDaBarraca(barracaId: string): Promise<Set<string>> {
  const PAGINA = 1000
  const telefones = new Set<string>()
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('clientes_finais')
      .select('telefone')
      .eq('barraca_id', barracaId)
      .order('id')
      .range(de, de + PAGINA - 1)
    if (error) throw error
    for (const linha of data ?? []) telefones.add(linha.telefone as string)
    if ((data ?? []).length < PAGINA) break
  }
  return telefones
}

export type ResumoImportacao = {
  inseridos: number
  atualizados: number
  semMudanca: number
  ignorados: number
}

type RespostaImportar = {
  estado: 'ok' | 'nao_autenticado' | 'sem_acesso' | 'dados_invalidos' | 'lote_grande'
  inseridos?: number
  atualizados?: number
  sem_mudanca?: number
  ignorados?: number
}

/**
 * Importa em lotes pela RPC `importar_clientes_finais` (idempotente: repetir um
 * lote não duplica nem sobrescreve). Para no primeiro erro e lança com o que já
 * foi gravado em `parcial`. `marketing` só vale para clientes NOVOS.
 */
export async function importarClientesFinais(
  barracaId: string,
  clientes: ClienteParaImportar[],
  marketing: boolean,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResumoImportacao> {
  const resumo: ResumoImportacao = { inseridos: 0, atualizados: 0, semMudanca: 0, ignorados: 0 }
  let feitos = 0
  for (const lote of emLotes(clientes)) {
    const { data, error } = await supabase.rpc('importar_clientes_finais', {
      p_barraca_id: barracaId,
      p_clientes: lote,
      p_marketing: marketing,
    })
    const resposta = data as RespostaImportar | null
    if (error || !resposta || resposta.estado !== 'ok') {
      throw new ErroImportacao(
        error?.message ?? `Importação recusada (${resposta?.estado ?? 'sem resposta'}).`,
        { ...resumo },
      )
    }
    resumo.inseridos += resposta.inseridos ?? 0
    resumo.atualizados += resposta.atualizados ?? 0
    resumo.semMudanca += resposta.sem_mudanca ?? 0
    resumo.ignorados += resposta.ignorados ?? 0
    feitos += lote.length
    aoProgredir?.(feitos, clientes.length)
  }
  return resumo
}

export class ErroImportacao extends Error {
  parcial: ResumoImportacao
  constructor(mensagem: string, parcial: ResumoImportacao) {
    super(mensagem)
    this.parcial = parcial
  }
}

export type ClienteParaImportar = Pick<ClienteImportado, 'nome' | 'telefone' | 'rua' | 'numero' | 'bairro' | 'referencia'>
