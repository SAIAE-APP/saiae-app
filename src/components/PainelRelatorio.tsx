import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { FiltroRelatorio, ResultadoRelatorio } from '../hooks/useRelatorio'
import { useEvolucao14Dias } from '../hooks/useEvolucao14Dias'
import { calcularIntervalosRelatorio, METODOS_OU_NAO_INFORMADO } from '../lib/relatorio'
import type { DetalhamentoLiquido, IntervaloData, MetodoOuNaoInformado } from '../lib/relatorio'
import { formatarPrecoBR } from '../lib/preco'
import { bpsParaPercentual } from '../lib/taxas'
import { METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import { MOTIVOS_CANCELAMENTO } from '../lib/cancelamento'
import { GraficoBarras } from './charts/GraficoBarras'
import { ListaBarras } from './charts/ListaBarras'
import { SecaoCustoLucro } from './SecaoCustoLucro'
import { SecaoRelatorio } from './SecaoRelatorio'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { SegmentedControl } from './ui/SegmentedControl'
import type { Barraca } from '../types/database'

function formatarDataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map(Number)
  return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
}

function tituloRelatorio(filtro: FiltroRelatorio, intervalos: { atual: IntervaloData }): string {
  if (filtro.tipo === 'hoje') return 'Relatório de hoje'
  if (filtro.tipo === 'ontem') return 'Relatório de ontem'
  if (filtro.tipo === '7dias') return 'Relatório dos últimos 7 dias'
  if (filtro.tipo === 'mes') return 'Relatório do mês'

  const { inicio, fim } = intervalos.atual
  if (inicio === fim) return `Relatório de ${formatarDataCurta(inicio)}`
  return `Relatório de ${formatarDataCurta(inicio)} a ${formatarDataCurta(fim)}`
}

// já vem com a preposição certa embutida — "nos últimos 7 dias" não leva
// "em" na frente, "hoje"/"ontem" tampouco, só datas específicas levam "em"/"de"
function fraseDoPeriodo(filtro: FiltroRelatorio, intervalos: { atual: IntervaloData }): string {
  if (filtro.tipo === 'hoje') return 'hoje'
  if (filtro.tipo === 'ontem') return 'ontem'
  if (filtro.tipo === '7dias') return 'nos últimos 7 dias'
  if (filtro.tipo === 'mes') return 'neste mês'

  const { inicio, fim } = intervalos.atual
  if (inicio === fim) return `em ${formatarDataCurta(inicio)}`
  return `de ${formatarDataCurta(inicio)} a ${formatarDataCurta(fim)}`
}

function nomeDoDia(iso: string): string {
  const [ano, mes, dia] = iso.split('-').map(Number)
  const data = new Date(ano, mes - 1, dia)
  return data.toLocaleDateString('pt-BR', { weekday: 'long' })
}

function motivoEmMinusculo(chave: string): string {
  const rotulo = MOTIVOS_CANCELAMENTO.find((m) => m.valor === chave)?.rotulo ?? chave
  return rotulo.toLowerCase()
}

function labelMetodo(chave: MetodoOuNaoInformado): string {
  if (chave === 'nao_informado') return 'Método não informado'
  const metodo = METODOS_DISPONIVEIS.find((m) => m.chave === chave)
  return metodo?.label ?? chave
}

function textoDetalhamentoLiquido(detalhamento: DetalhamentoLiquido[]): string {
  return detalhamento
    .map((d) => {
      const label = labelMetodo(d.metodo)
      const sufixo = d.taxaBps
        ? `após ${bpsParaPercentual(d.taxaBps)}%`
        : d.metodo === 'debito' || d.metodo === 'credito'
          ? 'taxa não configurada'
          : 'sem taxa'
      return `${label} ${formatarPrecoBR(d.totalLiquido)} (${sufixo})`
    })
    .join(' + ')
}

/** Monta "vs {label} passado: +R$ X (+Y%)" ou "sem comparação" — reusado tanto
 * pelo modo completo (total bruto) quanto pelo modo produto isolado (total
 * do produto), já que a mecânica de comparação é idêntica nos dois. */
