import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { Chip } from '../components/ui/Chip'
import { AcoesBarraca } from '../components/admin/AcoesBarraca'
import { BarraBuscaAdmin } from '../components/admin/BarraBuscaAdmin'
import { HistoricoAcoesAdmin } from '../components/admin/HistoricoAcoesAdmin'
import { useAdminHistorico } from '../hooks/useAdminHistorico'
import { TAMANHO_PAGINA_ADMIN, useAdminAlertas, useAdminBarracas, useAdminContagens, useAdminResumo, useSouSuperadmin } from '../hooks/useAdminBarracas'
import {
  FILTROS_ADMIN,
  NOME_ESTADO_ADMIN,
  VARIANTE_ESTADO_ADMIN,
  quedaDePedidos,
  rotuloDia,
  temAlerta,
  versaoMaisUsada,
  textoDiasRestantes,
  type AdminAlertas,
  type AdminResumo,
  type FiltroAdminBarracas,
  type OrdemAdmin,
} from '../lib/adminBarracas'
import { NaoEncontrado } from './NaoEncontrado'

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'
}

function CartaoNumero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-2xl font-semibold text-mesa-text-primary">{valor}</span>
      <span className="text-sm text-mesa-text-secondary">{rotulo}</span>
    </Card>
  )
}

