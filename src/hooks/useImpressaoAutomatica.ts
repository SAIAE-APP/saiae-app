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
import type { Barraca, Pedido } from '../types/database'
import type { PedidoComItens } from './useRealtimePedidos'

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
  'nome' | 'cnpj' | 'impressora_habilitada' | 'impressora_endereco' | 'impressora_largura_papel'
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
    .select('nome, cnpj, impressora_habilitada, impressora_endereco, impressora_largura_papel')
    .eq('id', barracaId)
    .single()
  if (error || !data) return conhecida?.id === barracaId ? conhecida : null
  return data as ConfigImpressora
}

/** Dados da comanda a partir de um pedido já no servidor (Cozinha, Realtime) —
 * usado pelo botão manual "Imprimir comanda" e pela impressão dos pedidos do
 * cardápio digital. */
export function dadosComandaDoPedido(
  pedido: PedidoComItens,
  barraca: Pick<Barraca, 'nome' | 'cnpj'>,
): DadosComanda {
  return {
    nomeBarraca: barraca.nome,
    cnpj: barraca.cnpj,
    senha: pedido.senha,
    criadoEm: pedido.criado_em,
    mesa: pedido.mesa,
    viagem: pedido.viagem,
    observacao: pedido.observacao,
    metodoPagamento: pedido.metodo_pagamento,
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

/** Pedido novo (INSERT no Realtime) só imprime se for recente: ao reconectar
 * ou abrir o app, eventos velhos não podem sair impressos. */
const JANELA_PEDIDO_NOVO_MS = 5 * 60 * 1000

/** Reivindicação atômica no banco: só UM aparelho ganha (true) e imprime.
 * Se a chamada falhar (rede/RPC ausente), imprime mesmo assim — melhor uma
 * comanda duplicada que nenhuma. */
async function reivindicar(pedidoId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('reivindicar_impressao_comanda', { p_pedido_id: pedidoId })
    if (error) throw error
    return data === true
  } catch (erro) {
    console.warn('[impressora] reivindicação falhou, imprimindo mesmo assim', erro)
    return true
  }
}

async function liberar(pedidoId: string) {
  try {
    await supabase.rpc('liberar_impressao_comanda', { p_pedido_id: pedidoId })
  } catch (erro) {
    console.warn('[impressora] não consegui liberar a reivindicação', erro)
  }
}

/**
 * Imprime a comanda de TODO pedido, sozinha, num aparelho Android com
 * impressora habilitada:
 *  (a) pedido criado NESTE aparelho: quando recebe a senha do servidor
 *      (offline, imprime quando a fila sobe, sem senha provisória);
 *  (b) pedido novo que chega pelo Realtime (INSERT em `pedidos`) — cobre o
 *      cardápio digital/Pix, criado no servidor.
 * Com 2+ aparelhos ouvindo, `reivindicar_impressao_comanda` (pedidos.
 * comanda_impressa_em, UPDATE atômico) garante uma impressão só.
 *
 * Roda em segundo plano, fora do fluxo de envio: falha vira toast tocável
 * ("Reimprimir"), libera a reivindicação e nunca afeta o pedido. Idempotente
 * por pedido (Set em memória + client_uuid no localStorage). Pedidos todos
 * em entrega direta não passam pela cozinha — sem comanda.
 */
export function useImpressaoAutomatica(barraca: Barraca | null) {
  const { mostrarToast } = useToast()
  const emAndamentoRef = useRef(new Set<string>())
  const barracaRef = useRef(barraca)
  useEffect(() => {
    barracaRef.current = barraca
  }, [barraca])

  // Ref pro toast: os ouvintes são registrados sem depender da identidade
  // de mostrarToast, pra nunca haver janela de re-registro em que um pedido
  // chega sem ninguém ouvindo.
  const toastRef = useRef(mostrarToast)
  useEffect(() => {
    toastRef.current = mostrarToast
  }, [mostrarToast])

  const barracaId = barraca?.id ?? null

  useEffect(() => {
    if (!impressoraSuportada()) return

    async function imprimir(
      pedidoId: string,
      dados: DadosComanda,
      cfg: ConfigImpressora,
      clientUuid: string | null,
    ) {
      if (!cfg.impressora_endereco) return
      try {
        await imprimirComanda({ endereco: cfg.impressora_endereco, largura: cfg.impressora_largura_papel, dados })
        if (clientUuid) marcarImpressa(clientUuid)
        toastRef.current(`Comanda ${dados.senha ?? ''} impressa.`, { variante: 'sucesso', icone: 'print' })
      } catch (erro) {
        console.error('[impressora] comanda não impressa', erro)
        void liberar(pedidoId)
        toastRef.current(
          `Comanda ${dados.senha ?? ''} não imprimiu. Toque para reimprimir. ${descreverErroImpressao(erro)}`,
          {
            variante: 'erro',
            duracaoMs: 15000,
            aoClicar: () => {
              void (async () => {
                await imprimir(pedidoId, dados, cfg, clientUuid)
                void reivindicar(pedidoId)
              })()
            },
          },
        )
      }
    }

    /** Config pronta pra imprimir, ou null (avisando quando é o caso). */
    async function configPronta(idBarraca: string): Promise<ConfigImpressora | null> {
      let cfg: ConfigImpressora | null
      try {
        cfg = await carregarConfigImpressora(idBarraca, barracaRef.current)
      } catch (erro) {
        console.warn('[impressora] não consegui ler a config da impressora', erro)
        cfg = barracaRef.current
      }
      if (!cfg?.impressora_habilitada) {
        console.info('[impressora] comanda ignorada: impressora desabilitada nesta barraca')
        return null
      }
      if (!cfg.impressora_endereco) {
        toastRef.current('Impressora habilitada, mas sem dispositivo escolhido. Escolha em Ajustes.', {
          variante: 'aviso',
          duracaoMs: 8000,
        })
        return null
      }
      return cfg
    }

    // (a) pedido criado neste aparelho
    const cancelarLocal = aoCriarPedidoLocal(async (pedido: PedidoCriadoLocal) => {
      const p = pedido.payload
      const idBarraca = String(p.p_barraca_id ?? '')
      const itens = (p.p_itens as ItemPayload[]) ?? []
      if (!idBarraca || itens.length === 0 || itens.every((i) => i.entrega_direta)) return

      const clientUuid = String(p.p_client_uuid ?? pedido.pedidoId)
      if (emAndamentoRef.current.has(pedido.pedidoId) || jaImpressa(clientUuid)) return
      emAndamentoRef.current.add(pedido.pedidoId)

      const cfg = await configPronta(idBarraca)
      if (!cfg || !(await reivindicar(pedido.pedidoId))) return

      const dados: DadosComanda = {
        nomeBarraca: cfg.nome,
        cnpj: cfg.cnpj,
        senha: pedido.senha,
        criadoEm: new Date().toISOString(),
        mesa: (p.p_mesa as string | null) ?? null,
        viagem: Boolean(p.p_viagem),
        observacao: (p.p_observacao as string | null) ?? null,
        metodoPagamento: (p.p_metodo_pagamento as string | null) ?? null,
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
      await imprimir(pedido.pedidoId, dados, cfg, clientUuid)
    })

    // (b) pedido novo pelo Realtime (cardápio digital e pedidos de outros aparelhos)
    async function aoChegarPedido(novo: Pedido) {
      if (novo.status !== 'a_fazer' || novo.comanda_impressa_em) return
      if (Date.now() - new Date(novo.criado_em).getTime() > JANELA_PEDIDO_NOVO_MS) return
      if (emAndamentoRef.current.has(novo.id) || (novo.client_uuid && jaImpressa(novo.client_uuid))) return
      emAndamentoRef.current.add(novo.id)

      const cfg = await configPronta(novo.barraca_id)
      if (!cfg) return

      // O payload do Realtime não traz os itens: busca o pedido completo.
      const { data, error } = await supabase
        .from('pedidos')
        .select('*, itens_do_pedido(*)')
        .eq('id', novo.id)
        .single()
      if (error || !data) {
        console.warn('[impressora] não consegui buscar o pedido novo', error)
        emAndamentoRef.current.delete(novo.id)
        return
      }
      const pedido = data as PedidoComItens
      const dados = dadosComandaDoPedido(pedido, cfg)
      if (dados.itens.length === 0) return
      if (!(await reivindicar(pedido.id))) return

      toastRef.current(`Imprimindo comanda ${pedido.senha}...`, { variante: 'aviso', icone: 'print', duracaoMs: 2500 })
      await imprimir(pedido.id, dados, cfg, pedido.client_uuid)
    }

    const canal = barracaId
      ? supabase
          .channel(`impressao-${barracaId}`)
          .on<Pedido>(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'pedidos', filter: `barraca_id=eq.${barracaId}` },
            (payload) => {
              if ('id' in payload.new) void aoChegarPedido(payload.new)
            },
          )
          .subscribe()
      : null

    return () => {
      cancelarLocal()
      if (canal) void supabase.removeChannel(canal)
    }
  }, [barracaId])
}
