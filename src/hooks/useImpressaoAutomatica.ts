import { useEffect, useRef } from 'react'
import { useToast } from '../components/ui/Toast'
import { aoCriarPedidoLocal } from '../lib/fila'
import type { PedidoCriadoLocal } from '../lib/fila'
import {
  descreverErroImpressao,
  imprimirComanda,
  impressoraSuportada,
  type DadosComanda,
} from '../lib/impressoraTermica'
import type { Barraca } from '../types/database'

const PREFIXO_IMPRESSA = 'mesaagil:comanda-impressa:'

type ItemPayload = {
  nome_item: string
  quantidade: number
  observacao: string | null
  preco_centavos_unitario: number
  entrega_direta: boolean
}

function jaImpressa(clientUuid: string): boolean {
  try {
    return localStorage.getItem(PREFIXO_IMPRESSA + clientUuid) !== null
  } catch {
    return false
  }
}

function marcarImpressa(clientUuid: string) {
  try {
    localStorage.setItem(PREFIXO_IMPRESSA + clientUuid, new Date().toISOString())
  } catch {
    // sem storage: a idempotência em memória (Set no hook) ainda vale na sessão
  }
}

/**
 * Imprime a comanda sozinha quando um pedido criado NESTE aparelho recebe a
 * senha do servidor (a senha só existe depois do sync — offline, imprime
 * quando a fila sobe, sem nunca mostrar/imprimir senha provisória).
 *
 * Roda em segundo plano, fora do fluxo de envio: falha vira toast tocável
 * ("Reimprimir") e nunca afeta o pedido. Idempotente por client_uuid.
 * Pedidos todos em entrega direta não passam pela cozinha — sem comanda.
 * Pedidos do cardápio digital (Pix) não são criados aqui, então não
 * imprimem (próximo passo: ver CLAUDE.md).
 */
export function useImpressaoAutomatica(barraca: Barraca | null) {
  const { mostrarToast } = useToast()
  const emAndamentoRef = useRef(new Set<string>())
  const barracaRef = useRef(barraca)
  useEffect(() => {
    barracaRef.current = barraca
  }, [barraca])

  useEffect(() => {
    if (!impressoraSuportada()) return

    async function imprimir(dados: DadosComanda, clientUuid: string, manual: boolean) {
      const b = barracaRef.current
      if (!b?.impressora_endereco) return
      try {
        await imprimirComanda({ endereco: b.impressora_endereco, largura: b.impressora_largura_papel, dados })
        marcarImpressa(clientUuid)
        if (manual) mostrarToast('Comanda impressa.', { variante: 'sucesso' })
      } catch (erro) {
        console.error('[impressora] comanda não impressa', erro)
        mostrarToast(`Comanda ${dados.senha ?? ''} não imprimiu. Toque para reimprimir. ${descreverErroImpressao(erro)}`, {
          variante: 'erro',
          duracaoMs: 15000,
          aoClicar: () => void imprimir(dados, clientUuid, true),
        })
      }
    }

    return aoCriarPedidoLocal(async (pedido: PedidoCriadoLocal) => {
      const b = barracaRef.current
      const p = pedido.payload
      if (!b || p.p_barraca_id !== b.id) return
      if (!b.impressora_habilitada || !b.impressora_endereco) return

      const itens = (p.p_itens as ItemPayload[]) ?? []
      if (itens.length === 0 || itens.every((i) => i.entrega_direta)) return

      const clientUuid = String(p.p_client_uuid ?? pedido.pedidoId)
      if (emAndamentoRef.current.has(clientUuid) || jaImpressa(clientUuid)) return
      emAndamentoRef.current.add(clientUuid)

      await imprimir(
        {
          nomeBarraca: b.nome,
          senha: pedido.senha,
          criadoEm: new Date().toISOString(),
          mesa: (p.p_mesa as string | null) ?? null,
          viagem: Boolean(p.p_viagem),
          observacao: (p.p_observacao as string | null) ?? null,
          itens: itens.map((i) => ({
            nome: i.nome_item,
            quantidade: i.quantidade,
            observacao: i.observacao,
            precoCentavos: i.preco_centavos_unitario,
          })),
        },
        clientUuid,
        false,
      )
    })
  }, [mostrarToast])
}
