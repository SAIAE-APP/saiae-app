import { deslocarDias, hojeISO } from './datas'
import type { MetodoPagamento } from './metodoPagamento'
import type { PedidoComItens } from '../types/database'

export type MetodoOuNaoInformado = MetodoPagamento | 'nao_informado'

export const METODOS_OU_NAO_INFORMADO: MetodoOuNaoInformado[] = [
  'dinheiro',
  'debito',
  'credito',
  'pix',
  'nao_informado',
]

export function calcularTotalPedido(pedido: PedidoComItens): number {
  return pedido.itens_do_pedido
    .filter((item) => !item.removido)
    .reduce((soma, item) => soma + item.preco_centavos_unitario * item.quantidade, 0)
}

export function ehEntregaDireta(pedido: PedidoComItens): boolean {
  if (!pedido.pronto_em || !pedido.entregue_em) return false
  const diferencaMs = Math.abs(
    new Date(pedido.entregue_em).getTime() - new Date(pedido.pronto_em).getTime(),
  )
  return diferencaMs < 1000
}

function naoCancelados(pedidos: PedidoComItens[]): PedidoComItens[] {
  return pedidos.filter((p) => p.status !== 'cancelado')
}

export function calcularTotalBruto(pedidos: PedidoComItens[]): number {
  return naoCancelados(pedidos).reduce((soma, p) => soma + calcularTotalPedido(p), 0)
}

export type DivisaoMetodo = { total: number; quantidade: number; percentual: number }

export function calcularDivisaoPorMetodo(
  pedidos: PedidoComItens[],
): Record<MetodoOuNaoInformado, DivisaoMetodo> {
  const validos = naoCancelados(pedidos)
  const totalGeral = validos.reduce((soma, p) => soma + calcularTotalPedido(p), 0)

  const resultado = {} as Record<MetodoOuNaoInformado, DivisaoMetodo>

  for (const chave of METODOS_OU_NAO_INFORMADO) {
    const doMetodo = validos.filter((p) =>
      chave === 'nao_informado' ? !p.metodo_pagamento : p.metodo_pagamento === chave,
    )
    const total = doMetodo.reduce((soma, p) => soma + calcularTotalPedido(p), 0)
    resultado[chave] = {
      total,
      quantidade: doMetodo.length,
      percentual: totalGeral > 0 ? (total / totalGeral) * 100 : 0,
    }
  }

  return resultado
}

export type DetalhamentoLiquido = {
  metodo: MetodoOuNaoInformado
  total: number
  totalLiquido: number
  taxaBps: number | null
}

export type EstimativaLiquida = {
  totalLiquido: number
  detalhamento: DetalhamentoLiquido[]
}

export function calcularEstimativaLiquida(
  pedidos: PedidoComItens[],
  taxaDebitoBps: number | null,
  taxaCreditoBps: number | null,
): EstimativaLiquida | null {
  if (taxaDebitoBps === null && taxaCreditoBps === null) return null

  const divisao = calcularDivisaoPorMetodo(pedidos)
  const taxaPorMetodo: Record<MetodoOuNaoInformado, number | null> = {
    dinheiro: null,
    debito: taxaDebitoBps,
    credito: taxaCreditoBps,
    pix: null,
    nao_informado: null,
  }

  const detalhamento: DetalhamentoLiquido[] = METODOS_OU_NAO_INFORMADO.filter(
    (chave) => divisao[chave].total > 0,
  ).map((chave) => {
    const taxaBps = taxaPorMetodo[chave]
    const total = divisao[chave].total
    const totalLiquido = taxaBps ? Math.round(total * (1 - taxaBps / 10000)) : total
    return { metodo: chave, total, totalLiquido, taxaBps }
  })

  const totalLiquido = detalhamento.reduce((soma, d) => soma + d.totalLiquido, 0)

  return { totalLiquido, detalhamento }
}

export type PontosAtencao = {
  cancelados: { quantidade: number; valor: number; motivos: Record<string, number> }
  entregaDireta: { quantidade: number }
  itensSemPreco: { pedidos: number; valorEstimado: number }
  itensRemovidos: { quantidade: number }
}

