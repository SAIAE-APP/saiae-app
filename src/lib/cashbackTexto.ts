// Textos do cashback para o cliente do cardápio digital. Puro (só importa preco.ts), testável no Node.
import { formatarPrecoBR } from './preco.ts'

/** Explica por que o saldo fica bloqueado quando já há cupom (um benefício por pedido). */
export const MSG_CUPOM_E_SALDO = 'Cupom e saldo não somam. Remova o cupom para usar o saldo.'

/** "Você ganha R$ 2,50 de volta neste pedido" (carrinho). */
export function textoGanho(creditoCentavos: number): string {
  return `Você ganha ${formatarPrecoBR(creditoCentavos)} de volta neste pedido`
}

/** "31/12": dia e mês no fuso de Brasília (o saldo vence num instante, e o cliente pensa em data do calendário daqui).
 * Data inválida devolve vazio. */
export function textoValidade(isoVence: string): string {
  const d = new Date(isoVence)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** Rótulo da opção do checkout. O valor é o que SERÁ usado neste pedido, não o saldo inteiro. */
export function textoSaldoBotao(usadoCentavos: number): string {
  return `Usar meu saldo (${formatarPrecoBR(usadoCentavos)})`
}

/** Confirmação do pedido: "Você ganhou R$ 2,00. Vale até 31/12." Sem ganho, vazio (nada a mostrar). */
export function textoAvisoGanho(geradoCentavos: unknown, venceEm: unknown): string {
  if (typeof geradoCentavos !== 'number' || !Number.isInteger(geradoCentavos) || geradoCentavos <= 0) return ''
  const ganho = `Você ganhou ${formatarPrecoBR(geradoCentavos)}.`
  const ate = typeof venceEm === 'string' ? textoValidade(venceEm) : ''
  return ate ? `${ganho} Vale até ${ate}.` : ganho
}
