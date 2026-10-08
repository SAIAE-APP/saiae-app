import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import { useRelatorio } from '../hooks/useRelatorio'
import { hojeISO } from '../lib/datas'
import { METODOS_OU_NAO_INFORMADO } from '../lib/relatorio'
import type { TipoFiltroRelatorio } from '../lib/relatorio'
import { METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import { MOTIVOS_CANCELAMENTO } from '../lib/cancelamento'
import { formatarPrecoBR } from '../lib/preco'
import { PainelRelatorio } from '../components/PainelRelatorio'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { BotaoHome } from '../components/ui/BotaoHome'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import type { Item } from '../types/database'

const COR_CABECALHO = 'FFFFC21A' // mesa-orange-500 (Sai aê / mostarda), mesmo tom de Historico.tsx

function labelMetodoExportar(chave: string): string {
  if (chave === 'nao_informado') return 'Não informado'
  if (chave === 'na_entrega') return 'A definir na entrega'
  return METODOS_DISPONIVEIS.find((m) => m.chave === chave)?.label ?? chave
}

function motivoExportar(chave: string): string {
  return MOTIVOS_CANCELAMENTO.find((m) => m.valor === chave)?.rotulo ?? chave
}

const PERIODOS: { valor: TipoFiltroRelatorio; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7dias', rotulo: '7 dias' },
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'intervalo', rotulo: 'Período' },
]

/**
 * Hub desktop-only do Sai aê (ver "Roadmap de produto" no CLAUDE.md,
 * decisão de 2026-09-26): Faturamento/Relatório. Caixa saiu daqui em
 * 2026-09-27 e virou rota própria (`/:slug/caixa`, `src/pages/Caixa.tsx`)
 * — item de nav separado na sidebar, mesmo padrão do concorrente que
 * inspirou o pedido. Mesmo app/rota pra todo tamanho de tela — em telas
 * estreitas mostra só um aviso, porque o conteúdo (tabelas, gráficos)
 * não foi desenhado pra caber em mobile.
 */
