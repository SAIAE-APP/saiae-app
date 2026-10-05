import { supabase } from './supabase'
import { somenteDigitos, type DadosEntrega } from './entrega'
import type { ClienteFinal } from '../types/database'

const COLUNAS = 'id, barraca_id, nome, telefone, rua, numero, bairro, referencia, criado_em, atualizado_em'
const LIMITE_BUSCA = 5
/** Menos que isso é ruído: não consulta o banco. */
const MIN_CARACTERES_NOME = 2
const MIN_DIGITOS_TELEFONE = 4

/** Escapa \ % _ pro termo digitado não virar curinga do like. */
function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Busca clientes da barraca por telefone (só dígitos, parcial) ou nome
 * (parcial, sem caixa). Sempre filtra por barraca_id além da RLS.
 */
export async function buscarClientesFinais(
  barracaId: string,
  termo: string,
  limite = LIMITE_BUSCA,
): Promise<ClienteFinal[]> {
  const texto = termo.trim()
  const digitos = somenteDigitos(texto)
  // "Parece telefone" = só dígitos e separadores comuns; senão é nome.
  const pareceTelefone = digitos.length > 0 && /^[\d\s()+-]+$/.test(texto)

  let consulta = supabase.from('clientes_finais').select(COLUNAS).eq('barraca_id', barracaId)

  if (pareceTelefone) {
    if (digitos.length < MIN_DIGITOS_TELEFONE) return []
    consulta = consulta.like('telefone', `%${digitos}%`)
  } else {
    if (texto.length < MIN_CARACTERES_NOME) return []
    consulta = consulta.ilike('nome', `%${escaparLike(texto)}%`)
  }

  const { data, error } = await consulta.order('nome').limit(limite)
  if (error) throw error
  return (data ?? []) as ClienteFinal[]
}

const LIMITE_LISTA = 20

/** Lista pra tela de gestão (Ajustes): sem termo, os últimos atualizados;
 * com termo, a mesma busca de telefone/nome do pedido, só que mais longa. */
export async function listarClientesFinais(barracaId: string, termo: string): Promise<ClienteFinal[]> {
  if (termo.trim()) return buscarClientesFinais(barracaId, termo, LIMITE_LISTA)
  const { data, error } = await supabase
    .from('clientes_finais')
    .select(COLUNAS)
    .eq('barraca_id', barracaId)
    .order('atualizado_em', { ascending: false })
    .limit(LIMITE_LISTA)
  if (error) throw error
  return (data ?? []) as ClienteFinal[]
}

/** Cadastra ou atualiza (por barraca + telefone) o cliente de um pedido de entrega. */
export async function salvarClienteFinal(barracaId: string, dados: DadosEntrega): Promise<ClienteFinal> {
  const { data, error } = await supabase
    .from('clientes_finais')
    .upsert(
      {
        barraca_id: barracaId,
        nome: dados.nome.trim(),
        telefone: somenteDigitos(dados.telefone),
        rua: dados.rua.trim(),
        numero: dados.numero.trim(),
        bairro: dados.bairro.trim(),
        referencia: dados.referencia?.trim() || null,
      },
      { onConflict: 'barraca_id,telefone' },
    )
    .select(COLUNAS)
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
    rua: c.rua,
    numero: c.numero,
    bairro: c.bairro,
    referencia: c.referencia,
  }
}
