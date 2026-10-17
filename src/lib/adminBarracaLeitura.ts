/** Tipos e regras puras da leitura de barraca pelo superadmin (migration 20261028140000). */

export type AdminAcesso = { acesso_id: string; barraca_id: string; nome: string; slug: string }

export type AdminPedidoLinha = {
  pedido_id: string
  senha: number | null
  status: string
  criado_em: string
  tipo_atendimento: string | null
  metodo_pagamento: string | null
  cliente_primeiro_nome: string | null
  telefone_mascarado: string | null
  total_centavos: number | string
  total: number | string
}

export type AdminClienteCompleto = {
  cliente_nome: string | null
  cliente_telefone: string | null
  entrega_rua: string | null
  entrega_numero: string | null
  entrega_bairro: string | null
  entrega_referencia: string | null
}

export type AdminFaturamentoLinha = {
  dia: string
  metodo_pagamento: string | null
  pedidos: number | string
  total_centavos: number | string
}

export type AdminCaixaLinha = {
  data: string
  status: string
  valor_abertura_centavos: number
  valor_fechamento_centavos: number | null
  valor_esperado_centavos: number | null
  diferenca_centavos: number | null
  aberto_em: string
  fechado_em: string | null
}

export const NOME_STATUS_PEDIDO_ADMIN: Record<string, string> = {
  a_fazer: 'A fazer',
  pronto: 'Pronto',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
}

export type FaturamentoDia = {
  dia: string
  pedidos: number
  total: number
  metodos: { metodo: string | null; total: number }[]
}

/** Junta as linhas (dia, forma de pagamento) em um bloco por dia, mais recente primeiro. */
export function agruparFaturamento(linhas: AdminFaturamentoLinha[]): FaturamentoDia[] {
  const por = new Map<string, FaturamentoDia>()
  for (const l of linhas) {
    const dia = por.get(l.dia) ?? { dia: l.dia, pedidos: 0, total: 0, metodos: [] }
    dia.pedidos += Number(l.pedidos)
    dia.total += Number(l.total_centavos)
    dia.metodos.push({ metodo: l.metodo_pagamento, total: Number(l.total_centavos) })
    por.set(l.dia, dia)
  }
  return [...por.values()].sort((a, b) => (a.dia < b.dia ? 1 : -1))
}
