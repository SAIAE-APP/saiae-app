import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { Chip } from '../components/ui/Chip'
import { useSouSuperadmin } from '../hooks/useAdminBarracas'
import { supabase } from '../lib/supabase'
import { formatarPrecoBR } from '../lib/preco'
import { AdminModulos } from '../components/AdminModulos'
import { NaoEncontrado } from './NaoEncontrado'
import {
  NOME_STATUS_PEDIDO_ADMIN,
  agruparFaturamento,
  type AdminAcesso,
  type AdminCaixaLinha,
  type AdminClienteCompleto,
  type AdminFaturamentoLinha,
  type AdminPedidoLinha,
} from '../lib/adminBarracaLeitura'

type Aba = 'pedidos' | 'cozinha' | 'faturamento' | 'caixa' | 'ajustes'
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'pedidos', rotulo: 'Histórico' },
  { id: 'cozinha', rotulo: 'Cozinha' },
  { id: 'faturamento', rotulo: 'Faturamento' },
  { id: 'caixa', rotulo: 'Caixa' },
  { id: 'ajustes', rotulo: 'Ajustes' },
]

/** Uma leitura do painel: refaz quando o acesso ou os parâmetros mudam; erro vira mensagem, nunca tela vazia muda. */
function useLeitura<T>(funcao: string, argumentos: Record<string, unknown>) {
  const [estado, setEstado] = useState<{ chave: string; dados: T | null; erro: boolean } | null>(null)
  const chave = `${funcao}|${JSON.stringify(argumentos)}`
  useEffect(() => {
    let cancelado = false
    supabase.rpc(funcao, argumentos).then(({ data, error }) => {
      if (!cancelado) setEstado({ chave, dados: error ? null : (data as T), erro: !!error })
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])
  const atual = estado?.chave === chave ? estado : null
  return { dados: atual?.dados ?? null, erro: atual?.erro ?? false, carregando: atual === null }
}

function Carregando({ erro, carregando }: { erro: boolean; carregando: boolean }) {
  if (erro) return <p role="alert" className="text-mesa-text-secondary">Não foi possível carregar.</p>
  if (carregando) return <p className="text-mesa-text-secondary">Carregando...</p>
  return null
}

function hora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function PedidoCard({ acessoId, pedido }: { acessoId: string; pedido: AdminPedidoLinha }) {
  const [completo, setCompleto] = useState<AdminClienteCompleto | null>(null)
  const [erro, setErro] = useState(false)

  async function mostrar() {
    setErro(false)
    const { data, error } = await supabase
      .rpc('admin_barraca_revelar_cliente', { p_acesso_id: acessoId, p_pedido_id: pedido.pedido_id })
      .single()
    if (error || !data) setErro(true)
    else setCompleto(data as AdminClienteCompleto)
  }

  const temCliente = pedido.cliente_primeiro_nome || pedido.telefone_mascarado
  return (
    <Card className="flex flex-col gap-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-mesa-text-primary">Senha {pedido.senha ?? '—'}</span>
        <Badge variant={pedido.status === 'cancelado' ? 'danger' : pedido.status === 'entregue' ? 'success' : 'info'}>
          {NOME_STATUS_PEDIDO_ADMIN[pedido.status] ?? pedido.status}
        </Badge>
      </div>
      <p className="text-mesa-text-secondary">
        {hora(pedido.criado_em)} · {pedido.tipo_atendimento ?? '—'} · {pedido.metodo_pagamento ?? 'sem pagamento'} ·{' '}
        <span className="text-mesa-text-primary">{formatarPrecoBR(Number(pedido.total_centavos))}</span>
      </p>
      {temCliente && !completo && (
        <p className="flex flex-wrap items-center gap-2 text-mesa-text-secondary">
          {pedido.cliente_primeiro_nome} {pedido.telefone_mascarado}
          <Button variant="ghost" size="sm" onClick={mostrar}>
            Mostrar dados completos
          </Button>
        </p>
      )}
      {completo && (
        <p className="text-mesa-text-primary">
          {completo.cliente_nome} · {completo.cliente_telefone}
          {completo.entrega_rua ? ` · ${completo.entrega_rua}, ${completo.entrega_numero ?? 's/n'} ${completo.entrega_bairro ?? ''}` : ''}
          {completo.entrega_referencia ? ` (${completo.entrega_referencia})` : ''}
        </p>
      )}
      {erro && <p role="alert" className="text-mesa-text-secondary">Não foi possível mostrar.</p>}
    </Card>
  )
}

function AbaPedidos({ acessoId, abertos }: { acessoId: string; abertos: boolean }) {
  const [pagina, setPagina] = useState(0)
  const { dados, erro, carregando } = useLeitura<AdminPedidoLinha[]>('admin_barraca_pedidos', {
    p_acesso_id: acessoId,
    p_filtro: abertos ? 'abertos' : null,
    p_limite: 30,
    p_offset: pagina * 30,
  })
  const total = Number(dados?.[0]?.total ?? 0)
  return (
    <div className="flex flex-col gap-3">
      <Carregando erro={erro} carregando={carregando} />
      {dados && dados.length === 0 && <p className="text-mesa-text-secondary">Nenhum pedido.</p>}
      {dados?.map((p) => <PedidoCard key={p.pedido_id} acessoId={acessoId} pedido={p} />)}
      {total > 30 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
          <span className="text-sm text-mesa-text-secondary">{pagina + 1} / {Math.ceil(total / 30)}</span>
          <Button variant="outline" disabled={(pagina + 1) * 30 >= total} onClick={() => setPagina(pagina + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  )
}

function AbaFaturamento({ acessoId }: { acessoId: string }) {
  const { dados, erro, carregando } = useLeitura<AdminFaturamentoLinha[]>('admin_barraca_faturamento', { p_acesso_id: acessoId, p_dias: 14 })
  const dias = dados ? agruparFaturamento(dados) : []
  return (
    <div className="flex flex-col gap-3">
      <Carregando erro={erro} carregando={carregando} />
      {dados && dias.length === 0 && <p className="text-mesa-text-secondary">Sem vendas nos últimos 14 dias.</p>}
      {dias.map((d) => (
        <Card key={d.dia} className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="font-semibold text-mesa-text-primary">{d.dia.split('-').reverse().slice(0, 2).join('/')}</span>
            <span className="text-mesa-text-primary">{formatarPrecoBR(d.total)} · {d.pedidos} pedidos</span>
          </div>
          <p className="text-mesa-text-secondary">
            {d.metodos.map((m) => `${m.metodo ?? 'sem pagamento'}: ${formatarPrecoBR(m.total)}`).join(' · ')}
          </p>
        </Card>
      ))}
    </div>
  )
}

function AbaCaixa({ acessoId }: { acessoId: string }) {
  const { dados, erro, carregando } = useLeitura<AdminCaixaLinha[]>('admin_barraca_caixas', { p_acesso_id: acessoId })
  return (
    <div className="flex flex-col gap-3">
      <Carregando erro={erro} carregando={carregando} />
      {dados && dados.length === 0 && <p className="text-mesa-text-secondary">Nenhum caixa.</p>}
      {dados?.map((c) => (
        <Card key={`${c.data}-${c.aberto_em}`} className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="font-semibold text-mesa-text-primary">{c.data.split('-').reverse().slice(0, 2).join('/')}</span>
            <Badge variant={c.status === 'aberto' ? 'info' : 'neutral'}>{c.status}</Badge>
          </div>
          <p className="text-mesa-text-secondary">
            Abertura {formatarPrecoBR(c.valor_abertura_centavos)}
            {c.valor_fechamento_centavos !== null && ` · Fechamento ${formatarPrecoBR(c.valor_fechamento_centavos)}`}
            {c.diferenca_centavos !== null && ` · Diferença ${formatarPrecoBR(c.diferenca_centavos)}`}
          </p>
        </Card>
      ))}
    </div>
  )
}

function AbaAjustes({ acessoId }: { acessoId: string }) {
  const { dados, erro, carregando } = useLeitura<Record<string, unknown>>('admin_barraca_ajustes', { p_acesso_id: acessoId })
  const { assinatura, ...resto } = (dados ?? {}) as Record<string, unknown> & { assinatura?: Record<string, unknown> | null }
  const linha = (v: unknown) => (v === true ? 'sim' : v === false ? 'não' : Array.isArray(v) ? v.join(', ') : String(v ?? '—'))
  return (
    <div className="flex flex-col gap-3">
      <Carregando erro={erro} carregando={carregando} />
      {dados && (
        <>
          <Card>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {Object.entries(resto).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-mesa-text-secondary">{k.replaceAll('_', ' ')}</dt>
                  <dd className="text-mesa-text-primary">{linha(v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {assinatura && (
            <Card>
              <h2 className="mb-1 text-sm font-semibold text-mesa-text-primary">Assinatura do dono</h2>
              <p className="text-sm text-mesa-text-secondary">
                {linha(assinatura.status)} · plano {linha(assinatura.plano)}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

/** Abrir uma barraca pelo painel do superadmin: SOMENTE LEITURA, garantida pelo banco (ver migration
 * 20261028140000_admin_abrir_barraca.sql). Cada abertura fica no log que o dono vê em Ajustes > Conta. */
export function AdminBarracaLeitura() {
  const { barracaId } = useParams<{ barracaId: string }>()
  const navigate = useNavigate()
  const ehSuperadmin = useSouSuperadmin()
  const [acesso, setAcesso] = useState<AdminAcesso | null>(null)
  const [erro, setErro] = useState(false)
  const [aba, setAba] = useState<Aba>('pedidos')
  const abriu = useRef(false)

  useEffect(() => {
    if (ehSuperadmin !== true || !barracaId || abriu.current) return
    abriu.current = true
    supabase.rpc('admin_abrir_barraca_leitura', { p_barraca_id: barracaId }).then(({ data, error }) => {
      if (error || !data) setErro(true)
      else setAcesso(data as AdminAcesso)
    })
  }, [ehSuperadmin, barracaId])

  if (ehSuperadmin === null) {
    return <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base"><p className="text-mesa-text-secondary">Carregando...</p></div>
  }
  if (!ehSuperadmin) return <NaoEncontrado />

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 bg-mesa-bg-base p-4 pt-14">
      <div role="status" className="fixed inset-x-0 top-0 z-50 bg-mesa-orange-500 px-4 py-2 text-center text-sm font-medium text-mesa-neutral-900">
        Você está vendo a barraca {acesso?.nome ?? ''} como SUPERADMIN, somente leitura
      </div>
      <CabecalhoPagina titulo={acesso?.nome ?? 'Barraca'} aoClicarHome={() => navigate('/admin')} />
      {erro && <p role="alert" className="text-mesa-text-secondary">Não foi possível abrir esta barraca.</p>}
      {acesso && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Seções">
            {ABAS.map((a) => (
              <Chip key={a.id} checked={aba === a.id} onClick={() => setAba(a.id)}>{a.rotulo}</Chip>
            ))}
          </div>
          {aba === 'pedidos' && <AbaPedidos key="h" acessoId={acesso.acesso_id} abertos={false} />}
          {aba === 'cozinha' && <AbaPedidos key="c" acessoId={acesso.acesso_id} abertos />}
          {aba === 'faturamento' && <AbaFaturamento acessoId={acesso.acesso_id} />}
          {aba === 'caixa' && <AbaCaixa acessoId={acesso.acesso_id} />}
          {aba === 'ajustes' && <AbaAjustes acessoId={acesso.acesso_id} />}
          {aba === 'ajustes' && barracaId && <AdminModulos barracaId={barracaId} />}
        </>
      )}
    </div>
  )
}
