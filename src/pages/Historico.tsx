import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { MOTIVOS_CANCELAMENTO } from '../lib/cancelamento'
import { formatarPrecoBR } from '../lib/preco'
import { ROTULO_MODO, rotuloAtendimento, tipoDoPedido } from '../lib/atendimento'
import { corMetodo, humanizarMetodo, METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import { hojeISO } from '../lib/datas'
import { calcularIntervalosRelatorio, calcularTotalPedido, ehEntregaDireta } from '../lib/relatorio'
import { useOcultarAoRolar } from '../hooks/useOcultarAoRolar'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import type { TipoFiltroRelatorio } from '../lib/relatorio'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { Badge } from '../components/ui/Badge'
import { BotaoHome } from '../components/ui/BotaoHome'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useToast } from '../components/ui/Toast'
import type { Item, PedidoComItens } from '../types/database'

function motivoHumanizado(motivo: string | null): string {
  return MOTIVOS_CANCELAMENTO.find((m) => m.valor === motivo)?.rotulo ?? motivo ?? 'não informado'
}

function RotuloMetodo({ chave }: { chave: string | null }) {
  const metodo = METODOS_DISPONIVEIS.find((m) => m.chave === chave)
  if (!metodo) return <>{humanizarMetodo(chave)}</>
  return (
    <span className="inline-flex items-center gap-1">
      <Icone nome={metodo.icone} size={14} />
      {metodo.label}
    </span>
  )
}

const PERIODOS: { valor: TipoFiltroRelatorio; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7dias', rotulo: '7 dias' },
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'intervalo', rotulo: 'Período' },
]

type TipoConsumo = 'todos' | 'mesa' | 'retirada' | 'entrega'

