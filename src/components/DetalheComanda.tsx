import { useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import clsx from 'clsx'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { iconeAtendimento, nomeDoCliente, rotuloAtendimento } from '../lib/atendimento'
import type { Barraca, ItemDoPedido, PedidoComItens } from '../types/database'

const DURACAO_LONGO_TOQUE_MS = 1000

// Mesmo cabeçalho colorido do card em Cozinha.tsx (redesign IDV "Sai aê") —
// cronômetro mm:ss + sinal de status, sempre em tema escuro. Duplica os
// pequenos helpers de tempo em vez de importar de Cozinha.tsx, mesmo
// padrão já usado por ModalCancelamento.tsx neste componente. Precisa
// duplicar também a regra de congelar ao entrar em Pronto (mesmo texto
// "congela" mostrado logo abaixo da coluna Pronto em Cozinha.tsx) — sem
// isso o cronômetro deste header continuava contando depois de pronto_em.
function segundosDecorridos(pedido: PedidoComItens): number {
  const inicio = new Date(pedido.criado_em).getTime()
  const fim = pedido.status === 'pronto' && pedido.pronto_em
    ? new Date(pedido.pronto_em).getTime()
    : Date.now()
  return Math.max(0, Math.floor((fim - inicio) / 1000))
}

function corSemaforo(minutos: number, barraca: Barraca): 'verde' | 'amarelo' | 'vermelho' {
  if (minutos <= barraca.verde_ate) return 'verde'
  if (minutos <= barraca.amarelo_ate) return 'amarelo'
  return 'vermelho'
}

function formatarHoraEnvio(iso: string): string {
  const data = new Date(iso)
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`
}

/** Mesmo critério de Cozinha.tsx (textoTempoCabecalho/iconeTempoCabecalho) —
 * `mostrar_horario_pedido` só troca o texto, nunca a cor do semáforo. */
function textoTempoCabecalho(pedido: PedidoComItens, barraca: Barraca, segundos: number): string {
  return barraca.mostrar_horario_pedido ? formatarHoraEnvio(pedido.criado_em) : formatarDuracao(segundos)
}

function iconeTempoCabecalho(barraca: Barraca): string {
  return barraca.mostrar_horario_pedido ? 'schedule' : 'timer'
}

const CORES_CABECALHO: Record<'verde' | 'amarelo' | 'vermelho', string> = {
  verde: 'bg-mesa-kanban-green',
  amarelo: 'bg-mesa-kanban-yellow',
  vermelho: 'bg-mesa-kanban-red',
}

const TEXTO_SEMAFORO: Record<'verde' | 'amarelo' | 'vermelho', string> = {
  verde: 'No prazo',
  amarelo: 'Atenção',
  vermelho: 'Atrasado',
}

function formatarDuracao(segundosTotais: number): string {
  const minutos = Math.floor(segundosTotais / 60)
  const segundos = segundosTotais % 60
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
}

function LinhaItemDetalhe({
  item,
  marcado,
  onAlternar,
  onSolicitarRemocao,
}: {
  item: ItemDoPedido
  marcado: boolean
  onAlternar: () => void
  onSolicitarRemocao: () => void
}) {
  const timerRef = useRef<number | null>(null)
  const disparouRef = useRef(false)

  function iniciarToque() {
    if (item.removido || item.entrega_direta) return
    disparouRef.current = false
    timerRef.current = window.setTimeout(() => {
      disparouRef.current = true
      onSolicitarRemocao()
    }, DURACAO_LONGO_TOQUE_MS)
  }

  function cancelarToque() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function aoClicar(e: MouseEvent<HTMLLIElement>) {
    if (disparouRef.current) e.stopPropagation()
  }

  return (
    <li
      onPointerDown={(e: PointerEvent<HTMLLIElement>) => {
        if ((e.target as HTMLElement).closest('button')) return
        iniciarToque()
      }}
      onPointerUp={cancelarToque}
      onPointerLeave={cancelarToque}
      onPointerCancel={cancelarToque}
      onContextMenu={(e) => e.preventDefault()}
      onClick={aoClicar}
      className={clsx(
        'flex select-none items-center gap-3 border-b border-mesa-border-subtle py-2.5 last:border-b-0',
        item.removido && 'opacity-40',
      )}
    >
      {item.removido ? (
        <span className="size-7 shrink-0" />
      ) : item.entrega_direta ? (
        // Já nasceu entregue direto no balcão — não passou pela cozinha, não
        // tem o que marcar aqui. Ícone só informativo, sem botão.
        <span
          className="flex size-11 shrink-0 items-center justify-center text-mesa-text-tertiary"
          aria-label={`${item.nome_item} entregue direto, sem passar na cozinha`}
        >
          <Icone nome="shopping_bag" size={16} />
        </span>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onAlternar()
          }}
          aria-label={marcado ? `Desmarcar ${item.nome_item} como entregue` : `Marcar ${item.nome_item} como entregue`}
          className="flex size-11 shrink-0 items-center justify-center outline-none"
        >
          <span
            className={clsx(
              'flex size-7 items-center justify-center rounded-mesa-full border-2 transition-colors',
              marcado
                ? 'border-mesa-neutral-900 bg-mesa-neutral-900 dark:border-mesa-neutral-50 dark:bg-mesa-neutral-50'
                : 'border-mesa-neutral-300 bg-transparent dark:border-mesa-neutral-600',
            )}
          >
            {marcado && (
              <Icone nome="check" size={16} peso={700} className="text-white dark:text-mesa-neutral-900" />
            )}
          </span>
        </button>
      )}

      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            'block truncate text-base',
            item.removido
              ? 'text-mesa-text-tertiary line-through'
              : marcado
                ? 'text-mesa-text-tertiary line-through'
                : 'text-mesa-text-primary',
          )}
        >
          {item.nome_item}
        </span>
        {item.observacao && !item.removido && (
          // Mostarda intencional aqui (regra revista no redesign do card
          // de Cozinha, ver CLAUDE.md "Regras de tema") — mesma etiqueta
          // de destaque usada no card, agora por item.
          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-mesa-sm bg-mesa-orange-500 px-2 py-1 text-xs font-bold text-mesa-neutral-900">
            <Icone nome="sticky_note_2" size={12} peso={700} />
            {item.observacao}
          </span>
        )}
      </span>

      <span className="shrink-0 rounded-mesa-balao bg-mesa-neutral-100 px-2.5 py-1 text-xs font-semibold text-mesa-text-secondary dark:bg-mesa-neutral-700">
        ×{item.quantidade}
      </span>

      {!item.removido && !item.entrega_direta && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onSolicitarRemocao()
          }}
          aria-label={`Remover ${item.nome_item} do pedido`}
          className="group flex size-11 shrink-0 items-center justify-center outline-none"
        >
          <span className="flex size-[30px] items-center justify-center rounded-mesa-sm text-mesa-text-secondary transition-colors group-hover:bg-mesa-error-50 group-hover:text-mesa-error-700 dark:group-hover:bg-mesa-error-500/15 dark:group-hover:text-mesa-error-500">
            <Icone nome="delete" size={16} />
          </span>
        </button>
      )}
    </li>
  )
}

export function DetalheComanda({
  pedido,
  barraca,
  onFechar,
  onAlternarEntregue,
  onSolicitarRemocaoItem,
  onMoverParaPronto,
  onCancelar,
}: {
  pedido: PedidoComItens | null
  barraca: Barraca
  onFechar: () => void
  onAlternarEntregue: (item: ItemDoPedido) => void
  onSolicitarRemocaoItem: (item: ItemDoPedido) => void
  onMoverParaPronto: (pedido: PedidoComItens) => void
  onCancelar: (pedido: PedidoComItens) => void
}) {
  const itensAtivos = pedido?.itens_do_pedido.filter((i) => !i.removido) ?? []
  const itensRemovidos = pedido?.itens_do_pedido.filter((i) => i.removido) ?? []
  // Itens entrega_direta nunca passaram pela cozinha — ficam listados acima
  // (transparência do conteúdo do pedido), mas não contam na barra de
  // progresso de preparo, mesmo critério do card em Cozinha.tsx.
  const itensParaCozinha = itensAtivos.filter((i) => !i.entrega_direta)
  const totalAtivos = itensParaCozinha.length
  const entreguesCount = itensParaCozinha.filter((i) => i.entregue).length
  const progresso = totalAtivos > 0 ? (entreguesCount / totalAtivos) * 100 : 0

  const segundos = pedido ? segundosDecorridos(pedido) : 0
  const cor = pedido ? corSemaforo(Math.floor(segundos / 60), barraca) : 'verde'

  return (
    // Mesmo tratamento sempre-escuro do card em Cozinha.tsx (ver comentário
    // lá) — bg forçado com "!" porque o BottomSheet já define bg-mesa-surface
    // na própria classe base, mesma especificidade de utilitário Tailwind.
    <BottomSheet
      open={pedido !== null}
      onClose={onFechar}
      aria-label="Detalhes da comanda"
      className="dark !bg-mesa-neutral-900"
    >
      {pedido && (
        <>
          <div className={clsx('-mx-6 -mt-3 flex items-center justify-between gap-2 rounded-t-mesa-2xl px-4 py-2.5', CORES_CABECALHO[cor])}>
            <span className="flex items-center gap-1.5 font-mesa-mono text-xs font-semibold text-white">
              <Icone nome={iconeTempoCabecalho(barraca)} size={16} className="text-white" />
              {textoTempoCabecalho(pedido, barraca, segundos)}
            </span>
            <span className="text-sm font-bold text-white">{TEXTO_SEMAFORO[cor]}</span>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="font-mesa-display text-2xl font-black leading-none text-white">
              #{pedido.senha}
            </span>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="ml-auto flex size-11 shrink-0 items-center justify-center outline-none"
            >
              <span className="flex size-[34px] items-center justify-center rounded-mesa-sm bg-mesa-neutral-700 text-mesa-neutral-50">
                <Icone nome="close" size={18} />
              </span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mesa-neutral-400">
            <Icone nome={iconeAtendimento(pedido)} size={14} />
            {rotuloAtendimento(pedido)}
          </div>
          {nomeDoCliente(pedido) && (
            <p className="mt-1 truncate text-sm font-semibold text-mesa-neutral-200">
              {nomeDoCliente(pedido)}
            </p>
          )}

          <p className="mt-4 text-sm text-mesa-neutral-400">Marque os itens conforme forem saindo</p>

          <ul className="mt-2">
            {itensAtivos.map((item) => (
              <LinhaItemDetalhe
                key={item.id}
                item={item}
                marcado={item.entregue}
                onAlternar={() => onAlternarEntregue(item)}
                onSolicitarRemocao={() => onSolicitarRemocaoItem(item)}
              />
            ))}
            {itensRemovidos.map((item) => (
              <LinhaItemDetalhe
                key={item.id}
                item={item}
                marcado={false}
                onAlternar={() => {}}
                onSolicitarRemocao={() => {}}
              />
            ))}
          </ul>

          {totalAtivos > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-700">
                <div
                  className="h-full rounded-mesa-full bg-mesa-success-500 transition-[width] duration-[var(--mesa-duration-short)]"
                  style={{ width: `${progresso}%` }}
                />
              </div>
              <span className="shrink-0 font-mesa-display text-sm font-semibold text-mesa-text-secondary">
                {entreguesCount} de {totalAtivos}
              </span>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Button
              variant="primary"
              size="xl"
              className="w-full"
              onClick={() => onMoverParaPronto(pedido)}
            >
              Mover para Pronto
            </Button>
            <button
              type="button"
              onClick={() => onCancelar(pedido)}
              className="min-h-11 text-sm font-semibold text-mesa-error-500"
            >
              Cancelar comanda
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
