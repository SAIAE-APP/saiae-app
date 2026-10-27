import { Checkbox } from '../ui/Checkbox'
import { formatarPrecoBR } from '../../lib/preco'
import { textoSaldoBotao, textoValidade } from '../../lib/cashbackTexto'
import type { EstadoCashback } from '../../hooks/useCashback'

/**
 * "Usar meu saldo" no resumo do pedido. DESMARCADO por padrão (SUPOSIÇÃO-CASHBACK-4: um benefício por pedido, cupom OU
 * saldo, e o cliente escolhe). Com cupom aplicado o bloco explica por que o saldo não se soma. O valor é prévia: o
 * servidor recalcula e responde 409 com o novo total se divergir.
 */
export function BlocoCashbackCheckout({ cashback }: { cashback: EstadoCashback }) {
  const { habilitado, dados, aviso, resgatePossivelCentavos, usar, setUsar } = cashback
  if (!habilitado || !dados || dados.disponivelCentavos <= 0) return null

  if (aviso) {
    return (
      <p role="status" className="flex min-h-11 items-center text-sm text-mesa-text-secondary">
        {aviso}
      </p>
    )
  }

  if (resgatePossivelCentavos <= 0) return null

  const vence = dados.venceEm ? textoValidade(dados.venceEm) : ''
  const limitado = resgatePossivelCentavos < dados.disponivelCentavos

  return (
    <div className="flex flex-col">
      <Checkbox checked={usar} onChange={setUsar} label={textoSaldoBotao(resgatePossivelCentavos)} size="lg" />
      <p className="text-xs text-mesa-text-secondary">
        {limitado
          ? `Seu saldo é ${formatarPrecoBR(dados.disponivelCentavos)}. Este pedido aceita até ${formatarPrecoBR(resgatePossivelCentavos)}.`
          : `Seu saldo: ${formatarPrecoBR(dados.disponivelCentavos)}.`}
        {vence ? ` Vale até ${vence}.` : ''}
      </p>
    </div>
  )
}