function textoEcorComparacao(
  atualValor: number,
  comparacaoValor: number,
  labelComparacao: string,
  formatarValor: (valor: number) => string = formatarPrecoBR,
): { texto: string; cor: string } {
  const diferenca = atualValor - comparacaoValor
  const percentual = comparacaoValor > 0 ? (diferenca / comparacaoValor) * 100 : null
  const sinal = diferenca >= 0 ? '+' : '-'

  const texto =
    comparacaoValor === 0
      ? 'sem comparação'
      : `vs ${labelComparacao}: ${sinal}${formatarValor(Math.abs(diferenca))} (${sinal}${Math.round(
          Math.abs(percentual ?? 0),
        )}%)`
  const cor = comparacaoValor > 0 && diferenca > 0 ? 'text-mesa-success-700 dark:text-mesa-success-500' : 'text-mesa-text-secondary'

  return { texto, cor }
}

/** Delta compacto (só percentual) pra caber nos cards de KPI — a versão
 * completa com valor absoluto é textoEcorComparacao acima, usada onde tem
 * mais espaço (produto isolado). */
function deltaPercentual(
  atualValor: number,
  comparacaoValor: number,
  labelComparacao: string,
): { texto: string; cor: string } {
  if (comparacaoValor === 0) {
    return { texto: 'sem comparação', cor: 'text-mesa-text-tertiary' }
  }
  const diferenca = atualValor - comparacaoValor
  const percentual = Math.round(Math.abs((diferenca / comparacaoValor) * 100))
  const sinal = diferenca >= 0 ? '+' : '-'
  const cor =
    diferenca > 0 ? 'text-mesa-success-700 dark:text-mesa-success-500' : 'text-mesa-text-secondary'
  return { texto: `${sinal}${percentual}% vs ${labelComparacao}`, cor }
}

function CartaoKpi({
  rotulo,
  valor,
  texto,
  cor,
}: {
  rotulo: string
  valor: string
  texto: string
  cor: string
}) {
  return (
    <div className="rounded-mesa-xl border border-mesa-border-subtle bg-mesa-surface p-3">
      <p className="text-xs font-medium text-mesa-text-secondary">{rotulo}</p>
      <p className="mt-1 font-mesa-display text-2xl font-bold text-mesa-text-primary">{valor}</p>
      <p className={`mt-0.5 text-xs font-medium ${cor}`}>{texto}</p>
    </div>
  )
}

function CartaoRelatorio({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-mesa-2xl border border-mesa-border-subtle bg-mesa-neutral-50 p-4 dark:bg-mesa-neutral-900/60">
      {children}
    </div>
  )
}

function Carregando() {
  return (
    <CartaoRelatorio>
      <p className="text-center text-sm text-mesa-text-secondary">Calculando relatório...</p>
    </CartaoRelatorio>
  )
}

function Erro() {
  return (
    <CartaoRelatorio>
      <p className="text-center text-sm text-mesa-error-500">Não foi possível calcular o relatório.</p>
    </CartaoRelatorio>
  )
}

