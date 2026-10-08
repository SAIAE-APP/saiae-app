export type MetodoPagamento = 'dinheiro' | 'debito' | 'credito' | 'pix'

// Nomes do Material Symbols Rounded — mesmos da IDV Sai aê (payments/
// credit_card/qr_code_2, ver DESIGN.md "Ícones-chave").
export const METODOS_DISPONIVEIS: { chave: MetodoPagamento; label: string; icone: string }[] = [
  { chave: 'dinheiro', label: 'Dinheiro', icone: 'payments' },
  { chave: 'debito', label: 'Débito', icone: 'credit_card' },
  { chave: 'credito', label: 'Crédito', icone: 'credit_card' },
  { chave: 'pix', label: 'Pix', icone: 'qr_code_2' },
]

/** Pedido do cardápio digital "Pagar na entrega": o método real só é definido na entrega. */
export const METODO_NA_ENTREGA = 'na_entrega'

/** Pedido que o cupom cobriu por inteiro (sem taxa a pagar): ninguém pagou nada, não é Pix nem dinheiro. */
export const METODO_GRATIS = 'gratis'

/** Opção "Pagar na entrega" do operador: só no modo Entrega. Fica fora de
 * `METODOS_DISPONIVEIS` de propósito (não é método real nem configurável por
 * barraca, e Ajustes/Histórico/relatórios percorrem essa lista). */
export const OPCAO_PAGAR_NA_ENTREGA = {
  chave: METODO_NA_ENTREGA,
  label: 'Pagar na entrega',
  icone: 'two_wheeler',
} as const

export function humanizarMetodo(chave: string | null): string {
  if (!chave) return 'Método não informado'
  if (chave === METODO_NA_ENTREGA) return 'A definir na entrega'
  if (chave === METODO_GRATIS) return 'Grátis (cupom)'
  return METODOS_DISPONIVEIS.find((m) => m.chave === chave)?.label ?? 'Método não informado'
}

// Cores por método vêm de tokens dedicados (mesa-payment-*, ver
// tokens.css) — categóricas, não confundir com as semânticas
// (sucesso/erro/aviso) nem com o semáforo operacional do kanban.
export function corMetodo(chave: string | null): string {
  switch (chave) {
    case 'dinheiro':
      return 'bg-[var(--color-mesa-payment-cash-bg)] text-[var(--color-mesa-payment-cash-fg)]'
    case 'debito':
      return 'bg-[var(--color-mesa-payment-debit-bg)] text-[var(--color-mesa-payment-debit-fg)]'
    case 'credito':
      return 'bg-[var(--color-mesa-payment-credit-bg)] text-[var(--color-mesa-payment-credit-fg)]'
    case 'pix':
      return 'bg-[var(--color-mesa-payment-pix-bg)] text-[var(--color-mesa-payment-pix-fg)]'
    default:
      return 'bg-[var(--color-mesa-payment-unknown-bg)] text-[var(--color-mesa-payment-unknown-fg)]'
  }
}