export function Desktop() {
  const barraca = useBarracaAtual()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'
  const { assinatura } = useAssinaturaBarraca(barraca.slug)
  const planoEssencial = assinatura?.plano === 'essencial'

  const [periodo, setPeriodo] = useState<TipoFiltroRelatorio>('hoje')
  const [dataInicio, setDataInicio] = useState(hojeISO())
  const [dataFim, setDataFim] = useState(hojeISO())
  const [exportando, setExportando] = useState(false)

  const [itensCardapio, setItensCardapio] = useState<Item[]>([])
  const [itemFiltradoId, setItemFiltradoId] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    supabase
      .from('itens')
      .select('*')
      .eq('barraca_id', barraca.id)
      .eq('ativo', true)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado || error) return
        setItensCardapio((data ?? []) as Item[])
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  const filtroRelatorio = { tipo: periodo, dataInicio, dataFim }
  const nomeItemFiltrado = itemFiltradoId
    ? (itensCardapio.find((item) => item.id === itemFiltradoId)?.nome ?? null)
    : null

  const resultado = useRelatorio(barraca, filtroRelatorio, itemFiltradoId)

  // Exporta o relatório atual (mesmo período/produto já filtrado na tela) —
  // reaproveita os dados já calculados por useRelatorio, sem nova busca.
  // Mesmo padrão visual do Exportar de Historico.tsx (cabeçalho mostarda) e
  // mesmo gate de plano (Essencial não exporta).
  async function exportarRelatorio() {
    if (resultado.modo !== 'completo' || !resultado.atual || exportando) return

    setExportando(true)
    try {
      const ExcelJS = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const { atual } = resultado

      function estilizarCabecalho(planilha: import('exceljs').Worksheet, ultimaColuna: string) {
        const linha = planilha.getRow(1)
        // Mostarda é clara demais pra sustentar texto branco (regra da IDV
        // "Sai aê": texto sobre mostarda é sempre tinta).
        linha.font = { bold: true, color: { argb: 'FF18171C' } }
        linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CABECALHO } }
        linha.height = 20
        planilha.views = [{ state: 'frozen', ySplit: 1 }]
        planilha.autoFilter = { from: 'A1', to: `${ultimaColuna}1` }
      }

      const resumo = workbook.addWorksheet('Resumo')
      resumo.columns = [
        { header: 'Métrica', key: 'metrica', width: 24 },
        { header: 'Valor', key: 'valor', width: 20 },
      ]
      estilizarCabecalho(resumo, 'B')
      resumo.addRow({ metrica: 'Faturamento', valor: formatarPrecoBR(atual.totalBruto) })
      resumo.addRow({ metrica: 'Pedidos', valor: atual.quantidadePedidos })
      resumo.addRow({
        metrica: 'Ticket médio',
        valor: formatarPrecoBR(
          atual.quantidadePedidos > 0 ? Math.round(atual.totalBruto / atual.quantidadePedidos) : 0,
        ),
      })
      resumo.addRow({ metrica: 'Itens vendidos', valor: atual.itensVendidos })
      if (atual.descontosCupom.quantidade > 0) {
        // À parte: o faturamento segue sendo a soma dos itens; o recebido nos itens é faturamento − descontos.
        resumo.addRow({ metrica: 'Descontos de cupom (à parte)', valor: formatarPrecoBR(atual.descontosCupom.valor) })
        resumo.addRow({ metrica: 'Recebido nos itens (faturamento − descontos)', valor: formatarPrecoBR(atual.totalBruto - atual.descontosCupom.valor) })
      }
      if (atual.estimativaLiquida) {
        resumo.addRow({
          metrica: 'Estimativa líquida recebida',
          valor: formatarPrecoBR(atual.estimativaLiquida.totalLiquido),
        })
      }

      const metodos = workbook.addWorksheet('Por método de pagamento')
      metodos.columns = [
        { header: 'Método', key: 'metodo', width: 22 },
        { header: 'Valor', key: 'valor', width: 16 },
        { header: 'Comandas', key: 'quantidade', width: 12 },
        { header: 'Percentual', key: 'percentual', width: 12 },
      ]
      estilizarCabecalho(metodos, 'D')
      for (const chave of METODOS_OU_NAO_INFORMADO) {
        const d = atual.divisaoPorMetodo[chave]
        if (d.quantidade === 0) continue
        metodos.addRow({
          metodo: labelMetodoExportar(chave),
          valor: formatarPrecoBR(d.total),
          quantidade: d.quantidade,
          percentual: `${Math.round(d.percentual)}%`,
        })
      }

      const consumo = workbook.addWorksheet('Tipo de atendimento')
      consumo.columns = [
        { header: 'Modo', key: 'modo', width: 22 },
        { header: 'Valor', key: 'valor', width: 16 },
        { header: 'Comandas', key: 'quantidade', width: 12 },
      ]
      estilizarCabecalho(consumo, 'C')
      const { retirada, entrega, mesaComNumero, mesaSemNumero, taxaEntrega } = atual.divisaoPorConsumo
      consumo.addRow({ modo: 'No local (com mesa)', valor: formatarPrecoBR(mesaComNumero.valor), quantidade: mesaComNumero.quantidade })
      consumo.addRow({ modo: 'No local (sem mesa)', valor: formatarPrecoBR(mesaSemNumero.valor), quantidade: mesaSemNumero.quantidade })
      consumo.addRow({ modo: 'Retirada', valor: formatarPrecoBR(retirada.valor), quantidade: retirada.quantidade })
      consumo.addRow({ modo: 'Entrega', valor: formatarPrecoBR(entrega.valor), quantidade: entrega.quantidade })
      // Taxa de entrega fica à parte, fora dos valores acima e do faturamento dos itens.
      consumo.addRow({ modo: 'Taxas de entrega (à parte)', valor: formatarPrecoBR(taxaEntrega.valor), quantidade: taxaEntrega.quantidade })

      const maisVendidos = workbook.addWorksheet('Mais vendidos')
      maisVendidos.columns = [
        { header: 'Item', key: 'item', width: 28 },
        { header: 'Quantidade', key: 'quantidade', width: 14 },
        { header: 'Valor', key: 'valor', width: 16 },
      ]
      estilizarCabecalho(maisVendidos, 'C')
      for (const item of atual.maisVendidos) {
        maisVendidos.addRow({
          item: item.nome_item,
          quantidade: item.quantidade_total,
          valor: item.valor_total > 0 ? formatarPrecoBR(item.valor_total) : '',
        })
      }

      if (atual.opcoesVendidas.length > 0) {
        const opcoes = workbook.addWorksheet('Variações e adicionais')
        opcoes.columns = [
          { header: 'Tipo', key: 'tipo', width: 14 },
          { header: 'Grupo', key: 'grupo', width: 22 },
          { header: 'Opção', key: 'opcao', width: 26 },
          { header: 'Quantidade', key: 'quantidade', width: 14 },
          { header: 'Valor', key: 'valor', width: 16 },
        ]
        estilizarCabecalho(opcoes, 'E')
        for (const o of atual.opcoesVendidas) {
          opcoes.addRow({
            tipo: o.tipo === 'variacao' ? 'Variação' : 'Adicional',
            grupo: o.grupo_nome,
            opcao: o.nome,
            quantidade: o.quantidade_total,
            valor: o.valor_total > 0 ? formatarPrecoBR(o.valor_total) : '',
          })
        }
      }

      const { cancelados, itensSemPreco, itensRemovidos } = atual.pontosAtencao
      if (cancelados.quantidade > 0 || itensSemPreco.pedidos > 0 || itensRemovidos.quantidade > 0) {
        const atencao = workbook.addWorksheet('Pontos de atenção')
        atencao.columns = [
          { header: 'Ponto', key: 'ponto', width: 32 },
          { header: 'Detalhe', key: 'detalhe', width: 40 },
        ]
        estilizarCabecalho(atencao, 'B')
        if (cancelados.quantidade > 0) {
          const motivos = Object.entries(cancelados.motivos)
            .map(([chave, qtd]) => `${qtd} ${motivoExportar(chave)}`)
            .join(', ')
          atencao.addRow({
            ponto: `${cancelados.quantidade} pedido(s) cancelado(s) (${formatarPrecoBR(cancelados.valor)})`,
            detalhe: motivos,
          })
        }
        if (itensSemPreco.pedidos > 0) {
          atencao.addRow({
            ponto: `${itensSemPreco.pedidos} pedido(s) com item sem preço`,
            detalhe:
              itensSemPreco.valorEstimado > 0
                ? `Pode ter subestimado em ~${formatarPrecoBR(itensSemPreco.valorEstimado)}`
                : '',
          })
        }
        if (itensRemovidos.quantidade > 0) {
          atencao.addRow({ ponto: `${itensRemovidos.quantidade} item(ns) removido(s) de comandas`, detalhe: '' })
        }
      }

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `faturamento-${barraca.slug}-${periodo}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportando(false)
    }
  }

  return (
    <GateSenhaAdmin key={barraca.id} barracaId={barraca.id} slug={barraca.slug}>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
        <Icone nome="desktop_windows" size={40} className="text-mesa-text-tertiary" />
        <p className="text-base font-semibold text-mesa-text-primary">Esta área é feita para desktop</p>
        <p className="text-sm text-mesa-text-secondary">
          Abra o Sai aê num computador para ver Faturamento e Relatório.
        </p>
        <BotaoHome className="mt-2" />
      </div>

      <div className="hidden min-h-dvh px-8 pb-24 pt-[calc(env(safe-area-inset-top)+24px)] md:block">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BotaoHome />
              <h1 className="text-2xl font-bold leading-tight text-mesa-text-primary">Faturamento</h1>
            </div>
            <button
              type="button"
              onClick={alternarTema}
              aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              className={classesBotaoIcone()}
            >
              {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <SegmentedControl
              aria-label="Período do relatório"
              items={PERIODOS.map((p) => ({ label: p.rotulo }))}
              activeIndex={PERIODOS.findIndex((p) => p.valor === periodo)}
              onChange={(indice) => setPeriodo(PERIODOS[indice].valor)}
              className="max-w-xl"
            />
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="download" size={16} />}
              onClick={exportarRelatorio}
              disabled={resultado.modo !== 'completo' || !resultado.atual || planoEssencial}
              loading={exportando}
              title={planoEssencial ? 'Exportar relatórios é exclusivo do plano Pro' : undefined}
              className="shrink-0"
            >
              Exportar
            </Button>
          </div>
          {planoEssencial && (
            <p className="mt-1.5 text-xs text-mesa-text-tertiary">
              Exportar é exclusivo do plano Pro — fale com o suporte pra fazer upgrade.
            </p>
          )}

          <div className="mt-3">
            <select
              value={itemFiltradoId ?? ''}
              onChange={(e) => setItemFiltradoId(e.target.value || null)}
              className="h-10 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
            >
              <option value="">Todos os produtos</option>
              {itensCardapio.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                </option>
              ))}
            </select>
          </div>

          {periodo === 'intervalo' && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="date"
                value={dataInicio}
                max={dataFim}
                onChange={(e) => setDataInicio(e.target.value)}
                aria-label="Data de início"
                className="h-10 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
              />
              <span className="text-sm text-mesa-text-secondary">até</span>
              <input
                type="date"
                value={dataFim}
                min={dataInicio}
                max={hojeISO()}
                onChange={(e) => setDataFim(e.target.value)}
                aria-label="Data de fim"
                className="h-10 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500"
              />
            </div>
          )}

          <div className="mt-5">
            <PainelRelatorio
              barraca={barraca}
              filtro={filtroRelatorio}
              resultado={resultado}
              nomeItemFiltrado={nomeItemFiltrado}
            />
          </div>
        </div>
      </div>
    </GateSenhaAdmin>
  )
}