export function PainelRelatorio({
  barraca,
  filtro,
  resultado,
  nomeItemFiltrado = null,
}: {
  barraca: Barraca
  filtro: FiltroRelatorio
  resultado: ResultadoRelatorio
  nomeItemFiltrado?: string | null
}) {
  const evolucao14Dias = useEvolucao14Dias(barraca.id)
  const [metricaItem, setMetricaItem] = useState<'valor' | 'quantidade'>('valor')

  // mesmo motivo do useRelatorio: depende dos campos primitivos, não do
  // objeto filtro (que o Historico passa como literal inline)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const intervalos = useMemo(() => calcularIntervalosRelatorio(filtro), [filtro.tipo, filtro.dataInicio, filtro.dataFim])

  if (resultado.carregando || !resultado.atual) return <Carregando />
  if (resultado.erro) return <Erro />

  const periodoDeUmDiaSo = intervalos.atual.inicio === intervalos.atual.fim
  const labelComparacao = periodoDeUmDiaSo
    ? `${nomeDoDia(intervalos.comparacao.inicio)} passado`
    : 'período anterior'

  // ---- modo produto isolado: painel simplificado, uma unica secao ----
  if (resultado.modo === 'produto_isolado') {
    const { atual, comparacao } = resultado
    const semVendas = atual.unidadesVendidas === 0

    const formatarUnidades = (valor: number) => `${valor} un.`
    const valorPrincipal = metricaItem === 'valor' ? atual.totalIsolado : atual.unidadesVendidas
    const valorComparacao =
      metricaItem === 'valor' ? (comparacao?.totalIsolado ?? 0) : (comparacao?.unidadesVendidas ?? 0)
    const formatarPrincipal = metricaItem === 'valor' ? formatarPrecoBR : formatarUnidades

    const { texto: textoComparacao, cor: corComparacao } = textoEcorComparacao(
      valorPrincipal,
      valorComparacao,
      labelComparacao,
      formatarPrincipal,
    )

    return (
      <CartaoRelatorio>
        <h2 className="text-lg font-bold text-mesa-text-primary">
          Relatório de {nomeItemFiltrado ?? 'produto'} {fraseDoPeriodo(filtro, intervalos)}
        </h2>

        {semVendas ? (
          <p className="mt-4 text-center text-sm text-mesa-text-secondary">
            Ainda não há vendas para analisar
          </p>
        ) : (
          <div className="mt-3">
            <SegmentedControl
              aria-label="Ver em reais ou em unidades"
              items={[{ label: 'R$' }, { label: 'Unidades' }]}
              activeIndex={metricaItem === 'valor' ? 0 : 1}
              onChange={(indice) => setMetricaItem(indice === 0 ? 'valor' : 'quantidade')}
              className="max-w-56"
            />

            <p className="mt-3 font-mesa-display text-4xl font-black text-mesa-text-primary">
              {formatarPrincipal(valorPrincipal)}
            </p>
            <p className="text-sm text-mesa-text-secondary">
              {atual.unidadesVendidas} unidade{atual.unidadesVendidas === 1 ? '' : 's'} vendida
              {atual.unidadesVendidas === 1 ? '' : 's'}
            </p>
            <p className={`mt-1 text-sm font-medium ${corComparacao}`}>{textoComparacao}</p>

            {atual.serieTemporal.pontos.length > 0 && (
              <GraficoBarras
                pontos={atual.serieTemporal.pontos.map((p) => ({
                  chave: p.chave,
                  rotulo: p.rotulo,
                  valor: metricaItem === 'valor' ? p.valor : p.quantidade,
                }))}
                formatarValor={formatarPrincipal}
                rotuloAcessivel={`Evolução de ${nomeItemFiltrado ?? 'produto'} no período`}
              />
            )}
          </div>
        )}
      </CartaoRelatorio>
    )
  }

  // ---- modo completo ----
  const { atual, comparacao } = resultado

  const ticketMedioAtual = atual.quantidadePedidos > 0 ? Math.round(atual.totalBruto / atual.quantidadePedidos) : 0
  const ticketMedioComparacao =
    comparacao && comparacao.quantidadePedidos > 0
      ? Math.round(comparacao.totalBruto / comparacao.quantidadePedidos)
      : 0

  const metodosComValor = METODOS_OU_NAO_INFORMADO.filter(
    (chave) => atual.divisaoPorMetodo[chave].quantidade > 0,
  )

  const { viagem, mesaComNumero, mesaSemNumero } = atual.divisaoPorConsumo
  const temDadosDeConsumo = viagem.quantidade + mesaComNumero.quantidade + mesaSemNumero.quantidade > 0

  const { cancelados, entregaDireta, itensSemPreco, itensRemovidos } = atual.pontosAtencao
  const mostraEntregaDireta = periodoDeUmDiaSo
  const mostraRitmo = periodoDeUmDiaSo

  const linhasAtencao: { texto: string; subtitulo?: string }[] = []

  if (cancelados.quantidade > 0) {
    const motivosTexto = Object.entries(cancelados.motivos)
      .map(([chave, qtd]) => `${qtd} ${motivoEmMinusculo(chave)}`)
      .join(', ')
    linhasAtencao.push({
      texto: `${cancelados.quantidade} pedido${cancelados.quantidade === 1 ? '' : 's'} cancelado${
        cancelados.quantidade === 1 ? '' : 's'
      } (${formatarPrecoBR(cancelados.valor)} não faturados)`,
      subtitulo: `Motivos: ${motivosTexto}`,
    })
  }

  if (mostraEntregaDireta && entregaDireta.quantidade > 0) {
    linhasAtencao.push({
      texto: `${entregaDireta.quantidade} pedido${
        entregaDireta.quantidade === 1 ? '' : 's'
      } com entrega direta`,
    })
  }

  if (itensSemPreco.pedidos > 0) {
    const sufixo =
      itensSemPreco.valorEstimado > 0
        ? ` — pode ter subestimado em ~${formatarPrecoBR(itensSemPreco.valorEstimado)}`
        : ''
    linhasAtencao.push({
      texto: `${itensSemPreco.pedidos} pedido${
        itensSemPreco.pedidos === 1 ? '' : 's'
      } com item sem preço cadastrado${sufixo}`,
    })
  }

  if (itensRemovidos.quantidade > 0) {
    linhasAtencao.push({
      texto: `${itensRemovidos.quantidade} ${
        itensRemovidos.quantidade === 1 ? 'item removido' : 'itens removidos'
      } de comandas ao longo do período`,
    })
  }

  const temAtencao = linhasAtencao.length > 0

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-mesa-text-primary">{tituloRelatorio(filtro, intervalos)}</h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CartaoKpi
            rotulo="Faturamento"
            valor={formatarPrecoBR(atual.totalBruto)}
            {...deltaPercentual(atual.totalBruto, comparacao?.totalBruto ?? 0, labelComparacao)}
          />
          <CartaoKpi
            rotulo="Pedidos"
            valor={String(atual.quantidadePedidos)}
            {...deltaPercentual(atual.quantidadePedidos, comparacao?.quantidadePedidos ?? 0, labelComparacao)}
          />
          <CartaoKpi
            rotulo="Ticket médio"
            valor={formatarPrecoBR(ticketMedioAtual)}
            {...deltaPercentual(ticketMedioAtual, ticketMedioComparacao, labelComparacao)}
          />
          <CartaoKpi
            rotulo="Itens vendidos"
            valor={String(atual.itensVendidos)}
            {...deltaPercentual(atual.itensVendidos, comparacao?.itensVendidos ?? 0, labelComparacao)}
          />
        </div>

        {atual.serieTemporal.pontos.length > 0 && (
          <GraficoBarras
            pontos={atual.serieTemporal.pontos}
            formatarValor={formatarPrecoBR}
            rotuloAcessivel={
              atual.serieTemporal.granularidade === 'dia'
                ? 'Faturamento por dia no período'
                : 'Faturamento por hora no período'
            }
          />
        )}
      </Card>

      {evolucao14Dias.pontos.length > 0 && (
        <SecaoRelatorio titulo="Evolução do faturamento (14 dias)" icone="show_chart">
          <GraficoBarras
            pontos={evolucao14Dias.pontos}
            formatarValor={formatarPrecoBR}
            rotuloAcessivel="Faturamento por dia nos últimos 14 dias"
          />
        </SecaoRelatorio>
      )}

      {atual.quantidadePedidos > 0 && (
        <SecaoRelatorio titulo="Por método de pagamento" icone="payments">
          <ListaBarras
            itens={metodosComValor.map((chave) => {
              const d = atual.divisaoPorMetodo[chave]
              return {
                chave,
                rotulo: labelMetodo(chave),
                valor: d.total,
                rotuloValor: `${formatarPrecoBR(d.total)} (${Math.round(d.percentual)}%)`,
              }
            })}
          />
        </SecaoRelatorio>
      )}

      {temDadosDeConsumo && (
        <SecaoRelatorio titulo="Mesa vs Viagem" icone="table_restaurant">
          <ListaBarras
            itens={[
              {
                chave: 'mesa-com-numero',
                rotulo: 'No local (com mesa)',
                valor: mesaComNumero.valor,
                rotuloValor: `${mesaComNumero.quantidade} comanda${mesaComNumero.quantidade === 1 ? '' : 's'}`,
              },
              {
                chave: 'mesa-sem-numero',
                rotulo: 'No local (sem mesa)',
                valor: mesaSemNumero.valor,
                rotuloValor: `${mesaSemNumero.quantidade} comanda${mesaSemNumero.quantidade === 1 ? '' : 's'}`,
              },
              {
                chave: 'viagem',
                rotulo: 'Viagem',
                valor: viagem.valor,
                rotuloValor: `${viagem.quantidade} comanda${viagem.quantidade === 1 ? '' : 's'}`,
              },
            ]}
          />
        </SecaoRelatorio>
      )}

      {atual.estimativaLiquida && (
        <SecaoRelatorio titulo="Estimativa recebida" icone="account_balance_wallet">
          <div>
            <p className="font-mesa-display text-3xl font-black text-mesa-text-primary">
              {formatarPrecoBR(atual.estimativaLiquida.totalLiquido)}
            </p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {textoDetalhamentoLiquido(atual.estimativaLiquida.detalhamento)}
            </p>
            <p className="mt-2 text-xs text-mesa-text-tertiary">
              Estimativa. Pode divergir do extrato por descontos, cortesias, fiado etc.
            </p>
          </div>
        </SecaoRelatorio>
      )}

      <SecaoCustoLucro
        barraca={barraca}
        intervalo={intervalos.atual}
        receitaLiquidaCentavos={atual.estimativaLiquida?.totalLiquido ?? atual.totalBruto}
      />

      <SecaoRelatorio titulo="Mais vendidos" icone="local_fire_department">
        {atual.maisVendidos.length === 0 ? (
          <p className="text-sm text-mesa-text-secondary">Sem dados no período</p>
        ) : (
          <ListaBarras
            itens={atual.maisVendidos.map((item) => ({
              chave: item.item_id ?? item.nome_item,
              rotulo: item.nome_item,
              valor: item.quantidade_total,
              rotuloValor: `${item.quantidade_total} un.${
                item.valor_total > 0 ? ` (${formatarPrecoBR(item.valor_total)})` : ''
              }`,
            }))}
          />
        )}
      </SecaoRelatorio>

      {mostraRitmo && (
        <SecaoRelatorio titulo="Ritmo" icone="schedule">
          {atual.ritmoDoDia.horarioPico === null ? (
            <p className="text-sm text-mesa-text-secondary">Ainda sem dados suficientes</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-mesa-md bg-mesa-surface-alt p-3">
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-mesa-text-tertiary">
                  <Icone nome="timer" size={12} />
                  Preparo médio
                </p>
                <p className="mt-1 font-mesa-display text-lg font-bold text-mesa-text-primary">
                  {atual.ritmoDoDia.tempoMedioPreparoMin === null
                    ? '—'
                    : `${atual.ritmoDoDia.tempoMedioPreparoMin} min`}
                </p>
              </div>
              <div className="rounded-mesa-md bg-mesa-surface-alt p-3">
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-mesa-text-tertiary">
                  <Icone nome="trending_up" size={12} />
                  Horário de pico
                </p>
                <p className="mt-1 font-mesa-display text-lg font-bold text-mesa-text-primary">
                  {atual.ritmoDoDia.horarioPico.hora}h–{atual.ritmoDoDia.horarioPico.hora + 1}h
                </p>
                <p className="text-xs text-mesa-text-secondary">
                  {atual.ritmoDoDia.horarioPico.quantidade} comanda
                  {atual.ritmoDoDia.horarioPico.quantidade === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          )}
        </SecaoRelatorio>
      )}

      <div
        className={clsx(
          'rounded-mesa-2xl border p-4',
          temAtencao
            ? 'border-transparent bg-mesa-warning-50 dark:bg-mesa-warning-500/10'
            : 'border-transparent bg-mesa-success-50 dark:bg-mesa-success-500/10',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'flex size-7 shrink-0 items-center justify-center rounded-mesa-md',
              temAtencao
                ? 'bg-mesa-warning-500/20 text-mesa-warning-700 dark:text-mesa-warning-500'
                : 'bg-mesa-success-500/20 text-mesa-success-700 dark:text-mesa-success-500',
            )}
          >
            <Icone nome={temAtencao ? 'warning' : 'check_circle'} size={16} />
          </span>
          <h3 className="text-sm font-bold text-mesa-text-primary">Pontos de atenção</h3>
        </div>

        {temAtencao ? (
          <ul className="mt-3 flex flex-col gap-2.5">
            {linhasAtencao.map((linha, indice) => (
              <li key={indice} className="border-t border-mesa-warning-500/20 pt-2.5 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-mesa-text-primary">{linha.texto}</p>
                {linha.subtitulo && (
                  <p className="text-xs text-mesa-text-secondary">{linha.subtitulo}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm font-medium text-mesa-success-700 dark:text-mesa-success-500">
            Nenhum ponto de atenção no período
          </p>
        )}
      </div>
    </div>
  )
}
