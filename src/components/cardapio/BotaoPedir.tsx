import clsx from 'clsx'
import { Button } from '../ui/Button'
import { Icone } from '../ui/Icone'
import { estadoBotaoPedir } from '../../lib/estadoBotaoPedir'

/** Botão de pedir único do cardápio público: mostarda de 44px em todo card.
 * Toda decisão de estado vem de `estadoBotaoPedir`. Esgotado e fechado são neutros;
 * com quantidade no carrinho vira o stepper "− N +" (item sem opções). */
export function BotaoPedir({
  esgotado,
  lojaAberta,
  podeAdicionar,
  comOpcoes = false,
  quantidadeNoCarrinho,
  textoFechado,
  larguraTotal = false,
  variante = 'mostarda',
  onAdicionar,
  onRemover,
}: {
  esgotado: boolean
  lojaAberta: boolean
  podeAdicionar: boolean
  /** Item com variação/adicionais: o botão abre o seletor; os ajustes de quantidade ficam no pedido. */
  comOpcoes?: boolean
  quantidadeNoCarrinho: number
  /** Estado completo da loja ("Fechado · abre hoje às 18:00") para leitores de tela. */
  textoFechado?: string
  /** Ocupa a largura do contêiner (cards horizontais e herói). */
  larguraTotal?: boolean
  /** `tinta` é para usar sobre fundo mostarda (herói do destaque). */
  variante?: 'mostarda' | 'tinta'
  onAdicionar: () => void
  onRemover: () => void
}) {
  const estado = estadoBotaoPedir({
    esgotado,
    lojaAberta,
    podeAdicionar,
    comOpcoes,
    quantidade: quantidadeNoCarrinho,
  })
  const largura = larguraTotal ? 'w-full' : undefined

  if (estado.tipo === 'esgotado') {
    return (
      <Button variant="outline" size="md" disabled className={largura}>
        Esgotado
      </Button>
    )
  }

  if (estado.tipo === 'fechado') {
    return (
      <Button
        variant="outline"
        size="md"
        disabled
        className={largura}
        aria-label={textoFechado ?? 'Fechado'}
      >
        Fechado
      </Button>
    )
  }

  if (estado.tipo === 'contador') {
    return (
      <div
        className={clsx(
          'flex min-h-11 items-center gap-1 rounded-mesa-full bg-mesa-neutral-100 p-1 px-2 dark:bg-mesa-neutral-800',
          larguraTotal ? 'w-full justify-between' : undefined,
        )}
      >
        <button
          type="button"
          onClick={onRemover}
          disabled={!estado.podeDiminuir}
          aria-label="Diminuir quantidade"
          className="flex size-11 -m-2 items-center justify-center"
        >
          <span className="flex size-7 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white transition-transform active:scale-90 dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
            <Icone nome="remove" size={14} />
          </span>
        </button>
        <span className="min-w-[1.5ch] text-center font-mesa-display text-sm font-bold text-mesa-text-primary">
          {quantidadeNoCarrinho}
        </span>
        <button
          type="button"
          onClick={onAdicionar}
          disabled={!estado.podeAumentar}
          aria-label="Aumentar quantidade"
          className="flex size-11 -m-2 items-center justify-center disabled:opacity-40"
        >
          <span className="flex size-7 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white transition-transform active:scale-90 dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
            <Icone nome="add" size={14} />
          </span>
        </button>
      </div>
    )
  }

  const rotulo =
    estado.tipo === 'escolher'
      ? quantidadeNoCarrinho > 0
        ? `Escolher (${quantidadeNoCarrinho})`
        : 'Escolher'
      : 'Adicionar'

  return (
    <Button
      variant={variante === 'tinta' ? 'confirm' : 'primary'}
      size="md"
      className={clsx(largura, larguraTotal && 'px-2!')}
      icon={larguraTotal && quantidadeNoCarrinho > 9 ? undefined : <Icone nome="add" size={16} />}
      disabled={estado.desabilitado}
      onClick={onAdicionar}
    >
      {rotulo}
    </Button>
  )
}
