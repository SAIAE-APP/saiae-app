import { humanizarMetodo } from './metodoPagamento'

/** Texto pro operador de cada resposta da RPC `definir_metodo_pagamento`. */
export function mensagemDefinirMetodo(estado: string | undefined, metodoAtual?: string): string {
  switch (estado) {
    case 'ja_definido':
      return `Este pedido já tem a forma de pagamento definida (${humanizarMetodo(metodoAtual ?? null)}).`
    case 'cancelado':
      return 'Pedido cancelado: não dá pra definir a forma de pagamento.'
    case 'sem_acesso':
      return 'Sem permissão para alterar este pedido.'
    case 'nao_autenticado':
      return 'Sua sessão expirou. Entre de novo e tente outra vez.'
    case 'metodo_invalido':
      return 'Forma de pagamento inválida.'
    default:
      return 'Não foi possível definir a forma de pagamento. Tente de novo.'
  }
}
