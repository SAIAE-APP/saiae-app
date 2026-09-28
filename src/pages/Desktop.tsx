import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { hojeISO } from '../lib/datas'
import type { TipoFiltroRelatorio } from '../lib/relatorio'
import { PainelRelatorio } from '../components/PainelRelatorio'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { BotaoHome } from '../components/ui/BotaoHome'
import { Icone } from '../components/ui/Icone'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import type { Item } from '../types/database'

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

  const [periodo, setPeriodo] = useState<TipoFiltroRelatorio>('hoje')
  const [dataInicio, setDataInicio] = useState(hojeISO())
  const [dataFim, setDataFim] = useState(hojeISO())

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
              <BotaoHome className="-ml-2" />
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

          <div className="mt-5">
            <SegmentedControl
              aria-label="Período do relatório"
              items={PERIODOS.map((p) => ({ label: p.rotulo }))}
              activeIndex={PERIODOS.findIndex((p) => p.valor === periodo)}
              onChange={(indice) => setPeriodo(PERIODOS[indice].valor)}
              className="max-w-xl"
            />
          </div>

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
              itemFiltradoId={itemFiltradoId}
              nomeItemFiltrado={nomeItemFiltrado}
            />
          </div>
        </div>
      </div>
    </GateSenhaAdmin>
  )
}
