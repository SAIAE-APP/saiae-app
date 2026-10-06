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
import { salvarClienteFinal } from '../lib/clientesFinais'
import type { DadosEntrega } from '../lib/entrega'

const ATRASO_INICIAL_MS = 1000
const ATRASO_MAXIMO_MS = 30000

/** A operação não pode ser enviada AGORA por causa de algo que só o servidor
 * resolve (ex.: banco sem a criar_pedido v6), mas não tem nada a ver com as
 * outras operações da fila. Fica na fila e é reenviada com backoff, sem
 * travar as que vêm depois. */
class OperacaoAdiadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'OperacaoAdiadaError'
  }
}

/** Payload com endereço de entrega ou taxa > 0 só vale na criar_pedido v6. */
function pedidoPrecisaDaV6(payload: Record<string, unknown>): boolean {
  const taxa = payload.p_taxa_entrega_centavos
  return payload.p_entrega != null || (typeof taxa === 'number' && taxa > 0)
}

/** Guarda o cliente de um pedido de Entrega no cadastro da barraca. Roda depois
 * do pedido já confirmado, em segundo plano: falha (rede, tabela ainda sem
 * migration) só vai pro console e nunca atrapalha a fila. O upsert por
 * barraca+telefone é idempotente, então reenvio não duplica. */
function salvarClienteDoPedido(payload: Record<string, unknown>) {
  const entrega = payload.p_entrega as DadosEntrega | null | undefined
  const barracaId = payload.p_barraca_id
  if (!entrega || typeof barracaId !== 'string') return
  salvarClienteFinal(barracaId, entrega).catch((erro) => {
    console.warn('[sincronizacao] cliente final não salvo', erro)
  })
}

async function executarOperacao(op: OperacaoPendente): Promise<void> {
  switch (op.tipo) {
    case 'criar_pedido': {
      let payload = op.payload
      let { data, error } = await supabase.rpc('criar_pedido', payload).single()
      // Banco ainda sem a v7 (p_cliente_nome): reenvia sem o nome. O nome é
      // opcional, então o pedido entra normalmente e a fila não trava (na
      // Entrega o nome continua indo em p_entrega).
      if (error?.code === 'PGRST202' && 'p_cliente_nome' in payload) {
        const { p_cliente_nome: _semNome, ...semNome } = payload
        void _semNome
        payload = semNome
        ;({ data, error } = await supabase.rpc('criar_pedido', payload).single())
      }
      // PGRST202 = função não existe com esses argumentos. Com o app novo
      // publicado antes da migration de modos_atendimento, o banco ainda só
      // conhece criar_pedido de 7 args; sem esta volta, o pedido novo falharia
      // pra sempre e (por causa do break abaixo) travaria toda a fila atrás
      // dele. Reenvia sem o campo novo: o pedido entra com tipo_atendimento
      // NULL, e o app deriva de mesa/viagem (tipoDoPedido).
      if (error?.code === 'PGRST202' && 'p_tipo_atendimento' in payload) {
        // Pedido com dados de entrega ou taxa NÃO cai pra assinatura antiga:
        // entraria no banco sem endereço e sem taxa. Fica adiado na fila (a
        // fila reenvia sozinha depois que a migration da v6 entrar) e NÃO
        // trava os pedidos seguintes, que não dependem dele.
        if (pedidoPrecisaDaV6(payload)) {
          throw new OperacaoAdiadaError(
            'Pedido de Entrega aguardando a atualização do servidor (criar_pedido v6)',
          )
        } else {
          const {
            p_tipo_atendimento: _semTipo,
            p_entrega: _semEntrega,
            p_taxa_entrega_centavos: _semTaxa,
            ...payloadAntigo
          } = payload
          void _semTipo
          void _semEntrega
          void _semTaxa
          ;({ data, error } = await supabase.rpc('criar_pedido', payloadAntigo).single())
        }
      }
      if (error) throw error
      const resultado = data as { pedido_id: string; senha: number }
      salvarClienteDoPedido(op.payload)
      notificarCriacaoPedido(op.id, { pedidoId: resultado.pedido_id, senha: resultado.senha })
      emitirPedidoCriadoLocal({
        idOperacao: op.id,
        pedidoId: resultado.pedido_id,
        senha: resultado.senha,
        payload: op.payload,
        enviadoEm: op.criadoEm,
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
          // Operação adiada só espera; as outras seguem. Qualquer outra falha
          // (rede, erro do banco) continua parando a fila, pra preservar a ordem.
          if (erro instanceof OperacaoAdiadaError) continue
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
