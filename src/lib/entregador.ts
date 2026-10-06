import { supabase } from './supabase'
import { linkWhatsAppSemNumero } from './entrega'

export type MetodoEntregador = 'dinheiro' | 'debito' | 'credito' | 'pix'

export const METODOS_ENTREGADOR: { chave: MetodoEntregador; label: string; icone: string }[] = [
  { chave: 'dinheiro', label: 'Dinheiro', icone: 'payments' },
  { chave: 'pix', label: 'Pix', icone: 'qr_code_2' },
  { chave: 'debito', label: 'Débito', icone: 'credit_card' },
  { chave: 'credito', label: 'Crédito', icone: 'credit_card' },
]

export type PedidoDoEntregador =
  | {
      estado: 'ok'
      senha: number
      barraca_nome: string | null
      status: string
      cliente_nome: string | null
      telefone: string | null
      rua: string | null
      numero: string | null
      bairro: string | null
      referencia: string | null
      observacao: string | null
      itens: { nome_item: string; quantidade: number; observacao: string | null }[]
      taxa_entrega_centavos: number
      total_centavos: number
      metodo_pagamento: string | null
      metodo_definivel: boolean
    }
  | { estado: 'ja_confirmado' | 'cancelado' | 'expirado'; senha: number; barraca_nome: string | null }
  | { estado: 'invalido' | 'bloqueado' }

export type ResultadoConfirmacao = {
  estado:
    | 'confirmado'
    | 'ja_confirmado'
    | 'cancelado'
    | 'expirado'
    | 'metodo_obrigatorio'
    | 'metodo_invalido'
    | 'invalido'
    | 'bloqueado'
  senha?: number
}

export async function buscarPedidoDoEntregador(token: string): Promise<PedidoDoEntregador> {
  const { data, error } = await supabase.rpc('entregador_pedido', { p_token: token })
  if (error) throw error
  return data as PedidoDoEntregador
}

export async function confirmarEntrega(
  token: string,
  metodo: MetodoEntregador | null,
): Promise<ResultadoConfirmacao> {
  const { data, error } = await supabase.rpc('entregador_confirmar', {
    p_token: token,
    p_metodo: metodo,
  })
  if (error) throw error
  return data as ResultadoConfirmacao
}

/** Link público que o motoboy abre (mesma origem do app). */
export function linkDoEntregador(token: string): string {
  return `${window.location.origin}/e/${token}`
}

export function mensagemLinkEntregador(senha: number | null, token: string): string {
  const titulo = senha !== null ? `*Entrega - Pedido #${senha}*` : '*Entrega*'
  return `${titulo}\nAbra o link pra ver o pedido e confirmar a entrega:\n${linkDoEntregador(token)}`
}

export function whatsappLinkEntregador(senha: number | null, token: string): string {
  return linkWhatsAppSemNumero(mensagemLinkEntregador(senha, token))
}
