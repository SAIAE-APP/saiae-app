import { textoGanho } from '../../lib/cashbackTexto'
import type { EstadoCashback } from '../../hooks/useCashback'

/** Uma linha discreta no carrinho: quanto o cliente ganha de volta. Só com ganho > 0 (loja ligada, sessão e pagamento online). */
export function LinhaCashbackGanho({ cashback }: { cashback: EstadoCashback }) {
  if (cashback.ganhoCentavos <= 0) return null
  return <p className="text-sm text-mesa-text-secondary">{textoGanho(cashback.ganhoCentavos)}</p>
}
