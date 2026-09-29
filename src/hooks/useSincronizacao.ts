import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  incrementarTentativa,
  emitirPedidoCriadoLocal,
  listarPendentes,
  marcarConcluida,
  notificarCriacaoPedido,
  ouvirMudancaFila,
} from '../lib/fila'
import type { OperacaoPendente } from '../lib/fila'

const ATRASO_INICIAL_MS = 1000
const ATRASO_MAXIMO_MS = 30000

async function executarOperacao(op: OperacaoPendente): Promise<void> {
  switch (op.tipo) {
    case 'criar_pedido': {
      const { data, error } = await supabase.rpc('criar_pedido', op.payload).single()
      if (error) throw error
      const resultado = data as { pedido_id: string; senha: number }
      notificarCriacaoPedido(op.id, { pedidoId: resultado.pedido_id, senha: resultado.senha })
      emitirPedidoCriadoLocal({
        idOperacao: op.id,
        pedidoId: resultado.pedido_id,
        senha: resultado.senha,
        payload: op.payload,
      })
      return
    }

    case 'mudar_status': {
      const { pedido_id, ...campos } = op.payload as { pedido_id: string }
      const { error } = await supabase.from('pedidos').update(campos).eq('id', pedido_id)
      if (error) throw error
      return
    }

    case 'remover_item': {
      const { item_id, ...campos } = op.payload as { item_id: string }
      const { error } = await supabase.from('itens_do_pedido').update(campos).eq('id', item_id)
      if (error) throw error
      return
    }

    case 'marcar_entregue': {
      const { item_id, ...campos } = op.payload as { item_id: string }
      const { error } = await supabase.from('itens_do_pedido').update(campos).eq('id', item_id)
      if (error) throw error
      return
    }
  }
}

export function useSincronizacao() {
  const [pendentes, setPendentes] = useState(0)
  const [sincronizando, setSincronizando] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  const processandoRef = useRef(false)
  const atrasoRef = useRef(ATRASO_INICIAL_MS)
  const timerRef = useRef<number | null>(null)
  const canceladoRef = useRef(false)

  useEffect(() => {
    canceladoRef.current = false

    async function atualizarContagem() {
      const lista = await listarPendentes()
      if (!canceladoRef.current) setPendentes(lista.length)
    }

    function limparTimer() {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function agendarProximaTentativa() {
      if (timerRef.current !== null) return
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        processarFila()
      }, atrasoRef.current)
      atrasoRef.current = Math.min(atrasoRef.current * 2, ATRASO_MAXIMO_MS)
    }

    async function processarFila() {
      if (processandoRef.current || !navigator.onLine) {
        await atualizarContagem()
        return
      }

      processandoRef.current = true
      setSincronizando(true)

      const lista = await listarPendentes()
      let falhou = false

      for (const op of lista) {
        if (!navigator.onLine) {
          falhou = true
          break
        }

        try {
          await executarOperacao(op)
          await marcarConcluida(op.id)
        } catch (erro) {
          console.error(`[sincronizacao] falha em ${op.tipo} (tentativa ${op.tentativas + 1})`, erro)
          await incrementarTentativa(op.id)
          falhou = true
          break
        }
      }

      await atualizarContagem()
      processandoRef.current = false
      setSincronizando(false)

      if (falhou) {
        agendarProximaTentativa()
      } else {
        atrasoRef.current = ATRASO_INICIAL_MS
      }
    }

    function aoFicarOnline() {
      setOnline(true)
      atrasoRef.current = ATRASO_INICIAL_MS
      limparTimer()
      processarFila()
    }

    function aoFicarOffline() {
      setOnline(false)
    }

    window.addEventListener('online', aoFicarOnline)
    window.addEventListener('offline', aoFicarOffline)
    const pararDeOuvirFila = ouvirMudancaFila(processarFila)

    atualizarContagem()
    processarFila()

    return () => {
      canceladoRef.current = true
      window.removeEventListener('online', aoFicarOnline)
      window.removeEventListener('offline', aoFicarOffline)
      pararDeOuvirFila()
      limparTimer()
    }
  }, [])

  return { pendentes, sincronizando, online }
}
