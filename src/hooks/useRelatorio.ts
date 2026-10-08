import { calcularOpcoesVendidas, type OpcaoVendida } from '../lib/opcoesRelatorio'
import { calcularDescontosCupom, type DescontosCupom } from '../lib/descontosCupom'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  calcularDivisaoPorConsumo,
  calcularDivisaoPorMetodo,
  calcularEstimativaLiquida,
  calcularIntervalosRelatorio,
  calcularMaisVendidos,
  
  calcularPontosAtencao,
  calcularRitmoDoDia,
  calcularSerieItemPorDia,
  calcularSerieItemPorHora,
  calcularSeriePorDia,
  calcularSeriePorHora,
  calcularTotalBruto,
  calcularTotalItensVendidos,
} from '../lib/relatorio'
import type {
  DivisaoMetodo,
  DivisaoPorConsumo,
  EstimativaLiquida,
  FiltroRelatorio,
  IntervaloData,
  ItemMaisVendido,

  MetodoOuNaoInformado,
  PontoSerie,
  PontosAtencao,
  RitmoDoDia,
} from '../lib/relatorio'
import type { Barraca, PedidoComItens } from '../types/database'

export type { FiltroRelatorio, TipoFiltroRelatorio } from '../lib/relatorio'

export type AgregadosRelatorio = {
  pedidos: PedidoComItens[]
  totalBruto: number
  quantidadePedidos: number
  divisaoPorMetodo: Record<MetodoOuNaoInformado, DivisaoMetodo>
  divisaoPorConsumo: DivisaoPorConsumo
  estimativaLiquida: EstimativaLiquida | null
  pontosAtencao: PontosAtencao
  maisVendidos: ItemMaisVendido[]
  opcoesVendidas: OpcaoVendida[]
  descontosCupom: DescontosCupom
  ritmoDoDia: RitmoDoDia
  serieTemporal: { granularidade: 'dia' | 'hora'; pontos: PontoSerie[] }
  itensVendidos: number
}

export type AgregadoProdutoIsolado = {
  totalIsolado: number
  unidadesVendidas: number
  serieTemporal: { granularidade: 'dia' | 'hora'; pontos: PontoSerie[] }
}

export async function buscarPedidosDoPeriodo(
  barracaId: string,
  inicio: string,
  fim: string,
): Promise<PedidoComItens[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, itens_do_pedido(*)')
    .eq('barraca_id', barracaId)
    .gte('data_operacao', inicio)
    .lte('data_operacao', fim)

  if (error) throw error
  return (data ?? []) as PedidoComItens[]
}

/**
 * !inner + filtro no campo embutido faz o PostgREST filtrar tanto os
 * pedidos (so os que tem o item) quanto o array itens_do_pedido aninhado
 * (so a linha do item filtrado) — mas o filtro client-side em
 * agregarProdutoIsolado continua conferindo isso, sem depender só desse
 * comportamento do embed.
 */
async function buscarPedidosComItem(
  barracaId: string,
  itemId: string,
  inicio: string,
  fim: string,
): Promise<PedidoComItens[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, itens_do_pedido!inner(*)')
    .eq('barraca_id', barracaId)
    .eq('itens_do_pedido.item_id', itemId)
    .gte('data_operacao', inicio)
    .lte('data_operacao', fim)

  if (error) throw error
  return (data ?? []) as PedidoComItens[]
}

async function buscarCatalogoPrecos(barracaId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('itens')
    .select('id, preco_centavos')
    .eq('barraca_id', barracaId)

  if (error) throw error
  return new Map(
    (data ?? []).map((item) => [item.id as string, item.preco_centavos as number]),
  )
}

function agregar(
  pedidos: PedidoComItens[],
  catalogoPrecos: Map<string, number>,
  taxaDebitoBps: number | null,
  taxaCreditoBps: number | null,
  intervalo: IntervaloData,
): AgregadosRelatorio {
  const serieTemporal: AgregadosRelatorio['serieTemporal'] =
    intervalo.inicio === intervalo.fim
      ? { granularidade: 'hora', pontos: calcularSeriePorHora(pedidos) }
      : { granularidade: 'dia', pontos: calcularSeriePorDia(pedidos, intervalo.inicio, intervalo.fim) }

  return {
    pedidos,
    totalBruto: calcularTotalBruto(pedidos),
    quantidadePedidos: pedidos.filter((p) => p.status !== 'cancelado').length,
    divisaoPorMetodo: calcularDivisaoPorMetodo(pedidos),
    divisaoPorConsumo: calcularDivisaoPorConsumo(pedidos),
    estimativaLiquida: calcularEstimativaLiquida(pedidos, taxaDebitoBps, taxaCreditoBps),
    pontosAtencao: calcularPontosAtencao(pedidos, catalogoPrecos),
    maisVendidos: calcularMaisVendidos(pedidos),
    opcoesVendidas: calcularOpcoesVendidas(pedidos),
    descontosCupom: calcularDescontosCupom(pedidos),
    ritmoDoDia: calcularRitmoDoDia(pedidos),
    serieTemporal,
    itensVendidos: calcularTotalItensVendidos(pedidos),
  }
}