const ROTULO_FILTRO_CONSUMO: Record<TipoConsumo, string> = {
  todos: 'Todos',
  mesa: 'No local',
  retirada: 'Retirada',
  entrega: 'Entrega',
}

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatarDataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${ano}`
}

function minutosEntre(inicioIso: string, fimIso: string): number {
  return Math.round((new Date(fimIso).getTime() - new Date(inicioIso).getTime()) / 60000)
}

const COR_CABECALHO = 'FFFFC21A' // mesa-orange-500 (Sai aê / mostarda)
const COR_FUNDO_CANCELADO = 'FFFEF2F2' // mesa-error-50
const COR_TEXTO_CANCELADO = 'FFB91C1C' // mesa-error-700

async function gerarPlanilha(pedidos: PedidoComItens[]): Promise<ArrayBuffer> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const planilha = workbook.addWorksheet('Histórico')

  planilha.columns = [
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Senha', key: 'senha', width: 8 },
    { header: 'Mesa', key: 'mesa', width: 10 },
    { header: 'Viagem', key: 'viagem', width: 9 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Observação', key: 'observacao', width: 28 },
    { header: 'Itens', key: 'itens', width: 40 },
    { header: 'Entrada', key: 'entrada', width: 10 },
    { header: 'Finalização', key: 'finalizacao', width: 12 },
    { header: 'Tempo total (min)', key: 'tempo', width: 16 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Taxa de entrega', key: 'taxaEntrega', width: 16 },
  ]

  const linhaCabecalho = planilha.getRow(1)
  // Mostarda é clara demais pra sustentar texto branco (regra da IDV
  // "Sai aê": texto sobre mostarda é sempre tinta).
  linhaCabecalho.font = { bold: true, color: { argb: 'FF18171C' } }
  linhaCabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } }
  linhaCabecalho.alignment = { vertical: 'middle' }
  linhaCabecalho.height = 20
  planilha.views = [{ state: 'frozen', ySplit: 1 }]
  planilha.autoFilter = { from: 'A1', to: 'L1' }

  for (const pedido of pedidos) {
    const itensTexto = pedido.itens_do_pedido
      .filter((item) => !item.removido)
      .map((item) => `${item.quantidade}x ${item.nome_item}`)
      .join(', ')

    const cancelado = pedido.status === 'cancelado'

    const linha = planilha.addRow({
      data: formatarDataCurta(pedido.data_operacao),
      senha: pedido.senha,
      mesa: pedido.mesa ?? '',
      viagem: pedido.viagem ? 'Sim' : 'Não',
      status: rotuloStatus(pedido.status),
      observacao: pedido.observacao ?? '',
      itens: itensTexto,
      entrada: formatarHora(pedido.criado_em),
      finalizacao: pedido.entregue_em ? formatarHora(pedido.entregue_em) : '',
      tempo: pedido.entregue_em ? minutosEntre(pedido.criado_em, pedido.entregue_em) : '',
      tipo: ROTULO_MODO[tipoDoPedido(pedido)],
      taxaEntrega: (pedido.taxa_entrega_centavos ?? 0) > 0 ? formatarPrecoBR(pedido.taxa_entrega_centavos ?? 0) : '',
    })

    linha.alignment = { vertical: 'middle', wrapText: false }

    if (cancelado) {
      linha.eachCell((celula) => {
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_FUNDO_CANCELADO } }
        celula.font = { color: { argb: COR_TEXTO_CANCELADO } }
      })
    }
  }

  return workbook.xlsx.writeBuffer()
}

function rotuloStatus(status: PedidoComItens['status']): string {
  if (status === 'cancelado') return 'Cancelado'
  if (status === 'entregue') return 'Entregue'
  if (status === 'pronto') return 'Pronto'
  return 'Em preparo'
}

function ordenarPorEntregueEmDesc(lista: PedidoComItens[]): PedidoComItens[] {
  return [...lista].sort((a, b) => {
    const finalizacaoA = a.entregue_em ?? a.cancelado_em ?? a.criado_em
    const finalizacaoB = b.entregue_em ?? b.cancelado_em ?? b.criado_em
    const tempoA = finalizacaoA ? new Date(finalizacaoA).getTime() : 0
    const tempoB = finalizacaoB ? new Date(finalizacaoB).getTime() : 0
    return tempoB - tempoA
  })
}

function BotaoEmitirNota({ pedido }: { pedido: PedidoComItens }) {
  const [status, setStatus] = useState(pedido.nfce_status)
  const [mensagem, setMensagem] = useState(pedido.nfce_mensagem)
  const [chave, setChave] = useState(pedido.nfce_chave)
  const [emitindo, setEmitindo] = useState(false)
  const { mostrarToast } = useToast()

  async function emitir() {
    setEmitindo(true)
    setMensagem(null)

    const { data, error } = await supabase.functions.invoke('emitir-nfce', {
      body: { pedido_id: pedido.id },
    })

    setEmitindo(false)

    if (error) {
      const corpo = await error.context?.json?.().catch(() => null)
      const erroMsg = corpo?.erro ?? 'Não foi possível emitir. Tente novamente.'
      setStatus('erro')
      setMensagem(erroMsg)
      mostrarToast(erroMsg, { variante: 'erro' })
      return
    }

    const statusRecebido = data?.status ?? 'erro'
    setStatus(statusRecebido)
    setMensagem(data?.mensagem ?? data?.erro ?? null)
    setChave(data?.chave ?? null)

    if (statusRecebido === 'autorizado') {
      mostrarToast('Nota fiscal emitida.', { variante: 'sucesso' })
    } else {
      mostrarToast(data?.mensagem ?? data?.erro ?? 'Não foi possível emitir a nota.', { variante: 'erro' })
    }
  }

  if (status === 'autorizado') {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-mesa-success-700 dark:text-mesa-success-500">
        <Icone nome="task_alt" size={14} />
        Nota fiscal emitida{chave ? ` — final ${chave.slice(-8)}` : ''}
      </p>
    )
  }

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" loading={emitindo} onClick={emitir}>
        {status === 'erro' ? 'Tentar emitir nota de novo' : 'Emitir nota fiscal'}
      </Button>
      {status === 'erro' && mensagem && (
        <p className="mt-1.5 text-xs text-mesa-error-500">{mensagem}</p>
      )}
    </div>
  )
}

function CardHistorico({
  pedido,
  onRestaurar,
}: {
  pedido: PedidoComItens
  onRestaurar: (pedido: PedidoComItens) => void
}) {
  const tempoTotal = pedido.entregue_em ? minutosEntre(pedido.criado_em, pedido.entregue_em) : null
  const cancelado = pedido.status === 'cancelado'
  const itensAtivos = pedido.itens_do_pedido.filter((item) => !item.removido)

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mesa-display text-2xl font-black leading-none text-mesa-text-tertiary">
            {pedido.senha}
          </p>
          <p
            className={
              cancelado
                ? 'mt-1.5 font-mesa-display text-base font-semibold text-mesa-text-tertiary line-through'
                : 'mt-1.5 font-mesa-display text-base font-semibold text-mesa-text-primary'
            }
          >
            {formatarPrecoBR(calcularTotalPedido(pedido))}
          </p>
          {(pedido.viagem || pedido.mesa) && (
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {rotuloAtendimento(pedido)}
            </p>
          )}
          {(pedido.taxa_entrega_centavos ?? 0) > 0 && (
            <p className="text-xs text-mesa-text-tertiary">
              + {formatarPrecoBR(pedido.taxa_entrega_centavos ?? 0)} de taxa de entrega
            </p>
          )}
        </div>
        <div className="text-right text-sm text-mesa-text-secondary">
          <p>Entrada {formatarHora(pedido.criado_em)}</p>
          <p className="font-semibold text-mesa-text-primary">
            {tempoTotal !== null ? `${tempoTotal} min de preparo` : '—'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {cancelado ? (
          <Badge variant="danger">CANCELADO</Badge>
        ) : (
          <Badge variant="neutral">{rotuloStatus(pedido.status).toUpperCase()}</Badge>
        )}
        {!cancelado && ehEntregaDireta(pedido) && <Badge variant="neutral">Entrega direta</Badge>}
        {/* corMetodo() já devolve um par bg/texto completo (cor dinâmica por
            método) — não passa por Badge pra não competir com as classes de
            variant do próprio primitivo (mesma race de especificidade que já
            corrigimos no Input). Mesmo formato visual (pill, texto pequeno). */}
        <span
          className={`inline-flex items-center rounded-mesa-balao px-3 py-1 text-xs font-medium ${corMetodo(pedido.metodo_pagamento)}`}
        >
          <RotuloMetodo chave={pedido.metodo_pagamento} />
        </span>
      </div>

      {cancelado && (
        <p className="mt-2 text-xs text-mesa-text-secondary">
          Motivo: {motivoHumanizado(pedido.motivo_cancelamento)}
        </p>
      )}

      {pedido.observacao && (
        <p className="mt-3 rounded-mesa-md bg-mesa-neutral-100 p-3 text-sm text-mesa-text-primary dark:bg-mesa-neutral-700">
          {pedido.observacao}
        </p>
      )}

      {itensAtivos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {itensAtivos.map((item) => (
            <Chip key={item.id} variant="plain">
              {item.quantidade}× {item.nome_item}
              {item.observacao && ` (${item.observacao})`}
            </Chip>
          ))}
        </div>
      )}

      {!cancelado && <BotaoEmitirNota pedido={pedido} />}

      {pedido.status === 'entregue' && (
        <Button
          variant="outline"
          size="md"
          onClick={() => onRestaurar(pedido)}
          className="mt-4 w-full"
        >
          Restaurar
        </Button>
      )}
    </Card>
  )
}

export function Historico() {
  const barraca = useBarracaAtual()
  const [filtrosEscondidos, esconderFiltros, exibirFiltros] = useOcultarAoRolar()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  // Plano Essencial: histórico de 7 dias e sem exportar (as outras
  // diferenças de src/lib/planos.ts, gap fechado em 2026-09-26 — trial
  // sempre nasce plano 'pro', então nunca cai nessa restrição).
  const { assinatura } = useAssinaturaBarraca(barraca.slug)
  const planoEssencial = assinatura?.plano === 'essencial'
  const periodosDisponiveis = planoEssencial
    ? PERIODOS.filter((p) => p.valor !== 'mes' && p.valor !== 'intervalo')
    : PERIODOS

  const [pedidos, setPedidos] = useState<PedidoComItens[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [periodo, setPeriodo] = useState<TipoFiltroRelatorio>('hoje')
  const [dataInicio, setDataInicio] = useState(hojeISO())
  const [dataFim, setDataFim] = useState(hojeISO())
  const [busca, setBusca] = useState('')
  const [tipoConsumo, setTipoConsumo] = useState<TipoConsumo>('todos')
  const [metodoFiltrado, setMetodoFiltrado] = useState<string | null>(null)

  const [itensCardapio, setItensCardapio] = useState<Item[]>([])
  const [itemFiltradoId, setItemFiltradoId] = useState<string | null>(null)

  const [mostrarConfirmacaoExclusao, setMostrarConfirmacaoExclusao] = useState(false)
  const [apagando, setApagando] = useState(false)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  // Derivado, não guardado em state: cobre o período rebaixar sozinho se a
  // assinatura ainda estava carregando quando o usuário escolheu Mês/
  // Período (só possível nessa janela, já que periodosDisponiveis já
  // esconde essas opções assim que planoEssencial é true).
  const periodoEfetivo =
    planoEssencial && (periodo === 'mes' || periodo === 'intervalo') ? '7dias' : periodo

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)

    const intervalo = calcularIntervalosRelatorio({ tipo: periodoEfetivo, dataInicio, dataFim }).atual

    supabase
      .from('pedidos')
      .select('*, itens_do_pedido(*)')
      .eq('barraca_id', barraca.id)
      .gte('data_operacao', intervalo.inicio)
      .lte('data_operacao', intervalo.fim)
      .order('criado_em', { ascending: false })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setErro(error.message)
        } else {
          setErro(null)
          // ordena no cliente (entregue_em ou cancelado_em, o que existir) —
          // um ORDER BY entregue_em no servidor jogaria os cancelados (que
          // não têm entregue_em) todos pro topo por causa do NULLS FIRST
          // padrão do Postgres em DESC, fora de ordem cronológica real
          setPedidos(ordenarPorEntregueEmDesc((data ?? []) as PedidoComItens[]))
        }
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id, periodoEfetivo, dataInicio, dataFim])

  useEffect(() => {
    let cancelado = false

    supabase
      .from('itens')
      .select('*')
      .eq('barraca_id', barraca.id)
      .eq('ativo', true)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado || error) return
        setItensCardapio((data ?? []) as Item[])
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  const pedidosDoPeriodo = pedidos
  const pedidosDoPeriodoComItemFiltrado = itemFiltradoId
    ? pedidosDoPeriodo.filter((p) =>
        p.itens_do_pedido.some((item) => !item.removido && item.item_id === itemFiltradoId),
      )
    : pedidosDoPeriodo

  const pedidosPorConsumo =
    tipoConsumo === 'todos'
      ? pedidosDoPeriodoComItemFiltrado
      : pedidosDoPeriodoComItemFiltrado.filter((p) =>
          tipoConsumo === 'mesa' ? !p.viagem : tipoDoPedido(p) === tipoConsumo,
        )

  const pedidosPorMetodo = metodoFiltrado
    ? pedidosPorConsumo.filter((p) => p.metodo_pagamento === metodoFiltrado)
    : pedidosPorConsumo

  const buscaNormalizada = busca.trim().toLowerCase()
  const pedidosExibidos = buscaNormalizada
    ? pedidosPorMetodo.filter(
        (p) =>
          String(p.senha).includes(buscaNormalizada) ||
          (p.mesa ?? '').toLowerCase().includes(buscaNormalizada),
      )
    : pedidosPorMetodo

  // Só filtros ALÉM do período contam aqui — o período em si (Hoje/7
  // dias/Mês/...) já define o que "apagar período" apaga por padrão.
  const temFiltroAtivo = Boolean(
    itemFiltradoId || tipoConsumo !== 'todos' || metodoFiltrado || buscaNormalizada,
  )

  const intervaloAtual = calcularIntervalosRelatorio({ tipo: periodoEfetivo, dataInicio, dataFim }).atual

  async function restaurarPedido(pedido: PedidoComItens) {
    setPedidos((atual) => atual.filter((p) => p.id !== pedido.id))

    const { error } = await supabase
      .from('pedidos')
      .update({
        status: 'a_fazer',
        pronto_em: null,
        entregue_em: null,
        cancelado_em: null,
        motivo_cancelamento: null,
      })
      .eq('id', pedido.id)

    if (error) {
      setPedidos((atual) => ordenarPorEntregueEmDesc([...atual, pedido]))
    }
  }

  async function exportarPlanilha() {
    setExportando(true)
    const buffer = await gerarPlanilha(pedidosExibidos)
    setExportando(false)

    const nomePeriodo =
      intervaloAtual.inicio === intervaloAtual.fim
        ? intervaloAtual.inicio
        : `${intervaloAtual.inicio}_a_${intervaloAtual.fim}`

    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `historico-${barraca.slug}-${nomePeriodo}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function apagarPeriodo() {
    const ids = pedidosExibidos.map((p) => p.id)
    if (ids.length === 0) {
      setMostrarConfirmacaoExclusao(false)
      return
    }

    setApagando(true)
    setErroExclusao(null)

    const { error: erroItens } = await supabase
      .from('itens_do_pedido')
      .delete()
      .in('pedido_id', ids)

    if (erroItens) {
      setErroExclusao('Não foi possível apagar os pedidos. Tente novamente.')
      setApagando(false)
      return
    }

    const { error: erroPedidos } = await supabase.from('pedidos').delete().in('id', ids)

    if (erroPedidos) {
      setErroExclusao('Não foi possível apagar os pedidos. Tente novamente.')
      setApagando(false)
      return
    }

    const idsApagados = new Set(ids)
    setPedidos((atual) => atual.filter((p) => !idsApagados.has(p.id)))
    setApagando(false)
    setMostrarConfirmacaoExclusao(false)
  }

  return (
    <GateSenhaAdmin key={barraca.id} barracaId={barraca.id} slug={barraca.slug}>
    <div className="min-h-dvh pb-24">
      <div
        className={`sticky top-0 z-[var(--mesa-z-sticky)] bg-mesa-surface px-6 pt-[calc(env(safe-area-inset-top)+16px)] pb-4 shadow-mesa-1 transition-transform duration-300 ${
          filtrosEscondidos ? '-translate-y-full pointer-events-none' : 'translate-y-0'
        }`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-2">
            <BotaoHome />
            <h1 className="text-2xl font-bold leading-tight text-mesa-text-primary">Histórico</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <button
              type="button"
              onClick={alternarTema}
              aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className={classesBotaoIcone()}
            >
              {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
            </button>
            <button
              type="button"
              onClick={esconderFiltros}
              aria-label="Ocultar barra de filtros"
              className={classesBotaoIcone()}
            >
              <Icone nome="expand_less" size={20} />
            </button>
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="download" size={16} />}
              onClick={exportarPlanilha}
              disabled={pedidosExibidos.length === 0 || planoEssencial}
              loading={exportando}
              title={planoEssencial ? 'Exportar relatórios é exclusivo do plano Pro' : undefined}
            >
              Exportar
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <SegmentedControl
            aria-label="Período do histórico"
            items={periodosDisponiveis.map((p) => ({ label: p.rotulo }))}
            activeIndex={periodosDisponiveis.findIndex((p) => p.valor === periodo)}
            onChange={(indice) => setPeriodo(periodosDisponiveis[indice].valor)}
          />
          {planoEssencial && (
            <p className="mt-1.5 text-xs text-mesa-text-tertiary">
              Plano Essencial mostra até 7 dias — o Pro libera o histórico completo.
            </p>
          )}
        </div>

        {periodoEfetivo === 'intervalo' && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              value={dataInicio}
              max={dataFim}
              onChange={(e) => setDataInicio(e.target.value)}
              aria-label="Data de início"
              className="h-10 min-w-0 flex-1 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
            />
            <span className="text-sm text-mesa-text-secondary">até</span>
            <input
              type="date"
              value={dataFim}
              min={dataInicio}
              max={hojeISO()}
              onChange={(e) => setDataFim(e.target.value)}
              aria-label="Data de fim"
              className="h-10 min-w-0 flex-1 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
            />
          </div>
        )}

        <select
          value={itemFiltradoId ?? ''}
          onChange={(e) => setItemFiltradoId(e.target.value || null)}
          className="mt-3 h-12 w-full rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-4 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
        >
          <option value="">Todos os produtos</option>
          {itensCardapio.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </select>

        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onClear={() => setBusca('')}
          placeholder="Buscar por senha ou mesa"
          aria-label="Buscar por senha ou mesa"
          className="mt-3"
        />

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['todos', 'mesa', 'retirada', 'entrega'] as const).map((valor) => (
            <Chip
              key={valor}
              variant={tipoConsumo === valor ? 'teal' : 'plain'}
              checked={tipoConsumo === valor}
              onClick={() => setTipoConsumo(valor)}
            >
              {ROTULO_FILTRO_CONSUMO[valor]}
            </Chip>
          ))}
          <span className="mx-1 self-center text-mesa-text-tertiary" aria-hidden>
            ·
          </span>
          <Chip
            variant={metodoFiltrado === null ? 'teal' : 'plain'}
            checked={metodoFiltrado === null}
            onClick={() => setMetodoFiltrado(null)}
          >
            Qualquer método
          </Chip>
          {METODOS_DISPONIVEIS.filter((m) => barraca.metodos_pagamento_ativos?.includes(m.chave)).map(
            (metodo) => (
              <Chip
                key={metodo.chave}
                variant={metodoFiltrado === metodo.chave ? 'teal' : 'plain'}
                checked={metodoFiltrado === metodo.chave}
                onClick={() => setMetodoFiltrado(metodo.chave)}
              >
                <span className="inline-flex items-center gap-1">
                  <Icone nome={metodo.icone} size={14} />
                  {metodo.label}
                </span>
              </Chip>
            ),
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mesa-text-secondary">
            {pedidosExibidos.length} comanda{pedidosExibidos.length === 1 ? '' : 's'} no período
          </p>
          <button
            type="button"
            onClick={() => setMostrarConfirmacaoExclusao(true)}
            disabled={pedidosExibidos.length === 0}
            className="flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-mesa-error-500 disabled:opacity-40"
          >
            <Icone nome="delete" size={16} />
            Apagar período
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={exibirFiltros}
        aria-label="Exibir barra de filtros"
        className={`fixed left-1/2 z-[var(--mesa-z-sticky)] flex items-center gap-1.5 rounded-mesa-full bg-mesa-surface px-4 py-2 text-sm font-semibold text-mesa-text-primary shadow-mesa-2 outline-none transition-all duration-300 ${
          filtrosEscondidos
            ? 'top-[calc(env(safe-area-inset-top)+12px)] -translate-x-1/2 opacity-100'
            : 'pointer-events-none -top-16 -translate-x-1/2 opacity-0'
        }`}
      >
        <Icone nome="expand_more" size={16} />
        Filtros
      </button>

      <div className="px-6 pt-4">
        {carregando && (
          <p className="py-8 text-center text-sm text-mesa-text-secondary">Carregando...</p>
        )}

        {!carregando && erro && (
          <p className="py-8 text-center text-sm text-mesa-error-500">
            Não foi possível carregar o histórico.
          </p>
        )}

        {!carregando && !erro && pedidosExibidos.length === 0 && (
          <p className="py-8 text-center text-sm text-mesa-text-secondary">
            Nenhuma comanda no período.
          </p>
        )}

        {!carregando && !erro && pedidosExibidos.length > 0 && (
          <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start md:gap-4 xl:grid-cols-3">
            {pedidosExibidos.map((pedido) => (
              <CardHistorico key={pedido.id} pedido={pedido} onRestaurar={restaurarPedido} />
            ))}
          </div>
        )}
      </div>

      <BottomSheet
        open={mostrarConfirmacaoExclusao}
        onClose={() => {
          setMostrarConfirmacaoExclusao(false)
          setErroExclusao(null)
        }}
        aria-label="Confirmar exclusão do período"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">
          Apagar {pedidosExibidos.length} pedido{pedidosExibidos.length === 1 ? '' : 's'}
          {temFiltroAtivo ? ' filtrado' : ' do período selecionado'}
          {temFiltroAtivo && pedidosExibidos.length !== 1 ? 's' : ''}?
        </h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          {temFiltroAtivo
            ? 'Só os pedidos que atendem aos filtros ativos serão apagados. '
            : ''}
          Esta ação não pode ser desfeita.
        </p>

        {erroExclusao && <p className="mt-2 text-sm text-mesa-error-500">{erroExclusao}</p>}

        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="xl"
            loading={apagando}
            onClick={apagarPeriodo}
            className="w-full"
          >
            Apagar definitivamente
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              setMostrarConfirmacaoExclusao(false)
              setErroExclusao(null)
            }}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>
    </div>
    </GateSenhaAdmin>
  )
}