export function calcularPontosAtencao(
  pedidos: PedidoComItens[],
  catalogoPrecos: Map<string, number>,
): PontosAtencao {
  const cancelados = pedidos.filter((p) => p.status === 'cancelado')
  const valorCancelados = cancelados.reduce((soma, p) => soma + calcularTotalPedido(p), 0)
  const motivos: Record<string, number> = {}
  for (const pedido of cancelados) {
    const chave = pedido.motivo_cancelamento ?? 'outro'
    motivos[chave] = (motivos[chave] ?? 0) + 1
  }

  const entregaDireta = naoCancelados(pedidos).filter(ehEntregaDireta)

  let pedidosComItemSemPreco = 0
  let valorEstimado = 0
  for (const pedido of naoCancelados(pedidos)) {
    const semPreco = pedido.itens_do_pedido.filter(
      (item) => !item.removido && item.preco_centavos_unitario === 0,
    )
    if (semPreco.length === 0) continue
    pedidosComItemSemPreco += 1
    for (const item of semPreco) {
      const precoAtual = item.item_id ? catalogoPrecos.get(item.item_id) : undefined
      if (precoAtual) valorEstimado += precoAtual * item.quantidade
    }
  }

  const itensRemovidos = pedidos.reduce(
    (soma, p) => soma + p.itens_do_pedido.filter((item) => item.removido).length,
    0,
  )

  return {
    cancelados: { quantidade: cancelados.length, valor: valorCancelados, motivos },
    entregaDireta: { quantidade: entregaDireta.length },
    itensSemPreco: { pedidos: pedidosComItemSemPreco, valorEstimado },
    itensRemovidos: { quantidade: itensRemovidos },
  }
}

export function calcularTotalItensVendidos(pedidos: PedidoComItens[]): number {
  return naoCancelados(pedidos).reduce(
    (soma, p) =>
      soma + p.itens_do_pedido.filter((item) => !item.removido).reduce((s, item) => s + item.quantidade, 0),
    0,
  )
}

export type ItemMaisVendido = {
  item_id: string | null
  nome_item: string
  quantidade_total: number
  valor_total: number
}

export function calcularMaisVendidos(pedidos: PedidoComItens[]): ItemMaisVendido[] {
  const grupos = new Map<string, ItemMaisVendido>()

  for (const pedido of naoCancelados(pedidos)) {
    for (const item of pedido.itens_do_pedido) {
      if (item.removido) continue
      const chave = item.item_id ?? `nome:${item.nome_item}`
      const atual = grupos.get(chave) ?? {
        item_id: item.item_id,
        nome_item: item.nome_item,
        quantidade_total: 0,
        valor_total: 0,
      }
      atual.quantidade_total += item.quantidade
      atual.valor_total += item.preco_centavos_unitario * item.quantidade
      grupos.set(chave, atual)
    }
  }

  return [...grupos.values()].sort((a, b) => b.quantidade_total - a.quantidade_total).slice(0, 5)
}

export type DivisaoConsumo = { quantidade: number; valor: number; percentual: number }

export type DivisaoPorConsumo = {
  viagem: DivisaoConsumo
  mesaComNumero: DivisaoConsumo
  mesaSemNumero: DivisaoConsumo
}

/** Viagem sempre desabilita o campo mesa (regra de produto), então "mesa
 * sem número" só existe pra quem ficou no local mas não preencheu a mesa. */
export function calcularDivisaoPorConsumo(pedidos: PedidoComItens[]): DivisaoPorConsumo {
  const validos = naoCancelados(pedidos)
  const totalGeral = validos.reduce((soma, p) => soma + calcularTotalPedido(p), 0)

  function bucket(filtro: (p: PedidoComItens) => boolean): DivisaoConsumo {
    const doBucket = validos.filter(filtro)
    const valor = doBucket.reduce((soma, p) => soma + calcularTotalPedido(p), 0)
    return {
      quantidade: doBucket.length,
      valor,
      percentual: totalGeral > 0 ? (valor / totalGeral) * 100 : 0,
    }
  }

  return {
    viagem: bucket((p) => p.viagem),
    mesaComNumero: bucket((p) => !p.viagem && !!p.mesa),
    mesaSemNumero: bucket((p) => !p.viagem && !p.mesa),
  }
}

export type PontoSerie = { chave: string; rotulo: string; valor: number; quantidade: number }

type AcumuladorSerie = { valor: number; quantidade: number }

