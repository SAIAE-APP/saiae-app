import { useState } from 'react'
import clsx from 'clsx'
import { calcularTroco, totalAPagarCentavos } from '../lib/definirMetodoFila'
import { METODOS_DISPONIVEIS, type MetodoPagamento } from '../lib/metodoPagamento'
import { filtrarEntradaPreco, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import type { PedidoComItens } from '../types/database'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'

/**
 * "Pagar depois": ao tocar Entregue num pedido "A receber", o operador diz como o cliente pagou. "Receber depois"
 * entrega sem definir (continua a receber, com o botão de definir do Histórico). Dinheiro tem o valor recebido
 * opcional para mostrar o troco (só informativo, nada é gravado). A escolha entra na fila (funciona sem rede).
 */
export function ModalFormaPagamento({
  pedido,
  onEscolher,
  onReceberDepois,
  onCancelar,
}: {
  pedido: PedidoComItens | null
  onEscolher: (pedido: PedidoComItens, metodo: MetodoPagamento) => void
  onReceberDepois: (pedido: PedidoComItens) => void
  onCancelar: () => void
}) {
  const [escolhido, setEscolhido] = useState<MetodoPagamento | null>(null)
  const [recebido, setRecebido] = useState('')

  function fechar() {
    setEscolhido(null)
    setRecebido('')
    onCancelar()
  }

  const total = pedido ? totalAPagarCentavos(pedido) : 0
  const recebidoCentavos = recebido.trim() ? reaisParaCentavos(recebido) : null
  const troco = escolhido === 'dinheiro' ? calcularTroco(total, recebidoCentavos) : null

  return (
    <BottomSheet open={pedido !== null} onClose={fechar} aria-label="Como o cliente pagou?">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Como o cliente pagou?</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        {pedido ? `Pedido #${pedido.senha}, total ${formatarPrecoBR(total)}.` : ''} A nota fiscal sai com a forma que você escolher.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
        {METODOS_DISPONIVEIS.map((metodo) => {
          const selecionado = escolhido === metodo.chave
          return (
            <button
              key={metodo.chave}
              type="button"
              role="radio"
              aria-checked={selecionado}
              onClick={() => setEscolhido(metodo.chave)}
              className={clsx(
                'flex min-h-14 items-center gap-3 rounded-mesa-lg border-2 p-3 text-left outline-none transition-colors',
                selecionado
                  ? 'border-mesa-neutral-900 bg-mesa-neutral-100 dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                  : 'border-mesa-border-subtle bg-mesa-surface',
              )}
            >
              <Icone nome={metodo.icone} size={20} />
              <span className="text-sm font-semibold text-mesa-text-primary">{metodo.label}</span>
            </button>
          )
        })}
      </div>

      {escolhido === 'dinheiro' && (
        <div className="mt-3">
          <Input
            label="Valor recebido (opcional)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={recebido}
            onChange={(e) => setRecebido(filtrarEntradaPreco(e.target.value))}
            helpText="Só para calcular o troco; não fica gravado."
          />
          {troco !== null && (
            <p role="status" className="mt-2 text-base font-semibold text-mesa-text-primary">
              Troco: {formatarPrecoBR(troco)}
            </p>
          )}
        </div>
      )}

      <Button
        size="xl"
        className="mt-4 w-full"
        disabled={!escolhido || !pedido}
        onClick={() => {
          if (!pedido || !escolhido) return
          const p = pedido
          const m = escolhido
          setEscolhido(null)
          setRecebido('')
          onEscolher(p, m)
        }}
      >
        Confirmar e entregar
      </Button>
      <Button
        variant="outline"
        size="md"
        className="mt-2 w-full"
        disabled={!pedido}
        onClick={() => {
          if (!pedido) return
          const p = pedido
          setEscolhido(null)
          setRecebido('')
          onReceberDepois(p)
        }}
      >
        Receber depois
      </Button>
      <Button variant="ghost" size="md" className="mt-2 w-full" onClick={fechar}>
        Cancelar
      </Button>
    </BottomSheet>
  )
}
