import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Chip } from './ui/Chip'
import { Icone } from './ui/Icone'
import { MOTIVOS_CANCELAMENTO } from '../lib/cancelamento'
import type { MotivoCancelamento } from '../lib/cancelamento'
import type { PedidoComItens } from '../types/database'

export function ModalCancelamento({
  pedido,
  cancelando,
  onFechar,
  onConfirmar,
  titulo,
  descricao,
  rotuloConfirmar = 'Cancelar pedido',
  motivoFixo,
}: {
  pedido: PedidoComItens
  cancelando: boolean
  onFechar: () => void
  onConfirmar: (motivo: MotivoCancelamento) => void
  /** Textos do caso estorno; ausentes = o cancelamento de sempre. */
  titulo?: string
  descricao?: string
  rotuloConfirmar?: string
  /** Pedido já cancelado: não pergunta o motivo de novo (confirma com este). */
  motivoFixo?: MotivoCancelamento
}) {
  const [motivoEscolhido, setMotivo] = useState<MotivoCancelamento | ''>('')
  const motivo = motivoFixo ?? motivoEscolhido

  return (
    // Mesmo tratamento sempre-escuro do card/detalhe da Cozinha (ver
    // comentário em Cozinha.tsx CardPedido).
    <BottomSheet
      open
      onClose={onFechar}
      aria-label="Cancelar comanda"
      className="dark !bg-mesa-neutral-900"
    >
      <div className="flex size-11 items-center justify-center rounded-mesa-md bg-mesa-error-500/15">
        <Icone nome="cancel" size={22} peso={700} className="text-mesa-error-500" />
      </div>

      <h2 className="mt-4 text-xl font-bold text-white">{titulo ?? `Cancelar o pedido #${pedido.senha}?`}</h2>
      <p className="mt-1 text-sm text-mesa-neutral-400">
        {descricao ?? 'Ele sai da cozinha e não entra no relatório de vendas.'}
      </p>

      {!motivoFixo && (
        <>
          <p className="mt-5 text-xs font-bold uppercase tracking-wide text-mesa-neutral-400">Motivo</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MOTIVOS_CANCELAMENTO.map((opcao) => (
              <Chip
                key={opcao.valor}
                variant={motivo === opcao.valor ? 'teal' : 'plain'}
                checked={motivo === opcao.valor}
                onClick={() => setMotivo(opcao.valor)}
              >
                {opcao.rotulo}
              </Chip>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 flex gap-3">
        <Button variant="outline" size="xl" className="flex-1" onClick={onFechar}>
          Voltar
        </Button>
        <Button
          variant="destructive"
          size="xl"
          className="flex-1"
          disabled={!motivo}
          loading={cancelando}
          onClick={() => motivo && onConfirmar(motivo)}
        >
          {rotuloConfirmar}
        </Button>
      </div>
    </BottomSheet>
  )
}