function ResumoAtivas({ resumo }: { resumo: AdminResumo }) {
  const maximo = Math.max(1, ...resumo.pedidos_por_dia.map((d) => d.pedidos))
  return (
    <section className="flex flex-col gap-3" aria-label="Resumo">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <CartaoNumero rotulo={`Ativas agora (${resumo.janela_horas} h)`} valor={resumo.ativas_agora} />
        <CartaoNumero rotulo="Pedidos hoje" valor={resumo.pedidos_hoje} />
        <CartaoNumero rotulo="Novas em 7 dias" valor={resumo.barracas_novas_7d} />
        <CartaoNumero rotulo="Trials acabam em 7 dias" valor={resumo.trials_acabando_7d} />
        <CartaoNumero rotulo="Vendiam e pararam" valor={resumo.pararam.length} />
      </div>

      {resumo.pedidos_hoje_por_barraca.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-mesa-text-primary">Top barracas hoje</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {resumo.pedidos_hoje_por_barraca.map((b) => (
              <li key={b.barraca_id} className="flex justify-between gap-2">
                <span className="truncate text-mesa-text-secondary">{b.nome}</span>
                <span className="text-mesa-text-primary">{b.pedidos}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {resumo.pararam.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-mesa-text-primary">Vendiam e pararam (3 dias sem pedido)</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {resumo.pararam.map((b) => (
              <li key={b.barraca_id} className="flex justify-between gap-2">
                <span className="truncate text-mesa-text-secondary">{b.nome}</span>
                <span className="text-mesa-text-primary">último em {formatarData(b.ultimo_pedido_em)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-mesa-text-primary">Pedidos por dia (14 dias)</h2>
        <div className="flex h-24 items-end gap-1" role="img" aria-label="Pedidos por dia nos últimos 14 dias">
          {resumo.pedidos_por_dia.map((d) => (
            <div
              key={d.dia}
              title={`${rotuloDia(d.dia)}: ${d.pedidos}`}
              className="flex-1 rounded-t bg-mesa-orange-500"
              style={{ height: `${Math.max(2, (d.pedidos / maximo) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-mesa-text-secondary">
          <span>{rotuloDia(resumo.pedidos_por_dia[0].dia)}</span>
          <span>{rotuloDia(resumo.pedidos_por_dia[resumo.pedidos_por_dia.length - 1].dia)}</span>
        </div>
      </Card>
    </section>
  )
}

function PainelAlertas({ alertas }: { alertas: AdminAlertas }) {
  return (
    <Card role="alert" className="flex flex-col gap-1 border-mesa-error-500">
      <h2 className="text-sm font-semibold text-mesa-text-primary">Alertas</h2>
      {alertas.parou.map((b) => (
        <p key={b.barraca_id} className="text-sm text-mesa-text-secondary">
          {b.nome} vendia e está há 3 dias sem pedido (último em {formatarData(b.ultimo_pedido_em)}).
        </p>
      ))}
      {alertas.pico_erros.map((p) => (
        <p key={p.versao} className="text-sm text-mesa-text-secondary">
          {p.erros} erros na última hora na versão {p.versao}.
        </p>
      ))}
      {alertas.webhook_falhas > 0 && (
        <p className="text-sm text-mesa-text-secondary">
          {alertas.webhook_falhas} falhas de webhook de pagamento (Stripe) nas últimas 24 h.
        </p>
      )}
    </Card>
  )
}

function ErroComRetry({ texto, aoTentar }: { texto: string; aoTentar: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-mesa-text-secondary">{texto}</p>
      <Button variant="outline" className="min-h-11" onClick={aoTentar}>
        Tentar de novo
      </Button>
    </div>
  )
}

const CHAVE_VISAO_GERAL = 'admin-visao-geral-vista'

/** Aberto só na primeira visita; depois lembra no localStorage (que pode falhar: privado, bloqueado). */
function useVisaoGeralAberta() {
  const [aberta, setAberta] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_VISAO_GERAL) === null
    } catch {
      return true
    }
  })
  const alternar = () => {
    setAberta((v) => !v)
    try {
      localStorage.setItem(CHAVE_VISAO_GERAL, '1')
    } catch {
      /* sem armazenamento: o bloco só não lembra */
    }
  }
  return [aberta, alternar] as const
}

/** Painel do dono do sistema: barracas, visão geral e histórico de ações. */
export function AdminBarracas() {
  const navigate = useNavigate()
  const ehSuperadmin = useSouSuperadmin()
  const [filtro, setFiltro] = useState<FiltroAdminBarracas | null>(null)
  const [plano, setPlano] = useState<'essencial' | 'pro' | null>(null)
  const [pagina, setPagina] = useState(0)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<OrdemAdmin>('vencimento')
  const [visaoAberta, alternarVisao] = useVisaoGeralAberta()
  const { linhas, total, carregando, erro, recarregar } = useAdminBarracas(filtro, plano, pagina, busca, ordem)
  const { contagens, erro: erroContagens, recarregar: recarregarContagens } = useAdminContagens(ehSuperadmin === true)
  const { resumo, erro: erroResumo, recarregar: recarregarResumo } = useAdminResumo(ehSuperadmin === true)
  const { dados: alertas } = useAdminAlertas(ehSuperadmin === true)
  const { linhas: acoesLog, erro: erroHistorico, recarregar: recarregarHistorico } = useAdminHistorico(ehSuperadmin === true)
  const aoBuscar = useCallback((texto: string) => {
    setBusca(texto)
    setPagina(0)
  }, [])

  if (ehSuperadmin === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }
  if (!ehSuperadmin) return <NaoEncontrado />

  const ultimaPagina = Math.max(0, Math.ceil(total / TAMANHO_PAGINA_ADMIN) - 1)
  // A versão "atual" vale para a página carregada (até 50 barracas).
  const versaoAtual = versaoMaisUsada(linhas)

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 bg-mesa-bg-base p-4">
      <CabecalhoPagina titulo="Barracas" aoClicarHome={() => navigate('/')} />

      <BarraBuscaAdmin
        aoBuscar={aoBuscar}
        ordem={ordem}
        aoOrdenar={(o) => {
          setOrdem(o)
          setPagina(0)
        }}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros">
        {FILTROS_ADMIN.map((f) => {
          const n = contagens[f.valor ?? 'todas']
          return (
            <Chip
              key={f.rotulo}
              className="min-h-11"
              checked={filtro === f.valor}
              onClick={() => {
                setFiltro(f.valor)
                setPagina(0)
              }}
            >
              {n === undefined ? f.rotulo : `${f.rotulo} (${n})`}
            </Chip>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Plano">
        {([null, 'essencial', 'pro'] as const).map((p) => (
          <Chip
            key={p ?? 'todos'}
            className="min-h-11"
            checked={plano === p}
            onClick={() => {
              setPlano(p)
              setPagina(0)
            }}
          >
            {p === null ? 'Todos os planos' : p === 'pro' ? 'Pro' : 'Essencial'}
          </Chip>
        ))}
      </div>

      {erroContagens && <ErroComRetry texto="Não foi possível carregar as contagens dos filtros." aoTentar={recarregarContagens} />}
      {erro && <ErroComRetry texto={erro} aoTentar={recarregar} />}
      {!erro && !carregando && linhas.length === 0 && (
        <p className="text-mesa-text-secondary">Nenhuma barraca neste filtro.</p>
      )}

      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {linhas.map((b) => (
          <li key={b.barraca_id} className="min-w-0">
            <Card className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-mesa-text-primary">{b.nome}</p>
                  <p className="truncate text-sm text-mesa-text-secondary">
                    /{b.slug} · {b.email_dono}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  <Badge variant={VARIANTE_ESTADO_ADMIN[b.estado]}>{NOME_ESTADO_ADMIN[b.estado]}</Badge>
                  {b.bloqueada && <Badge variant="danger">Bloqueada</Badge>}
                  {b.origem_plano === 'legado' && <Badge variant="neutral">Legado</Badge>}
                  {b.arquivada_em && <Badge variant="warning">Arquivada</Badge>}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-mesa-text-secondary">
                <dt>Plano</dt>
                <dd className="text-mesa-text-primary">{b.plano === 'pro' ? 'Pro' : b.plano === 'essencial' ? 'Essencial' : '—'}</dd>
                <dt>Início</dt>
                <dd className="text-mesa-text-primary">{formatarData(b.inicio_em)}</dd>
                <dt>Vencimento</dt>
                <dd className="text-mesa-text-primary">
                  {formatarData(b.vencimento_em)} ({textoDiasRestantes(b.dias_restantes)})
                </dd>
                <dt>Acesso</dt>
                <dd className="text-mesa-text-primary">{b.tem_acesso ? 'Liberado' : 'Bloqueado'}</dd>
                <dt>Cobrança</dt>
                <dd className="text-mesa-text-primary">{b.origem_cobranca === 'stripe' ? 'Stripe' : '—'}</dd>
                <dt>Último pagamento</dt>
                <dd className="text-mesa-text-primary">{formatarData(b.ultimo_pagamento_em)}</dd>
              </dl>
              <div className="flex flex-wrap items-center gap-2 text-sm text-mesa-text-secondary">
                <span>
                  {b.pedidos_7d} pedidos em 7 dias (antes: {b.pedidos_semana_anterior})
                </span>
                {quedaDePedidos(b) && <Badge variant="warning">queda</Badge>}
                {b.erros_24h > 0 && <Badge variant="danger">{b.erros_24h} erros</Badge>}
                <span>{b.versao_app ? `${b.plataforma} ${b.versao_app}` : 'versão desconhecida'}</span>
                {b.versao_app && versaoAtual && b.versao_app !== versaoAtual && <Badge variant="neutral">desatualizada</Badge>}
              </div>
              {b.bloqueada && b.bloqueio_motivo && (
                <p className="text-sm text-mesa-text-secondary">Motivo do bloqueio: {b.bloqueio_motivo}</p>
              )}
              <AcoesBarraca
                barraca={b}
                onConcluido={() => {
                  recarregar()
                  recarregarContagens()
                  recarregarHistorico()
                }}
              />
              <Button variant="outline" className="min-h-11" onClick={() => navigate(`/admin/barraca/${b.barraca_id}`)}>
                Abrir (somente leitura)
              </Button>
            </Card>
          </li>
        ))}
      </ul>

      {total > TAMANHO_PAGINA_ADMIN && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" className="min-h-11" disabled={pagina === 0 || carregando} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-mesa-text-secondary">
            {pagina + 1} / {ultimaPagina + 1} · {total} barracas
          </span>
          <Button variant="outline" className="min-h-11" disabled={pagina >= ultimaPagina || carregando} onClick={() => setPagina(pagina + 1)}>
            Próxima
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3" aria-label="Visão geral">
        <button
          type="button"
          aria-expanded={visaoAberta}
          aria-controls="visao-geral-conteudo"
          onClick={alternarVisao}
          className="flex min-h-11 items-center justify-between gap-2 text-left text-lg font-semibold text-mesa-text-primary"
        >
          Visão geral
          <span aria-hidden="true">{visaoAberta ? '−' : '+'}</span>
        </button>
        <div id="visao-geral-conteudo" hidden={!visaoAberta} className="flex flex-col gap-3">
          {erroResumo && <ErroComRetry texto="Não foi possível carregar o resumo." aoTentar={recarregarResumo} />}
          {alertas && temAlerta(alertas) && <PainelAlertas alertas={alertas} />}
          {resumo && <ResumoAtivas resumo={resumo} />}
        </div>
      </section>

      <HistoricoAcoesAdmin linhas={acoesLog} erro={erroHistorico} aoTentarDeNovo={recarregarHistorico} />
    </div>
  )
}
