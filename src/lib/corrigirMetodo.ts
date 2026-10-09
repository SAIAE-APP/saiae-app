// "Pagar depois", Fase 1: corrigir a forma de pagamento de um pedido já definido (ex.: o cliente disse Pix e pagou em
// dinheiro), enquanto a NFC-e não foi emitida. Só o dono, com a senha administrativa (o Histórico já fica atrás do
// GateSenhaAdmin; o banco confere o papel de dono). PURO, testado em tests/corrigirMetodo.test.ts.
import { METODOS_REAIS } from './definirMetodoFila.ts'

/** Notas que ainda não existem de verdade: sem nota, com erro ou rejeitada. Qualquer outro status trava a correção. */
const NFCE_QUE_PERMITE = new Set<string | null>([null, 'erro', 'erro_autorizacao'])

export function podeCorrigirMetodo(
  pedido: { status: string; metodo_pagamento: string | null; nfce_status?: string | null },
  ligado: boolean,
): boolean {
  return (
    ligado &&
    pedido.status !== 'cancelado' &&
    (METODOS_REAIS as readonly string[]).includes(pedido.metodo_pagamento ?? '') &&
    NFCE_QUE_PERMITE.has(pedido.nfce_status ?? null)
  )
}

/** Texto para o operador de cada resposta da RPC `corrigir_metodo_pagamento`. */
export function mensagemCorrigirMetodo(estado: string | undefined): string {
  switch (estado) {
    case 'nfce_emitida':
      return 'A nota fiscal deste pedido já foi emitida: a forma de pagamento não pode mais ser trocada aqui.'
    case 'cancelado':
      return 'Pedido cancelado: não dá pra trocar a forma de pagamento.'
    case 'nao_corrigivel':
      return 'Este pedido não permite trocar a forma de pagamento.'
    case 'sem_acesso':
      return 'Só o dono da barraca pode corrigir a forma de pagamento.'
    case 'nao_autenticado':
      return 'Sua sessão expirou. Entre de novo e tente outra vez.'
    case 'metodo_invalido':
      return 'Forma de pagamento inválida.'
    default:
      return 'Não foi possível trocar a forma de pagamento. Tente de novo.'
  }
}
