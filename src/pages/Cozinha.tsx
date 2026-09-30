import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { useBarracaAtual, useSincronizacaoAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { turnoAtual } from '../lib/datas'
import { usePedidosAtual } from '../layouts/contextoPedidos'
import { enfileirar } from '../lib/fila'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { tocarSomPedidoCritico, tocarSomPedidoNaCozinha } from '../lib/sons'
import { Badge } from '../components/ui/Badge'
import { BotaoHome } from '../components/ui/BotaoHome'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { ModalCancelamento } from '../components/ModalCancelamento'
import { ModalEntregaDireta } from '../components/ModalEntregaDireta'
import { DetalheComanda } from '../components/DetalheComanda'
import { useToast } from '../components/ui/Toast'
import { dadosComandaDoPedido } from '../hooks/useImpressaoAutomatica'
import { descreverErroImpressao, imprimirComanda, impressoraSuportada } from '../lib/impressoraTermica'
import type { MotivoCancelamento } from '../lib/cancelamento'
import type { Barraca, ItemDoPedido, PedidoComItens } from '../types/database'
import type { StatusConexao } from '../hooks/useRealtimePedidos'

type Coluna = 'a_fazer' | 'pronto'
type CorSinal = 'verde' | 'amarelo' | 'vermelho'

const DURACAO_FAIXA_FINALIZADO_MS = 5000
// 1s (não mais 10s): o card novo mostra um cronômetro mm:ss ao vivo no
// cabeçalho (ver CardPedido) — precisa de tick por segundo pra não
// parecer travado.
const INTERVALO_RELOGIO_MS = 1000

function segundosDecorridos(pedido: PedidoComItens): number {
  const inicio = new Date(pedido.criado_em).getTime()
  const fim = pedido.status === 'pronto' && pedido.pronto_em
    ? new Date(pedido.pronto_em).getTime()
    : Date.now()
  return Math.max(0, Math.floor((fim - inicio) / 1000))
}

function minutosDecorridos(pedido: PedidoComItens): number {
  return Math.floor(segundosDecorridos(pedido) / 60)
}

function corPorTempo(minutos: number, barraca: Barraca): CorSinal {
  if (minutos <= barraca.verde_ate) return 'verde'
  if (minutos <= barraca.amarelo_ate) return 'amarelo'
  return 'vermelho'
}

function formatarHora(iso: string): string {
  const data = new Date(iso)
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`
}

/** Config de exibição do cabeçalho do card (Ajustes > Faixas de tempo,
 * `mostrar_horario_pedido`) — só troca o TEXTO entre cronômetro (tempo
 * decorrido) e horário de envio pra cozinha. Nunca afeta `corPorTempo`: o
 * semáforo continua sempre por tempo decorrido, não é personalizável. */
function textoTempoCabecalho(pedido: PedidoComItens, barraca: Barraca): string {
  return barraca.mostrar_horario_pedido
    ? formatarHora(pedido.criado_em)
    : formatarDuracao(segundosDecorridos(pedido))
}

function iconeTempoCabecalho(barraca: Barraca): string {
  return barraca.mostrar_horario_pedido ? 'schedule' : 'timer'
}

function formatarDuracao(segundosTotais: number): string {
  const minutos = Math.floor(segundosTotais / 60)
  const segundos = segundosTotais % 60
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`
}

// Card novo (redesign IDV "Sai aê"): cabeçalho cheio na cor do sinal,
// não mais borda esquerda — a mesma paleta kanban de sempre.
const CORES_CABECALHO: Record<CorSinal, string> = {
  verde: 'bg-mesa-kanban-green',
  amarelo: 'bg-mesa-kanban-yellow',
  vermelho: 'bg-mesa-kanban-red',
}

const TEXTO_SEMAFORO: Record<CorSinal, string> = {
  verde: 'No prazo',
  amarelo: 'Atenção',
  vermelho: 'Atrasado',
}

/**
 * 34×34 visual (regra da tarefa), 44×44 de área de toque — mesmo padrão do
 * botão de apagar em Ajustes.tsx e do stepper em LancarPedido.tsx.
 */
function BotaoChecklist({
  onClick,
  contador,
  total,
}: {
  onClick: () => void
  contador: number
  total: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ver detalhes da comanda"
      className="relative flex size-11 shrink-0 items-center justify-center outline-none"
    >
      <span className="flex size-[34px] items-center justify-center rounded-mesa-sm bg-mesa-neutral-100 text-mesa-neutral-900 dark:bg-mesa-neutral-700 dark:text-mesa-neutral-50">
        <Icone nome="checklist" size={18} />
      </span>
      {contador > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-mesa-balao bg-mesa-neutral-900 px-0.5 text-[10px] font-bold leading-none text-white">
          {contador}/{total}
        </span>
      )}
    </button>
  )
}

