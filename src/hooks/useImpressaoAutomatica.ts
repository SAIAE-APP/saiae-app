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
import { tipoDoPedido } from '../lib/atendimento'
import {
  comRetentativaDeImpressao,
  jaImpressoNesteAparelho,
  marcarImpressoNesteAparelho,
} from '../lib/politicaImpressao'
import type { DadosEntrega } from '../lib/entrega'
import type { Barraca, Pedido, TipoAtendimento } from '../types/database'
import type { PedidoComItens } from './useRealtimePedidos'

type ItemPayload = {
  nome_item: string
  quantidade: number
  observacao: string | null
  preco_centavos_unitario: number
  entrega_direta: boolean
}

type IdsDoPedido = { pedidoId?: string | null; clientUuid?: string | null }

function armazenamento(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Idempotência POR APARELHO (localStorage), pelas duas chaves do pedido. */
function jaImpressa(ids: IdsDoPedido): boolean {
  return jaImpressoNesteAparelho(armazenamento(), ids)
}

function marcarImpressa(ids: IdsDoPedido) {
  marcarImpressoNesteAparelho(armazenamento(), ids)
}

type ConfigImpressora = Pick<
  Barraca,
  'nome' | 'cnpj' | 'procon_endereco' | 'impressora_habilitada' | 'impressora_endereco' | 'impressora_largura_papel'
>

/** Config da impressora na hora de imprimir. A barraca do layout pode vir
 * do cache local de antes da impressora ser configurada neste aparelho, então
 * se ela não tiver impressora pronta, confirma direto no servidor antes de
 * desistir — nunca desistir em silêncio por causa de cache velho. */
async function carregarConfigImpressora(
  barracaId: string,
  conhecida: Barraca | null,
): Promise<ConfigImpressora | null> {
  // `procon_endereco` undefined = cache de antes da coluna: relê do servidor pra a comanda levar a sede.
  if (
    conhecida?.id === barracaId &&
    conhecida.impressora_habilitada &&
    conhecida.impressora_endereco &&
    conhecida.procon_endereco !== undefined
  ) {
    return conhecida
  }
  const { data, error } = await supabase
    .from('barracas')
    .select('nome, cnpj, procon_endereco, impressora_habilitada, impressora_endereco, impressora_largura_papel')
    .eq('id', barracaId)
    .single()
  if (error || !data) return conhecida?.id === barracaId ? conhecida : null
  return data as ConfigImpressora
}

/** Endereço gravado no pedido (snapshot), ou null se não for pedido de Entrega. */
function dadosEntregaDoPedido(pedido: Pedido): DadosEntrega | null {
  // Pedido do cardápio digital ("Pagar na entrega") nasce só com nome/telefone e o
  // endereço livre em `entrega_referencia`, sem rua: ainda é uma Entrega.
  if (!pedido.entrega_rua && !pedido.entrega_nome && !pedido.entrega_telefone) return null
  return {
    nome: pedido.entrega_nome ?? '',
    telefone: pedido.entrega_telefone ?? '',
    rua: pedido.entrega_rua ?? '',
    numero: pedido.entrega_numero ?? '',
    bairro: pedido.entrega_bairro ?? '',
    referencia: pedido.entrega_referencia,
  }
}

/** Dados da comanda a partir de um pedido já no servidor (Cozinha, Realtime) —
 * usado pelo botão manual "Imprimir comanda" e pela impressão dos pedidos do
 * cardápio digital. */
export function dadosComandaDoPedido(
  pedido: PedidoComItens,
  barraca: Pick<Barraca, 'nome' | 'cnpj' | 'procon_endereco'>,
): DadosComanda {
  return {
    nomeBarraca: barraca.nome,
    cnpj: barraca.cnpj,
    proconEndereco: barraca.procon_endereco,
    senha: pedido.senha,
    criadoEm: pedido.criado_em,
    mesa: pedido.mesa,
    clienteNome: pedido.cliente_nome ?? null,
    viagem: pedido.viagem,
    tipo: tipoDoPedido(pedido),
    observacao: pedido.observacao,
    metodoPagamento: pedido.metodo_pagamento,
    entrega: dadosEntregaDoPedido(pedido),
    taxaEntregaCentavos: pedido.taxa_entrega_centavos ?? 0,
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

/** SÓ informação (telemetria): registra em `pedidos.comanda_impressa_em` que alguma
 * via saiu. NÃO decide quem imprime — cada aparelho imprime a sua (Sprint 6) —
 * e a resposta/erro é ignorada. */
function registrarImpressaoNoServidor(pedidoId: string) {
  void Promise.resolve(supabase.rpc('reivindicar_impressao_comanda', { p_pedido_id: pedidoId })).catch(() => {})
}

/**
 * Imprime a comanda de TODO pedido, sozinha, num aparelho Android com
 * impressora habilitada:
 *  (a) pedido criado NESTE aparelho: quando recebe a senha do servidor
 *      (offline, imprime quando a fila sobe, sem senha provisória);
 *  (b) pedido novo que chega pelo Realtime (INSERT em `pedidos`) — cobre o
 *      cardápio digital/Pix, criado no servidor.
 * UMA via por APARELHO (Sprint 6): sem trava global entre aparelhos — com 2
 * aparelhos ligados saem 2 vias. Idempotência por aparelho, pelo id E pelo
 * client_uuid do pedido (Set em memória + localStorage), então (a) + (b) +
 * reconexão + re-render nunca imprimem o mesmo pedido 2x aqui. Como os aparelhos
 * dividem a mesma impressora Bluetooth, impressora ocupada tenta de novo (até 4x,
 * 1–3 s aleatórios) antes de mostrar o toast.
 *
 * Roda em segundo plano, fora do fluxo de envio: falha vira toast tocável
 * ("Reimprimir") e nunca afeta o pedido. Pedidos todos em entrega direta não
 * passam pela cozinha — sem comanda.
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
      const endereco = cfg.impressora_endereco
      if (!endereco) return
      try {
        await comRetentativaDeImpressao(
          () => imprimirComanda({ endereco, largura: cfg.impressora_largura_papel, dados }),
          {
            aoTentarDeNovo: (tentativa, erro, esperaMs) =>
              console.warn(`[impressora] ocupada (tentativa ${tentativa}), nova em ${esperaMs}ms`, erro),
          },
        )
        marcarImpressa({ pedidoId, clientUuid })
        registrarImpressaoNoServidor(pedidoId)
        toastRef.current(`Comanda ${dados.senha ?? ''} impressa.`, { variante: 'sucesso', icone: 'print' })
      } catch (erro) {
        console.error('[impressora] comanda não impressa', erro)
        toastRef.current(
          `Comanda ${dados.senha ?? ''} não imprimiu. Toque para reimprimir. ${descreverErroImpressao(erro)}`,
          {
            variante: 'erro',
            duracaoMs: 15000,
            aoClicar: () => {
              void imprimir(pedidoId, dados, cfg, clientUuid)
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
      const ids = { pedidoId: pedido.pedidoId, clientUuid }
      if (
        emAndamentoRef.current.has(pedido.pedidoId) ||
        emAndamentoRef.current.has(clientUuid) ||
        jaImpressa(ids)
      ) {
        return
      }
      emAndamentoRef.current.add(pedido.pedidoId)
      emAndamentoRef.current.add(clientUuid)

      const montarDados = (cfg: ConfigImpressora): DadosComanda => ({
        nomeBarraca: cfg.nome,
        cnpj: cfg.cnpj,
        proconEndereco: cfg.procon_endereco,
        senha: pedido.senha,
        criadoEm: pedido.enviadoEm,
        mesa: (p.p_mesa as string | null) ?? null,
        clienteNome: (p.p_cliente_nome as string | null | undefined) ?? null,
        viagem: Boolean(p.p_viagem),
        tipo: (p.p_tipo_atendimento as TipoAtendimento | null | undefined) ?? null,
        observacao: (p.p_observacao as string | null) ?? null,
        metodoPagamento: (p.p_metodo_pagamento as string | null) ?? null,
        entrega: (p.p_entrega as DadosEntrega | null | undefined) ?? null,
        taxaEntregaCentavos: (p.p_taxa_entrega_centavos as number | undefined) ?? 0,
        itens: itens
          .filter((i) => !i.entrega_direta)
          .map((i) => ({
            nome: i.nome_item,
            quantidade: i.quantidade,
            observacao: i.observacao,
            precoCentavos: i.preco_centavos_unitario,
          })),
      })

      // Operação velha que só agora sincronizou (fila travada, ou criar_pedido
      // reexecutado e o servidor devolvendo a senha antiga): nunca imprime
      // sozinha, mas também nunca em silêncio — avisa e deixa o operador
      // imprimir com um toque. Marca como tratada pra não voltar sozinha.
      const idadeMs = Date.now() - new Date(pedido.enviadoEm).getTime()
      const minutosAtras = Math.round(idadeMs / 60000)
      if (idadeMs > JANELA_PEDIDO_NOVO_MS) {
        marcarImpressa(ids)
        console.info('[impressora] comanda antiga não impressa sozinha', pedido.senha)
        const cfgAntiga = await configPronta(idBarraca)
        if (!cfgAntiga) return
        toastRef.current(
          `Comanda ${pedido.senha} não saiu sozinha: o pedido foi enviado há ${minutosAtras} min e só agora sincronizou. Toque para imprimir.`,
          {
            variante: 'aviso',
            icone: 'print',
            duracaoMs: 20000,
            aoClicar: () => {
              void imprimir(pedido.pedidoId, montarDados(cfgAntiga), cfgAntiga, clientUuid)
            },
          },
        )
        return
      }

      const cfg = await configPronta(idBarraca)
      if (!cfg) return

      toastRef.current(`Imprimindo comanda ${pedido.senha}...`, { variante: 'aviso', icone: 'print', duracaoMs: 2500 })
      await imprimir(pedido.pedidoId, montarDados(cfg), cfg, clientUuid)
    })

    // (b) pedido novo pelo Realtime (cardápio digital e pedidos de outros aparelhos)
    async function aoChegarPedido(novo: Pedido) {
      // Sem olhar comanda_impressa_em: outro aparelho já ter impresso NÃO dispensa
      // a via deste (decisão do João: uma via por aparelho).
      if (novo.status !== 'a_fazer') return
      if (Date.now() - new Date(novo.criado_em).getTime() > JANELA_PEDIDO_NOVO_MS) return
      const ids = { pedidoId: novo.id, clientUuid: novo.client_uuid }
      if (
        emAndamentoRef.current.has(novo.id) ||
        (novo.client_uuid && emAndamentoRef.current.has(novo.client_uuid)) ||
        jaImpressa(ids)
      ) {
        return
      }
      emAndamentoRef.current.add(novo.id)
      if (novo.client_uuid) emAndamentoRef.current.add(novo.client_uuid)

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