function pontosDeMapaPorDia(
  mapa: Map<string, AcumuladorSerie>,
  inicio: string,
  fim: string,
): PontoSerie[] {
  const pontos: PontoSerie[] = []
  for (let cursor = inicio; cursor <= fim; cursor = deslocarDias(cursor, 1)) {
    const dado = mapa.get(cursor) ?? { valor: 0, quantidade: 0 }
    const [, mes, dia] = cursor.split('-')
    pontos.push({ chave: cursor, rotulo: `${dia}/${mes}`, valor: dado.valor, quantidade: dado.quantidade })
  }
  return pontos
}

/** Recorta pras horas com movimento de verdade — mostrar as 24h de um dia
 * inclui várias madrugadas vazias que só poluem o gráfico. */
function pontosDeMapaPorHora(mapa: Map<number, AcumuladorSerie>): PontoSerie[] {
  if (mapa.size === 0) return []

  const horasComMovimento = [...mapa.keys()].sort((a, b) => a - b)
  const primeira = horasComMovimento[0]
  const ultima = horasComMovimento[horasComMovimento.length - 1]

  const pontos: PontoSerie[] = []
  for (let hora = primeira; hora <= ultima; hora++) {
    const dado = mapa.get(hora) ?? { valor: 0, quantidade: 0 }
    pontos.push({ chave: String(hora), rotulo: `${hora}h`, valor: dado.valor, quantidade: dado.quantidade })
  }
  return pontos
}

export function calcularSeriePorDia(
  pedidos: PedidoComItens[],
  inicio: string,
  fim: string,
): PontoSerie[] {
  const porDia = new Map<string, AcumuladorSerie>()

  for (const pedido of naoCancelados(pedidos)) {
    const atual = porDia.get(pedido.data_operacao) ?? { valor: 0, quantidade: 0 }
    atual.valor += calcularTotalPedido(pedido)
    atual.quantidade += 1
    porDia.set(pedido.data_operacao, atual)
  }

  return pontosDeMapaPorDia(porDia, inicio, fim)
}

export function calcularSeriePorHora(pedidos: PedidoComItens[]): PontoSerie[] {
  const porHora = new Map<number, AcumuladorSerie>()

  for (const pedido of naoCancelados(pedidos)) {
    const hora = new Date(pedido.criado_em).getHours()
    const atual = porHora.get(hora) ?? { valor: 0, quantidade: 0 }
    atual.valor += calcularTotalPedido(pedido)
    atual.quantidade += 1
    porHora.set(hora, atual)
  }

  return pontosDeMapaPorHora(porHora)
}

/** Mesma lógica de calcularSeriePorDia/Hora, mas isolando um item — usada
 * pelo painel "Desempenho de um item" (produto isolado). `quantidade` aqui
 * é unidades vendidas do item, não número de pedidos. */
export function calcularSerieItemPorDia(
  pedidos: PedidoComItens[],
  itemId: string,
  inicio: string,
  fim: string,
): PontoSerie[] {
  const porDia = new Map<string, AcumuladorSerie>()

  for (const pedido of naoCancelados(pedidos)) {
    for (const item of pedido.itens_do_pedido) {
      if (item.removido || item.item_id !== itemId) continue
      const atual = porDia.get(pedido.data_operacao) ?? { valor: 0, quantidade: 0 }
      atual.valor += item.preco_centavos_unitario * item.quantidade
      atual.quantidade += item.quantidade
      porDia.set(pedido.data_operacao, atual)
    }
  }

  return pontosDeMapaPorDia(porDia, inicio, fim)
}

export function calcularSerieItemPorHora(pedidos: PedidoComItens[], itemId: string): PontoSerie[] {
  const porHora = new Map<number, AcumuladorSerie>()

  for (const pedido of naoCancelados(pedidos)) {
    for (const item of pedido.itens_do_pedido) {
      if (item.removido || item.item_id !== itemId) continue
      const hora = new Date(pedido.criado_em).getHours()
      const atual = porHora.get(hora) ?? { valor: 0, quantidade: 0 }
      atual.valor += item.preco_centavos_unitario * item.quantidade
      atual.quantidade += item.quantidade
      porHora.set(hora, atual)
    }
  }

  return pontosDeMapaPorHora(porHora)
}

