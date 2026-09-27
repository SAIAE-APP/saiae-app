import { useEffect, useRef, useState } from 'react'
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { ItemDoPedido, Pedido } from '../types/database'

export type PedidoComItens = Pedido & { itens_do_pedido: ItemDoPedido[] }
export type StatusConexao = 'conectado' | 'reconectando' | 'offline'

const PRAZO_DESISTENCIA_MS = 10000
const INTERVALO_POLLING_FALLBACK_MS = 10000

function dataOperacaoAtual(): string {
  const agora = new Date()
  const ano = agora.getFullYear()
  const mes = String(agora.getMonth() + 1).padStart(2, '0')
  const dia = String(agora.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

function ordenarPorCriadoEm(lista: PedidoComItens[]): PedidoComItens[] {
  return [...lista].sort(
    (a, b) => new Date(a.criado_em).getTime() - new Date(b.criado_em).getTime(),
  )
}

/**
 * Mantém a lista de pedidos do dia atual sincronizada via Supabase Realtime.
 * itens_do_pedido ganhou barraca_id em 2026-09-27 (ver migração
 * 20260927120000_add_barraca_id_itens_pedido.sql) justamente pra permitir
 * o filtro abaixo — antes disso, toda mudança de item de QUALQUER barraca
 * era transmitida pra todo cliente conectado no sistema inteiro.
 */
const JANELA_IGNORAR_ECO_MS = 4000

export function useRealtimePedidos(barracaId: string) {
  const [pedidos, setPedidos] = useState<PedidoComItens[]>([])
  const [status, setStatus] = useState<StatusConexao>('reconectando')
  // Sinal explícito de "o primeiro snapshot de verdade já chegou" — sem
  // isso, quem consome esse hook não tem como distinguir "pedidos: []
  // porque não há pedidos" de "pedidos: [] porque o fetch inicial ainda
  // não voltou" (ex.: pra não tocar som de novidade em pedidos que já
  // existiam antes da tela abrir).
  const [pedidosCarregados, setPedidosCarregados] = useState(false)

  // Um patch otimista local (aplicarPatchPedido/aplicarPatchItem) pode ser
  // seguido por um segundo patch antes do eco do PRIMEIRO voltar via
  // realtime (ex.: marcar e desmarcar um item rápido, em sequência). Sem
  // isso, o eco atrasado do primeiro patch sobrescreve o estado local mais
  // recente do segundo, mesmo com o banco já correto — a UI mostra um
  // valor errado enquanto o banco tem o certo. Ignoramos ecos que chegam
  // dentro da janela após uma escrita local naquele id específico.
  const ignorarEcoPedidoRef = useRef<Map<string, number>>(new Map())
  const ignorarEcoItemRef = useRef<Map<string, number>>(new Map())

  function aplicarPatchPedido(id: string, patch: Partial<Pedido>) {
    ignorarEcoPedidoRef.current.set(id, Date.now() + JANELA_IGNORAR_ECO_MS)
    setPedidos((atual) => atual.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function aplicarPatchItem(pedidoId: string, itemId: string, patch: Partial<ItemDoPedido>) {
    ignorarEcoItemRef.current.set(itemId, Date.now() + JANELA_IGNORAR_ECO_MS)
    setPedidos((atual) =>
      atual.map((p) =>
        p.id === pedidoId
          ? {
              ...p,
              itens_do_pedido: p.itens_do_pedido.map((i) =>
                i.id === itemId ? { ...i, ...patch } : i,
              ),
            }
          : p,
      ),
    )
  }

  useEffect(() => {
    let cancelado = false
    let canal: RealtimeChannel | null = null
    let timerDesistencia: number | null = null
    let intervaloPolling: number | null = null
    let emFallback = false

    async function buscarTudo() {
      const { data, error } = await supabase
        .from('pedidos')
        .select('*, itens_do_pedido(*)')
        .eq('barraca_id', barracaId)
        .eq('data_operacao', dataOperacaoAtual())
        .order('criado_em', { ascending: true })

      if (cancelado || error) return
      setPedidos((data ?? []) as PedidoComItens[])
      setPedidosCarregados(true)
    }

    function pararFallback() {
      if (intervaloPolling !== null) {
        window.clearInterval(intervaloPolling)
        intervaloPolling = null
      }
      emFallback = false
    }

    function iniciarFallback() {
      if (emFallback) return
      emFallback = true
      setStatus('offline')
      buscarTudo()
      intervaloPolling = window.setInterval(buscarTudo, INTERVALO_POLLING_FALLBACK_MS)
    }

    function limparTimerDesistencia() {
      if (timerDesistencia !== null) {
        window.clearTimeout(timerDesistencia)
        timerDesistencia = null
      }
    }

    async function aoMudarPedido(
      tipo: 'INSERT' | 'UPDATE' | 'DELETE',
      novo: Pedido | null,
      antigo: Pedido | null,
    ) {
      if (tipo === 'DELETE') {
        if (!antigo) return
        setPedidos((atual) => atual.filter((p) => p.id !== antigo.id))
        return
      }

      if (!novo) return

      if (tipo === 'INSERT') {
        const { data: itensNovos } = await supabase
          .from('itens_do_pedido')
          .select('*')
          .eq('pedido_id', novo.id)

        if (cancelado) return

        setPedidos((atual) => {
          if (atual.some((p) => p.id === novo.id)) return atual
          const comItens: PedidoComItens = {
            ...novo,
            itens_do_pedido: (itensNovos ?? []) as ItemDoPedido[],
          }
          return ordenarPorCriadoEm([...atual, comItens])
        })
        return
      }

      const ignorarAte = ignorarEcoPedidoRef.current.get(novo.id) ?? 0
      if (Date.now() < ignorarAte) return

      setPedidos((atual) => atual.map((p) => (p.id === novo.id ? { ...p, ...novo } : p)))
    }

    function aoMudarItem(
      tipo: 'INSERT' | 'UPDATE' | 'DELETE',
      novo: ItemDoPedido | null,
      antigo: ItemDoPedido | null,
    ) {
      // itens novos chegam junto do pedido em aoMudarPedido (INSERT)
      if (tipo === 'INSERT') return

      const pedidoId = novo?.pedido_id ?? antigo?.pedido_id
      if (!pedidoId) return

      const idItem = novo?.id ?? antigo?.id
      const ignorarAte = (idItem ? ignorarEcoItemRef.current.get(idItem) : undefined) ?? 0
      if (Date.now() < ignorarAte) return

      setPedidos((atual) => {
        const indice = atual.findIndex((p) => p.id === pedidoId)
        if (indice === -1) return atual

        const pedido = atual[indice]
        const itensAtualizados =
          tipo === 'DELETE'
            ? pedido.itens_do_pedido.filter((i) => i.id !== antigo?.id)
            : pedido.itens_do_pedido.map((i) => (i.id === novo?.id ? { ...i, ...novo } : i))

        const copia = [...atual]
        copia[indice] = { ...pedido, itens_do_pedido: itensAtualizados }
        return copia
      })
    }

    function conectar() {
      canal = supabase
        .channel(`pedidos-${barracaId}`)
        .on<Pedido>(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pedidos', filter: `barraca_id=eq.${barracaId}` },
          (payload) => {
            const novo = 'id' in payload.new ? payload.new : null
            const antigo = 'id' in payload.old ? (payload.old as Pedido) : null
            aoMudarPedido(payload.eventType, novo, antigo)
          },
        )
        .on<ItemDoPedido>(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'itens_do_pedido',
            filter: `barraca_id=eq.${barracaId}`,
          },
          (payload) => {
            const novo = 'id' in payload.new ? payload.new : null
            const antigo = 'id' in payload.old ? (payload.old as ItemDoPedido) : null
            aoMudarItem(payload.eventType, novo, antigo)
          },
        )
        .subscribe((novoStatus) => {
          if (cancelado) return

          if (novoStatus === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            limparTimerDesistencia()
            pararFallback()
            setStatus('conectado')
            buscarTudo()
            return
          }

          if (
            novoStatus === REALTIME_SUBSCRIBE_STATES.CLOSED ||
            novoStatus === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
            novoStatus === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
          ) {
            if (!emFallback) setStatus('reconectando')
            armarDesistencia()
          }
        })
    }

    function armarDesistencia() {
      if (timerDesistencia !== null) return
      timerDesistencia = window.setTimeout(iniciarFallback, PRAZO_DESISTENCIA_MS)
    }

    // o WebSocket pode demorar a perceber que a conexão caiu (heartbeat);
    // o evento 'offline' do navegador é instantâneo, então usamos ele para
    // refletir o status na hora em vez de esperar o canal notar sozinho.
    // (não existe um "aoFicarOnline" equivalente aqui de propósito: um
    // buscarTudo() disparado nesse momento correria contra a fila de
    // sincronização ainda em trânsito e podia sobrescrever um patch local
    // otimista com um snapshot do servidor de antes do PATCH commitar. O
    // reconhecimento real de volta já vem do próprio canal ao atingir
    // SUBSCRIBED de novo, mais abaixo.)
    function aoNavegadorFicarOffline() {
      if (!emFallback) setStatus('reconectando')
    }

    window.addEventListener('offline', aoNavegadorFicarOffline)

    armarDesistencia()
    conectar()

    return () => {
      cancelado = true
      limparTimerDesistencia()
      pararFallback()
      window.removeEventListener('offline', aoNavegadorFicarOffline)
      if (canal) supabase.removeChannel(canal)
    }
  }, [barracaId])

  return { pedidos, status, pedidosCarregados, aplicarPatchPedido, aplicarPatchItem }
}