function agregarProdutoIsolado(
  pedidos: PedidoComItens[],
  itemId: string,
  intervalo: IntervaloData,
): AgregadoProdutoIsolado {
  let totalIsolado = 0
  let unidadesVendidas = 0

  for (const pedido of pedidos) {
    if (pedido.status === 'cancelado') continue
    for (const item of pedido.itens_do_pedido) {
      if (item.removido || item.item_id !== itemId) continue
      totalIsolado += item.preco_centavos_unitario * item.quantidade
      unidadesVendidas += item.quantidade
    }
  }

  const serieTemporal: AgregadoProdutoIsolado['serieTemporal'] =
    intervalo.inicio === intervalo.fim
      ? { granularidade: 'hora', pontos: calcularSerieItemPorHora(pedidos, itemId) }
      : {
          granularidade: 'dia',
          pontos: calcularSerieItemPorDia(pedidos, itemId, intervalo.inicio, intervalo.fim),
        }

  return { totalIsolado, unidadesVendidas, serieTemporal }
}

export type ResultadoRelatorio =
  | {
      modo: 'completo'
      atual: AgregadosRelatorio | null
      comparacao: AgregadosRelatorio | null
      carregando: boolean
      erro: string | null
    }
  | {
      modo: 'produto_isolado'
      atual: AgregadoProdutoIsolado | null
      comparacao: AgregadoProdutoIsolado | null
      carregando: boolean
      erro: string | null
    }

export function useRelatorio(
  barraca: Barraca,
  filtro: FiltroRelatorio,
  itemFiltradoId?: string | null,
): ResultadoRelatorio {
  const [pedidosAtuais, setPedidosAtuais] = useState<PedidoComItens[] | null>(null)
  const [pedidosComparacao, setPedidosComparacao] = useState<PedidoComItens[] | null>(null)
  const [catalogoPrecos, setCatalogoPrecos] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)

    const intervalos = calcularIntervalosRelatorio(filtro)

    const buscaAtual = itemFiltradoId
      ? buscarPedidosComItem(barraca.id, itemFiltradoId, intervalos.atual.inicio, intervalos.atual.fim)
      : buscarPedidosDoPeriodo(barraca.id, intervalos.atual.inicio, intervalos.atual.fim)

    const buscaComparacao = itemFiltradoId
      ? buscarPedidosComItem(
          barraca.id,
          itemFiltradoId,
          intervalos.comparacao.inicio,
          intervalos.comparacao.fim,
        )
      : buscarPedidosDoPeriodo(barraca.id, intervalos.comparacao.inicio, intervalos.comparacao.fim)

    // catalogo de precos so importa pro modo completo (pontosAtencao.itensSemPreco)
    const buscaCatalogo = itemFiltradoId
      ? Promise.resolve(new Map<string, number>())
      : buscarCatalogoPrecos(barraca.id)

    Promise.all([buscaAtual, buscaComparacao, buscaCatalogo])
      .then(([atual, comparacao, catalogo]) => {
        if (cancelado) return
        setPedidosAtuais(atual)
        setPedidosComparacao(comparacao)
        setCatalogoPrecos(catalogo)
        setCarregando(false)
      })
      .catch((e: Error) => {
        if (cancelado) return
        setErro(e.message)
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
    // depende dos campos primitivos de filtro, não do objeto — o chamador
    // passa um literal inline, então uma dependência em `filtro` mudaria de
    // referência a cada render e refaria a busca sem necessidade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barraca.id, filtro.tipo, filtro.dataInicio, filtro.dataFim, itemFiltradoId])

  // mesmo motivo do efeito acima: depende dos campos primitivos de filtro
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intervalos = useMemo(() => calcularIntervalosRelatorio(filtro), [filtro.tipo, filtro.dataInicio, filtro.dataFim])

  // barraca vem inteira (não só o id) especificamente pra isso: useBarraca
  // mostra o cache offline-first na hora e só troca pela versão de verdade
  // quando a rede responde. Como aqui não há edição do usuário pra proteger
  // (é leitura pura), basta recalcular via useMemo sempre que os campos de
  // taxa mudarem — sem precisar do guard de "debounce em voo" usado em
  // Ajustes.
  const atualCompleto = useMemo(() => {
    if (itemFiltradoId || !pedidosAtuais) return null
    return agregar(
      pedidosAtuais,
      catalogoPrecos,
      barraca.taxa_debito_bps,
      barraca.taxa_credito_bps,
      intervalos.atual,
    )
  }, [
    itemFiltradoId,
    pedidosAtuais,
    catalogoPrecos,
    barraca.taxa_debito_bps,
    barraca.taxa_credito_bps,
    intervalos.atual,
  ])

  const comparacaoCompleto = useMemo(() => {
    if (itemFiltradoId || !pedidosComparacao) return null
    return agregar(
      pedidosComparacao,
      catalogoPrecos,
      barraca.taxa_debito_bps,
      barraca.taxa_credito_bps,
      intervalos.comparacao,
    )
  }, [
    itemFiltradoId,
    pedidosComparacao,
    catalogoPrecos,
    barraca.taxa_debito_bps,
    barraca.taxa_credito_bps,
    intervalos.comparacao,
  ])

  const atualIsolado = useMemo(() => {
    if (!itemFiltradoId || !pedidosAtuais) return null
    return agregarProdutoIsolado(pedidosAtuais, itemFiltradoId, intervalos.atual)
  }, [itemFiltradoId, pedidosAtuais, intervalos.atual])

  const comparacaoIsolado = useMemo(() => {
    if (!itemFiltradoId || !pedidosComparacao) return null
    return agregarProdutoIsolado(pedidosComparacao, itemFiltradoId, intervalos.comparacao)
  }, [itemFiltradoId, pedidosComparacao, intervalos.comparacao])

  if (itemFiltradoId) {
    return {
      modo: 'produto_isolado',
      atual: atualIsolado,
      comparacao: comparacaoIsolado,
      carregando,
      erro,
    }
  }

  return { modo: 'completo', atual: atualCompleto, comparacao: comparacaoCompleto, carregando, erro }
}