/**
 * Item com entrega_direta=true nasceu entregue direto no balcão (Fase 4) —
 * nunca passou pela cozinha, então não usa a linha normal (que alterna
 * entregue/pendente via onClick). Visual não-interativo, cinza + riscado,
 * pra deixar claro que esse item já saiu e não precisa de ação aqui.
 */
function LinhaItemEntregaDireta({ item }: { item: ItemDoPedido }) {
  return (
    <div className="flex items-center gap-2 text-mesa-neutral-500 line-through">
      <Icone nome="shopping_bag" size={14} className="shrink-0" />
      <span className="text-sm font-medium">
        {item.quantidade} {item.nome_item}
      </span>
    </div>
  )
}

function CardPedido({
  pedido,
  barraca,
  coluna,
  onAbrirDetalhe,
  onMoverParaPronto,
  onVoltar,
  onEntregar,
  onCancelar,
  onAtalhoEntregar,
}: {
  pedido: PedidoComItens
  barraca: Barraca
  coluna: Coluna
  onAbrirDetalhe: (pedido: PedidoComItens) => void
  onMoverParaPronto: (pedido: PedidoComItens) => void
  onVoltar: (pedido: PedidoComItens) => void
  onEntregar: (pedido: PedidoComItens) => void
  onCancelar: (pedido: PedidoComItens) => void
  onAtalhoEntregar: (pedido: PedidoComItens) => void
}) {
  const cor = corPorTempo(minutosDecorridos(pedido), barraca)

  const itensAtivos = pedido.itens_do_pedido.filter((i) => !i.removido)
  // Itens entrega_direta nasceram entregues direto no balcão — nunca
  // entraram no fluxo de preparo, então não contam pro checklist/banner de
  // progresso da cozinha (só aparecem como linha informativa abaixo).
  const itensParaCozinha = itensAtivos.filter((i) => !i.entrega_direta)
  const entreguesCount = itensParaCozinha.filter((i) => i.entregue).length
  const tudoEntregue =
    pedido.status !== 'entregue' &&
    itensParaCozinha.length > 0 &&
    itensParaCozinha.every((i) => i.entregue)
  const itensComObservacao = itensAtivos.filter((i) => i.observacao)

  // Reimpressão/fallback manual da comanda (a automática sai ao enviar o
  // pedido — useImpressaoAutomatica). Só no app Android com impressora
  // pronta; nunca é a ação principal do card, então sem mostarda.
  const { mostrarToast } = useToast()
  const [imprimindo, setImprimindo] = useState(false)
  const podeImprimir =
    impressoraSuportada() && barraca.impressora_habilitada && Boolean(barraca.impressora_endereco)

  async function imprimirManual() {
    if (!barraca.impressora_endereco || imprimindo) return
    setImprimindo(true)
    try {
      await imprimirComanda({
        endereco: barraca.impressora_endereco,
        largura: barraca.impressora_largura_papel,
        dados: dadosComandaDoPedido(pedido, barraca),
      })
      mostrarToast(`Comanda ${pedido.senha ?? ''} impressa.`, { variante: 'sucesso', icone: 'print' })
    } catch (erro) {
      console.error('[impressora] reimpressão falhou', erro)
      mostrarToast(`Não imprimiu. ${descreverErroImpressao(erro)}`, { variante: 'erro', duracaoMs: 10000 })
    } finally {
      setImprimindo(false)
    }
  }

  const iconeTipo = pedido.viagem ? 'takeout_dining' : 'storefront'
  const rotuloTipo = pedido.viagem ? 'Viagem' : pedido.mesa ? `Mesa ${pedido.mesa}` : 'Balcão'

  return (
    // Card novo (IDV "Sai aê", redesign_ux_ui_app/saiae/DESIGN.md): "Card
    // de pedido (Cozinha, tema escuro)" — sempre escuro, independente do
    // tema claro/escuro do resto do app. A classe "dark" força esse
    // subtree a usar as variáveis/utilitários dark: já existentes (ver
    // @custom-variant dark em index.css), sem precisar duplicar paleta.
    <div className="dark overflow-hidden rounded-mesa-lg shadow-mesa-1">
      <div className={clsx('flex items-center justify-between gap-2 px-4 py-2.5', CORES_CABECALHO[cor])}>
        <span className="flex items-center gap-1.5 font-mesa-mono text-xs font-semibold text-white">
          <Icone nome={iconeTempoCabecalho(barraca)} size={16} className="text-white" />
          {textoTempoCabecalho(pedido, barraca)}
        </span>
        <span className="text-sm font-bold text-white">{TEXTO_SEMAFORO[cor]}</span>
      </div>

      <div className="bg-mesa-neutral-900 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mesa-display text-2xl font-black leading-none text-white">
            #{pedido.senha}
          </span>
          {coluna === 'a_fazer' && (
            <div className="ml-auto">
              <BotaoChecklist
                onClick={() => onAbrirDetalhe(pedido)}
                contador={entreguesCount}
                total={itensParaCozinha.length}
              />
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-mesa-neutral-400">
          <Icone nome={iconeTipo} size={14} />
          {rotuloTipo}
        </div>

        {tudoEntregue && (
          <div className="mt-3 flex h-9 items-center justify-center gap-2 rounded-mesa-md bg-mesa-success-500/15">
            <Icone nome="check" size={16} peso={700} className="text-mesa-success-500" />
            <span className="text-sm font-medium text-mesa-success-500">Tudo entregue — finalizar?</span>
          </div>
        )}

        {itensAtivos.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {itensAtivos.map((item) =>
              item.entrega_direta ? (
                <LinhaItemEntregaDireta key={item.id} item={item} />
              ) : (
                <div key={item.id} className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'w-4 shrink-0 font-mesa-display text-base font-extrabold',
                      item.entregue ? 'text-mesa-success-500' : 'text-mesa-orange-500',
                    )}
                  >
                    {item.quantidade}
                  </span>
                  <span
                    className={clsx(
                      'text-sm font-medium',
                      item.entregue ? 'text-mesa-success-500 line-through' : 'text-white',
                    )}
                  >
                    {item.nome_item}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        {(pedido.observacao || itensComObservacao.length > 0) && (
          // Mostarda aqui é intencional (não mais "cor de marca nunca
          // aparece na Cozinha" — regra revista no redesign do card, ver
          // CLAUDE.md "Regras de tema"): observação vira etiqueta de
          // destaque, mesmo peso visual do botão de ação principal.
          <div className="mt-3 flex flex-col gap-1.5">
            {pedido.observacao && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-mesa-sm bg-mesa-orange-500 px-2.5 py-1.5 text-xs font-bold text-mesa-neutral-900">
                <Icone nome="sticky_note_2" size={14} peso={700} />
                {pedido.observacao}
              </span>
            )}
            {itensComObservacao.map((item) => (
              <span
                key={item.id}
                className="inline-flex w-fit items-center gap-1.5 rounded-mesa-sm bg-mesa-orange-500 px-2.5 py-1.5 text-xs font-bold text-mesa-neutral-900"
              >
                <Icone nome="sticky_note_2" size={14} peso={700} />
                {item.observacao}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex gap-3">
          {coluna === 'a_fazer' ? (
            <>
              <Button
                variant="primary"
                size="md"
                icon={<Icone nome="check" size={16} />}
                className="flex-1"
                onClick={() => onMoverParaPronto(pedido)}
              >
                Pronto
              </Button>
              <Button
                variant="outline"
                size="md"
                icon={<Icone nome="done_all" size={16} />}
                className="flex-1"
                onClick={() => onAtalhoEntregar(pedido)}
              >
                Entregar direto
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="md"
                icon={<Icone nome="undo" size={16} />}
                className="flex-1"
                onClick={() => onVoltar(pedido)}
              >
                Voltar
              </Button>
              <Button
                variant="primary"
                size="md"
                icon={<Icone nome="done_all" size={16} />}
                className="flex-1"
                onClick={() => onEntregar(pedido)}
              >
                Entregue
              </Button>
            </>
          )}
        </div>

        <div className="mt-2 flex justify-center gap-2">
          {podeImprimir && (
            <button
              type="button"
              onClick={() => void imprimirManual()}
              disabled={imprimindo}
              className="flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-mesa-neutral-300 disabled:opacity-40"
            >
              <Icone nome="print" size={14} />
              {imprimindo ? 'Imprimindo...' : 'Imprimir comanda'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onCancelar(pedido)}
            className="flex min-h-11 items-center gap-1 px-2 text-sm font-semibold text-mesa-error-500"
          >
            <Icone nome="close" size={14} />
            {coluna === 'a_fazer' ? 'Cancelar comanda' : 'Cancelar pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TEXTO_STATUS: Record<StatusConexao, string> = {
  conectado: 'Tempo real',
  reconectando: 'Reconectando',
  offline: 'Offline',
}

function BadgeStatus({ status }: { status: StatusConexao }) {
  if (status === 'conectado') {
    return (
      <Badge variant="successOutline" dot>
        {TEXTO_STATUS[status]}
      </Badge>
    )
  }
  if (status === 'offline') {
    return (
      <Badge variant="danger" dot>
        {TEXTO_STATUS[status]}
      </Badge>
    )
  }
  return (
    <Badge variant="neutral" dot className="[&>span:first-child]:animate-pulse">
      {TEXTO_STATUS[status]}
    </Badge>
  )
}

/** Últimos pedidos entregues hoje — dado real (usePedidosAtual já carrega o
 * dia inteiro, todos os status), só pra dar um retrospecto rápido de quem
 * já saiu enquanto o operador olha o que ainda falta. */
function SecaoDespachados({ pedidos }: { pedidos: PedidoComItens[] }) {
  if (pedidos.length === 0) return null

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mesa-sans text-xs font-bold uppercase tracking-wider text-mesa-text-tertiary">
          Despachados recentemente
        </h3>
        <span className="text-xs text-mesa-text-tertiary">{turnoAtual()}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {pedidos.map((pedido) => {
          const itensAtivos = pedido.itens_do_pedido.filter((i) => !i.removido)
          const resumoItens = itensAtivos
            .map((i) => `${i.nome_item}${i.quantidade > 1 ? ` (${i.quantidade}x)` : ''}`)
            .join(', ')
          return (
            <li key={pedido.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-mesa-text-secondary">
                <span className="font-mesa-display font-bold text-mesa-text-primary">
                  #{pedido.senha}
                </span>{' '}
                {pedido.viagem ? 'Viagem' : pedido.mesa ? `Mesa ${pedido.mesa}` : 'Balcão'}
                {resumoItens && ` · ${resumoItens}`}
              </span>
              <span className="shrink-0 font-mesa-display font-semibold text-xs text-mesa-text-tertiary">
                {formatarHora(pedido.entregue_em!)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Cozinha() {
  const barraca = useBarracaAtual()
  const {
    pedidos,
    status: statusConexao,
    pedidosCarregados,
    aplicarPatchPedido,
    aplicarPatchItem,
  } = usePedidosAtual()
  const { pendentes, online } = useSincronizacaoAtual()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'
  const [aba, setAba] = useState<Coluna>('a_fazer')

  const [pedidoSelecionadoId, setPedidoSelecionadoId] = useState<string | null>(null)

  const [itemParaRemover, setItemParaRemover] = useState<{
    pedido: PedidoComItens
    item: ItemDoPedido
  } | null>(null)
  const [removendoItem, setRemovendoItem] = useState(false)

  const [pedidoFinalizado, setPedidoFinalizado] = useState<PedidoComItens | null>(null)
  const faixaTimeoutRef = useRef<number | null>(null)

  const [pedidoParaCancelar, setPedidoParaCancelar] = useState<PedidoComItens | null>(null)
  const [cancelando, setCancelando] = useState(false)

  const [pedidoParaEntregaDireta, setPedidoParaEntregaDireta] = useState<PedidoComItens | null>(
    null,
  )
  const [confirmandoEntregaDireta, setConfirmandoEntregaDireta] = useState(false)

  // Relógio global: minutosDecorridos/corPorTempo são calculados em tempo de
  // render usando Date.now(). Sem isso, os cards só recalculam quando
  // `pedidos` muda por outro motivo (evento realtime, etc.) e o horário
  // exibido fica parado no valor do último render real. Um único timer aqui
  // força esse re-render — não é por card, pra não multiplicar timers.
  const [relogioTick, forcarAtualizacaoDoRelogio] = useState(0)

  useEffect(() => {
    const intervalo = window.setInterval(() => {
      forcarAtualizacaoDoRelogio((atual) => atual + 1)
    }, INTERVALO_RELOGIO_MS)

    return () => window.clearInterval(intervalo)
  }, [])

  // Alerta sonoro de atraso crítico: dispara uma vez por pedido quando ele
  // cruza pra faixa vermelha em "A Fazer" (não repete a cada tick do
  // relógio nem quando o pedido sai da lista e volta sem ter mudado de
  // faixa). idsAlertadosVermelhoRef é limpo por pedido assim que ele sai
  // de "a_fazer" — se voltar depois via "Voltar", alerta de novo se ainda
  // estiver no vermelho.
  const idsAlertadosVermelhoRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const emFazerAgoraIds = new Set(
      pedidos.filter((p) => p.status === 'a_fazer').map((p) => p.id),
    )

    for (const id of idsAlertadosVermelhoRef.current) {
      if (!emFazerAgoraIds.has(id)) idsAlertadosVermelhoRef.current.delete(id)
    }

    for (const pedido of pedidos) {
      if (pedido.status !== 'a_fazer') continue
      if (idsAlertadosVermelhoRef.current.has(pedido.id)) continue
      if (corPorTempo(minutosDecorridos(pedido), barraca) !== 'vermelho') continue

      idsAlertadosVermelhoRef.current.add(pedido.id)
      tocarSomPedidoCritico()
    }
    // relogioTick força reavaliar mesmo sem `pedidos` mudar — o atraso
    // cresce só com o tempo passando.
  }, [pedidos, relogioTick, barraca])

  // Toca só quando um pedido novo chega via realtime enquanto a tela já
  // está aberta. Espera `pedidosCarregados` (useRealtimePedidos.ts) antes
  // de registrar a primeira leitura — sem isso, `pedidos` começa vazio
  // ([]) até o fetch inicial responder, e os pedidos que já existiam
  // apareceriam de uma vez parecendo "todos novos", tocando o som toda
  // vez que a Cozinha abre ou recarrega com pedidos pendentes.
  const idsConhecidosRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!pedidosCarregados) return

    if (idsConhecidosRef.current === null) {
      idsConhecidosRef.current = new Set(pedidos.map((p) => p.id))
      return
    }

    const chegouPedidoNovo = pedidos.some(
      (p) => p.status === 'a_fazer' && !idsConhecidosRef.current?.has(p.id),
    )
    if (chegouPedidoNovo) tocarSomPedidoNaCozinha()

    idsConhecidosRef.current = new Set(pedidos.map((p) => p.id))
  }, [pedidos, pedidosCarregados])

  const pedidoSelecionado = pedidos.find((p) => p.id === pedidoSelecionadoId) ?? null

  function abrirDetalhe(pedido: PedidoComItens) {
    setPedidoSelecionadoId(pedido.id)
  }

  // Optimistic + fila offline, mesmo padrão de moverParaPronto/remover_item
  // logo abaixo: aplica local na hora, enfileira, sincroniza quando puder.
  // Sem revert síncrono no erro — a fila resolve/retenta em segundo plano
  // (Cozinha precisa funcionar offline, regra do CLAUDE.md). O realtime já
  // propaga entregue/entregue_em pra outros aparelhos de graça: a
  // assinatura de itens_do_pedido em useRealtimePedidos é `event: '*'`
  // sem filtro de coluna, então já cobre esses dois campos sem ajuste.
  async function alternarEntregueItem(pedido: PedidoComItens, item: ItemDoPedido) {
    const novoValor = !item.entregue
    const novoEntregueEm = novoValor ? new Date().toISOString() : null

    aplicarPatchItem(pedido.id, item.id, { entregue: novoValor, entregue_em: novoEntregueEm })
    await enfileirar('marcar_entregue', {
      item_id: item.id,
      entregue: novoValor,
      entregue_em: novoEntregueEm,
    })
  }

  async function moverParaPronto(pedido: PedidoComItens) {
    const agora = new Date().toISOString()
    aplicarPatchPedido(pedido.id, { status: 'pronto', pronto_em: agora })
    await enfileirar('mudar_status', { pedido_id: pedido.id, status: 'pronto', pronto_em: agora })
  }

  function moverParaProntoEFechar(pedido: PedidoComItens) {
    setPedidoSelecionadoId(null)
    moverParaPronto(pedido)
  }

  async function voltarParaFazer(pedido: PedidoComItens) {
    aplicarPatchPedido(pedido.id, { status: 'a_fazer', pronto_em: null })
    await enfileirar('mudar_status', {
      pedido_id: pedido.id,
      status: 'a_fazer',
      pronto_em: null,
    })
  }

  async function finalizarPedido(pedido: PedidoComItens) {
    if (faixaTimeoutRef.current !== null) window.clearTimeout(faixaTimeoutRef.current)
    setPedidoFinalizado(pedido)
    faixaTimeoutRef.current = window.setTimeout(() => {
      setPedidoFinalizado(null)
    }, DURACAO_FAIXA_FINALIZADO_MS)

    const agora = new Date().toISOString()
    aplicarPatchPedido(pedido.id, { status: 'entregue', entregue_em: agora })
    await enfileirar('mudar_status', {
      pedido_id: pedido.id,
      status: 'entregue',
      entregue_em: agora,
    })
  }

  async function desfazerFinalizacao() {
    if (!pedidoFinalizado) return
    const pedido = pedidoFinalizado

    if (faixaTimeoutRef.current !== null) window.clearTimeout(faixaTimeoutRef.current)
    setPedidoFinalizado(null)

    aplicarPatchPedido(pedido.id, { status: 'pronto', entregue_em: null })
    await enfileirar('mudar_status', {
      pedido_id: pedido.id,
      status: 'pronto',
      entregue_em: null,
    })
  }

  async function confirmarRemocaoItem() {
    if (!itemParaRemover) return
    const { pedido, item } = itemParaRemover
    const agora = new Date().toISOString()

    setRemovendoItem(true)
    aplicarPatchItem(pedido.id, item.id, { removido: true, removido_em: agora })
    await enfileirar('remover_item', { item_id: item.id, removido: true, removido_em: agora })

    setRemovendoItem(false)
    setItemParaRemover(null)
  }

  async function cancelarPedido(motivo: MotivoCancelamento) {
    if (!pedidoParaCancelar) return
    const pedido = pedidoParaCancelar
    const agora = new Date().toISOString()

    setCancelando(true)
    aplicarPatchPedido(pedido.id, {
      status: 'cancelado',
      motivo_cancelamento: motivo,
      cancelado_em: agora,
    })

    // mesmo padrão das outras mudanças de status: via fila offline, sem
    // reversão síncrona aqui — enfileirar não expõe um erro imediato pra
    // reverter contra (a fila resolve/retenta em segundo plano), igual
    // moverParaPronto/voltarParaFazer/finalizarPedido já fazem hoje.
    await enfileirar('mudar_status', {
      pedido_id: pedido.id,
      status: 'cancelado',
      motivo_cancelamento: motivo,
      cancelado_em: agora,
    })

    setCancelando(false)
    setPedidoParaCancelar(null)
    if (pedidoSelecionadoId === pedido.id) setPedidoSelecionadoId(null)
  }

  async function confirmarEntregaDireta() {
    if (!pedidoParaEntregaDireta) return
    const pedido = pedidoParaEntregaDireta
    const agora = new Date().toISOString()

    setConfirmandoEntregaDireta(true)
    aplicarPatchPedido(pedido.id, { status: 'entregue', pronto_em: agora, entregue_em: agora })

    // mesmo padrão de moverParaPronto/cancelarPedido: via fila offline, sem
    // reversão síncrona aqui — enfileirar não expõe um erro imediato pra
    // reverter contra (a fila resolve/retenta em segundo plano)
    await enfileirar('mudar_status', {
      pedido_id: pedido.id,
      status: 'entregue',
      pronto_em: agora,
      entregue_em: agora,
    })

    setConfirmandoEntregaDireta(false)
    setPedidoParaEntregaDireta(null)
  }

  const pedidosAFazer = pedidos.filter((p) => p.status === 'a_fazer')
  const pedidosProntos = pedidos.filter((p) => p.status === 'pronto')

  // usePedidosAtual já carrega o dia inteiro (todos os status), não só os
  // ativos — "despachados recentemente" é só filtrar por entregue, sem
  // fetch novo nenhum.
  const pedidosDespachados = useMemo(
    () =>
      pedidos
        .filter((p) => p.status === 'entregue' && p.entregue_em)
        .sort((a, b) => new Date(b.entregue_em!).getTime() - new Date(a.entregue_em!).getTime())
        .slice(0, 5),
    [pedidos],
  )

  function renderLista(lista: PedidoComItens[], coluna: Coluna) {
    if (lista.length === 0) {
      return <p className="py-8 text-center text-sm text-mesa-text-secondary">Nenhum pedido.</p>
    }
    return (
      <div className="flex flex-col gap-4">
        {lista.map((pedido) => (
          <CardPedido
            key={pedido.id}
            pedido={pedido}
            barraca={barraca}
            coluna={coluna}
            onAbrirDetalhe={abrirDetalhe}
            onMoverParaPronto={moverParaPronto}
            onVoltar={voltarParaFazer}
            onEntregar={finalizarPedido}
            onCancelar={setPedidoParaCancelar}
            onAtalhoEntregar={setPedidoParaEntregaDireta}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-mesa-bg-kanban pb-40">
      {!online && (
        <p className="border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-center text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
          Sem conexão — os pedidos serão enviados quando a rede voltar
        </p>
      )}

      <div className="flex flex-col gap-2 px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-1">
          <BotaoHome />
          <h1 className="text-2xl font-bold text-mesa-text-primary">Cozinha</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          {pendentes > 0 && (
            <Badge variant="neutral">
              {pendentes} pendente{pendentes === 1 ? '' : 's'}
            </Badge>
          )}
          <BadgeStatus status={statusConexao} />
          <button
            type="button"
            onClick={alternarTema}
            aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className={classesBotaoIcone()}
          >
            {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
          </button>
          <Link
            to={`/${barraca.slug}/historico`}
            className="flex min-h-11 items-center rounded-mesa-full bg-mesa-neutral-100 px-4 text-sm font-semibold text-mesa-text-primary dark:bg-mesa-neutral-700"
          >
            Histórico
          </Link>
        </div>
      </div>

      <div className="px-4 pb-4 md:hidden">
        <SegmentedControl
          aria-label="Colunas da cozinha"
          items={[
            { label: 'A Fazer', count: pedidosAFazer.length, icon: <Icone nome="skillet" size={16} /> },
            { label: 'Pronto', count: pedidosProntos.length, icon: <Icone nome="check_circle" size={16} /> },
          ]}
          activeIndex={aba === 'a_fazer' ? 0 : 1}
          onChange={(indice) => setAba(indice === 0 ? 'a_fazer' : 'pronto')}
        />
      </div>

      <div className="px-4 md:hidden">
        {renderLista(aba === 'a_fazer' ? pedidosAFazer : pedidosProntos, aba)}
        {aba === 'pronto' && (
          <>
            <p className="mt-6 text-center text-sm text-mesa-text-secondary">
              O cronômetro congela ao entrar em Pronto — a cor não muda mais, o pedido só espera o
              cliente
            </p>
            <SecaoDespachados pedidos={pedidosDespachados} />
          </>
        )}
      </div>

      <div className="hidden gap-6 px-6 md:grid md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-lg font-bold text-mesa-text-primary">
            A Fazer ({pedidosAFazer.length})
          </h2>
          {renderLista(pedidosAFazer, 'a_fazer')}
        </div>
        <div>
          <h2 className="mb-4 text-lg font-bold text-mesa-text-primary">
            Pronto ({pedidosProntos.length})
          </h2>
          {renderLista(pedidosProntos, 'pronto')}
          <p className="mt-6 text-center text-sm text-mesa-text-secondary">
            O cronômetro congela ao entrar em Pronto — a cor não muda mais, o pedido só espera o
            cliente
          </p>
          <SecaoDespachados pedidos={pedidosDespachados} />
        </div>
      </div>

      <DetalheComanda
        pedido={pedidoSelecionado}
        barraca={barraca}
        onFechar={() => setPedidoSelecionadoId(null)}
        onAlternarEntregue={(item) => {
          if (pedidoSelecionado) alternarEntregueItem(pedidoSelecionado, item)
        }}
        onSolicitarRemocaoItem={(item) => {
          if (pedidoSelecionado) setItemParaRemover({ pedido: pedidoSelecionado, item })
        }}
        onMoverParaPronto={moverParaProntoEFechar}
        onCancelar={setPedidoParaCancelar}
      />

      {/* Sheet empilhado sobre o DetalheComanda — o primitivo já isola qual
          dos dois responde ao Esc (ver correção em ui/BottomSheet.tsx). */}
      <BottomSheet
        open={itemParaRemover !== null}
        onClose={() => setItemParaRemover(null)}
        aria-label="Confirmar remoção de item"
      >
        {itemParaRemover && (
          <>
            <h2 className="text-lg font-semibold text-mesa-text-primary">
              Remover {itemParaRemover.item.nome_item} do pedido?
            </h2>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              Pedido {itemParaRemover.pedido.senha} · essa ação não pode ser desfeita.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                variant="destructive"
                size="xl"
                loading={removendoItem}
                onClick={confirmarRemocaoItem}
                className="w-full"
              >
                Remover
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => setItemParaRemover(null)}
                className="w-full"
              >
                Cancelar
              </Button>
            </div>
          </>
        )}
      </BottomSheet>

      {pedidoFinalizado && (
        <div className="fixed inset-x-0 bottom-16 z-40 flex items-center justify-between gap-4 bg-mesa-neutral-800 px-6 py-4">
          <span className="text-base font-medium text-white">
            Pedido {pedidoFinalizado.senha} finalizado
          </span>
          {/* Banner sempre escuro (bg-mesa-neutral-800 fixo, não segue o tema),
              então usa botão local com texto branco fixo em vez do Button
              ghost — a variante ghost usa text-mesa-text-primary (escuro no
              claro), e sobrepor com className é a mesma corrida de
              especificidade que já corrigimos no Input na Fase 3. */}
          <button
            type="button"
            onClick={desfazerFinalizacao}
            className="min-h-11 shrink-0 rounded-mesa-md px-3 text-base font-semibold text-white outline-none"
          >
            Desfazer
          </button>
        </div>
      )}

      {pedidoParaCancelar && (
        <ModalCancelamento
          pedido={pedidoParaCancelar}
          cancelando={cancelando}
          onFechar={() => setPedidoParaCancelar(null)}
          onConfirmar={cancelarPedido}
        />
      )}

      {pedidoParaEntregaDireta && (
        <ModalEntregaDireta
          senha={pedidoParaEntregaDireta.senha}
          confirmando={confirmandoEntregaDireta}
          onFechar={() => setPedidoParaEntregaDireta(null)}
          onConfirmar={confirmarEntregaDireta}
        />
      )}
    </div>
  )
}