export type RitmoDoDia = {
  tempoMedioPreparoMin: number | null
  horarioPico: { hora: number; quantidade: number } | null
}

export function calcularRitmoDoDia(pedidos: PedidoComItens[]): RitmoDoDia {
  const validos = naoCancelados(pedidos)
  if (validos.length < 3) {
    return { tempoMedioPreparoMin: null, horarioPico: null }
  }

  // entrega direta pula o Pronto, entao pronto_em=entregue_em daria preparo
  // ~0min e distorceria a media pra baixo — nao entra na conta
  let somaMinutos = 0
  let contagemPreparo = 0
  for (const pedido of validos) {
    if (!pedido.pronto_em || ehEntregaDireta(pedido)) continue
    somaMinutos += (new Date(pedido.pronto_em).getTime() - new Date(pedido.criado_em).getTime()) / 60000
    contagemPreparo += 1
  }
  const tempoMedioPreparoMin = contagemPreparo > 0 ? Math.round(somaMinutos / contagemPreparo) : null

  const contagemPorHora = new Map<number, number>()
  for (const pedido of validos) {
    const hora = new Date(pedido.criado_em).getHours()
    contagemPorHora.set(hora, (contagemPorHora.get(hora) ?? 0) + 1)
  }

  // varre 0-23 em ordem pra empate resolver sempre pro horario mais cedo
  // ("primeira encontrada")
  let horarioPico: { hora: number; quantidade: number } | null = null
  for (let hora = 0; hora < 24; hora++) {
    const quantidade = contagemPorHora.get(hora) ?? 0
    if (quantidade > 0 && (!horarioPico || quantidade > horarioPico.quantidade)) {
      horarioPico = { hora, quantidade }
    }
  }

  return { tempoMedioPreparoMin, horarioPico }
}

export type TipoFiltroRelatorio = 'hoje' | 'ontem' | '7dias' | 'mes' | 'intervalo'

export type FiltroRelatorio = {
  tipo: TipoFiltroRelatorio
  dataInicio?: string
  dataFim?: string
}

export type IntervaloData = { inicio: string; fim: string }

/** Período de comparação genérico: a janela imediatamente anterior, do
 * mesmo tamanho em dias — mesma lógica que "7 dias" já usava, generalizada
 * pra qualquer intervalo (mês, período customizado). */
function periodoAnterior(intervalo: IntervaloData): IntervaloData {
  const [anoI, mesI, diaI] = intervalo.inicio.split('-').map(Number)
  const [anoF, mesF, diaF] = intervalo.fim.split('-').map(Number)
  const diasNoIntervalo =
    Math.round(
      (new Date(anoF, mesF - 1, diaF).getTime() - new Date(anoI, mesI - 1, diaI).getTime()) / 86400000,
    ) + 1

  return {
    inicio: deslocarDias(intervalo.inicio, -diasNoIntervalo),
    fim: deslocarDias(intervalo.inicio, -1),
  }
}

export function calcularIntervalosRelatorio(filtro: FiltroRelatorio): {
  atual: IntervaloData
  comparacao: IntervaloData
} {
  const hoje = hojeISO()

  if (filtro.tipo === 'hoje') {
    return {
      atual: { inicio: hoje, fim: hoje },
      comparacao: { inicio: deslocarDias(hoje, -7), fim: deslocarDias(hoje, -7) },
    }
  }

  if (filtro.tipo === 'ontem') {
    const ontem = deslocarDias(hoje, -1)
    return {
      atual: { inicio: ontem, fim: ontem },
      comparacao: { inicio: deslocarDias(ontem, -7), fim: deslocarDias(ontem, -7) },
    }
  }

  if (filtro.tipo === '7dias') {
    const atual = { inicio: deslocarDias(hoje, -6), fim: hoje }
    return { atual, comparacao: periodoAnterior(atual) }
  }

  if (filtro.tipo === 'mes') {
    const atual = { inicio: `${hoje.slice(0, 8)}01`, fim: hoje }
    return { atual, comparacao: periodoAnterior(atual) }
  }

  const inicio = filtro.dataInicio ?? hoje
  const fim = filtro.dataFim && filtro.dataFim >= inicio ? filtro.dataFim : inicio
  const atual = { inicio, fim }
  return { atual, comparacao: periodoAnterior(atual) }
}
