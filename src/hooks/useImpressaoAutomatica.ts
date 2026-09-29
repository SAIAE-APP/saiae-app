import { useEffect, useRef } from 'react'
import { useToast } from '../components/ui/Toast'
import { aoCriarPedidoLocal } from '../lib/fila'
import { supabase } from '../lib/supabase'
import type { PedidoCriadoLocal } from '../lib/fila'
import {
  descreverErroImpressao,
  imprimirComanda,
  impressoraSuportada,
  type DadosComanda,
} from '../lib/impressoraTermica'
import type { Barraca, PedidoComItens } from '../types/database'

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

type ConfigImpressora = Pick<
  Barraca,
  'nome' | 'impressora_habilitada' | 'impressora_endereco' | 'impressora_largura_papel'
>

/** Config da impressora na hora de imprimir. A barraca do layout pode vir
 * do cache local de antes da impressora ser configurada neste aparelho, então
 * se ela não tiver impressora pronta, confirma direto no servidor antes de
 * desistir — nunca desistir em silêncio por causa de cache velho. */
async function carregarConfigImpressora(
  barracaId: string,
  conhecida: Barraca | null,
): Promise<ConfigImpressora | null> {
  if (conhecida?.id === barracaId && conhecida.impressora_habilitada && conhecida.impressora_endereco) {
    return conhecida
  }
  const { data, error } = await supabase
    .from('barracas')
    .select('nome, impressora_habilitada, impressora_endereco, impressora_largura_papel')
    .eq('id', barracaId)
    .single()
  if (error || !data) return conhecida?.id === barracaId ? conhecida : null
  return data as ConfigImpressora
}

/** Dados da comanda a partir de um pedido já no servidor (Cozinha) — usado
 * pelo botão manual "Imprimir comanda". */
export function dadosComandaDoPedido(pedido: PedidoComItens, nomeBarraca: string): DadosComanda {
  return {
    nomeBarraca,
    senha: pedido.senha,
    criadoEm: pedido.criado_em,
    mesa: pedido.mesa,
    viagem: pedido.viagem,
    observacao: pedido.observacao,
    itens: pedido.itens_do_pedido
      .filter((i) => !i.removido && !i.entrega_direta)
      .map((i) => ({
        nome: i.nome_item,
        quantidade: i.quantidade,
        observacao: i.observacao,
        precoCentavos: i.preco_centavos_unitario,
      })),
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

  // Ref pro toast: o ouvinte do pedido é registrado UMA vez (sem depender
  // da identidade de mostrarToast), pra nunca haver janela de re-registro
  // em que um pedido sincroniza sem ninguém ouvindo.
  const toastRef = useRef(mostrarToast)
  useEffect(() => {
    toastRef.current = mostrarToast
  }, [mostrarToast])

  useEffect(() => {
    if (!impressoraSuportada()) return

    async function imprimir(dados: DadosComanda, cfg: ConfigImpressora, clientUuid: string, manual: boolean) {
      if (!cfg.impressora_endereco) return
      try {
        await imprimirComanda({ endereco: cfg.impressora_endereco, largura: cfg.impressora_largura_papel, dados })
        marcarImpressa(clientUuid)
        toastRef.current(`Comanda ${dados.senha ?? ''} impressa.`, { variante: 'sucesso', icone: 'print' })
      } catch (erro) {
        console.error('[impressora] comanda não impressa', erro)
        toastRef.current(
          `Comanda ${dados.senha ?? ''} não imprimiu. Toque para reimprimir. ${descreverErroImpressao(erro)}`,
          {
            variante: 'erro',
            duracaoMs: 15000,
            aoClicar: () => void imprimir(dados, cfg, clientUuid, true),
          },
        )
      } finally {
        if (!manual) emAndamentoRef.current.delete(clientUuid)
      }
    }

    return aoCriarPedidoLocal(async (pedido: PedidoCriadoLocal) => {
      const p = pedido.payload
      const barracaId = String(p.p_barraca_id ?? '')
      const itens = (p.p_itens as ItemPayload[]) ?? []
      if (!barracaId || itens.length === 0 || itens.every((i) => i.entrega_direta)) return

      const clientUuid = String(p.p_client_uuid ?? pedido.pedidoId)
      if (emAndamentoRef.current.has(clientUuid) || jaImpressa(clientUuid)) return
      emAndamentoRef.current.add(clientUuid)

      let cfg: ConfigImpressora | null
      try {
        cfg = await carregarConfigImpressora(barracaId, barracaRef.current)
      } catch (erro) {
        console.warn('[impressora] não consegui ler a config da impressora', erro)
        cfg = barracaRef.current
      }

      if (!cfg?.impressora_habilitada) {
        console.info('[impressora] comanda ignorada: impressora desabilitada nesta barraca')
        emAndamentoRef.current.delete(clientUuid)
        return
      }
      if (!cfg.impressora_endereco) {
        emAndamentoRef.current.delete(clientUuid)
        toastRef.current('Impressora habilitada, mas sem dispositivo escolhido. Escolha em Ajustes.', {
          variante: 'aviso',
          duracaoMs: 8000,
        })
        return
      }

      const dados: DadosComanda = {
        nomeBarraca: cfg.nome,
        senha: pedido.senha,
        criadoEm: new Date().toISOString(),
        mesa: (p.p_mesa as string | null) ?? null,
        viagem: Boolean(p.p_viagem),
        observacao: (p.p_observacao as string | null) ?? null,
        itens: itens
          .filter((i) => !i.entrega_direta)
          .map((i) => ({
            nome: i.nome_item,
            quantidade: i.quantidade,
            observacao: i.observacao,
            precoCentavos: i.preco_centavos_unitario,
          })),
      }

      toastRef.current(`Imprimindo comanda ${pedido.senha}...`, { variante: 'aviso', icone: 'print', duracaoMs: 2500 })
      await imprimir(dados, cfg, clientUuid, false)
    })
  }, [])
}
