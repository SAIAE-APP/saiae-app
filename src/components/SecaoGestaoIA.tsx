import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatarDataCurta } from '../lib/datas'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import type { Barraca } from '../types/database'

type Token = { id: string; nome: string; prefixo: string; criado_em: string; ultimo_uso_em: string | null; revogado_em: string | null }
type ItemDaLista = { categoria: string | null; nome: string; preco_centavos: number; descricao: string | null }
type Payload = {
  // esgotado e estoque
  de?: boolean
  para?: boolean
  delta?: number
  motivo?: string | null
  // cupom
  codigo?: string
  tipo_desconto?: 'percentual' | 'fixo'
  valor?: number
  valido_de?: string | null
  valido_ate?: string | null
  limite_usos?: number | null
  pedido_minimo_centavos?: number
  // foto
  pendente?: string
  largura?: number
  altura?: number
  bytes?: number
  // cardápio (resumo; a lista inteira nunca vem para a tela)
  total?: number
  a_criar?: number
  categorias_novas?: string[]
  amostra?: ItemDaLista[]
}
type Proposta = {
  id: string
  tipo: 'preco' | 'esgotado' | 'estoque' | 'cupom' | 'foto' | 'cardapio'
  item_nome: string | null
  preco_de: number | null
  preco_para: number | null
  payload: Payload | null
  foto_atual_url?: string | null
  estoque_atual: number | null
  token_nome: string
  expira_em: string
}
type Registro = { id: number; ferramenta: string; resultado: string; criado_em: string }

const reais = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const diaBr = (iso: string) => iso.split('-').reverse().join('/')
/** Descreve a mudança proposta em português, por tipo de ação. */
function descreverProposta(p: Proposta): React.ReactNode {
  if (p.tipo === 'cupom') {
    const c = p.payload ?? {}
    const condicoes = [
      c.valido_de ? `a partir de ${diaBr(c.valido_de)}` : null,
      c.valido_ate ? `até ${diaBr(c.valido_ate)}` : null,
      c.limite_usos ? `${c.limite_usos} usos no total` : null,
      c.pedido_minimo_centavos ? `pedido mínimo ${reais(c.pedido_minimo_centavos)}` : null,
    ].filter(Boolean)
    return (
      <>
        Criar o cupom <b>{c.codigo}</b>: <b>{c.tipo_desconto === 'percentual' ? `${c.valor}% de desconto` : `${reais(c.valor ?? 0)} de desconto`}</b> nos itens
        {condicoes.length > 0 ? ` (${condicoes.join(', ')})` : ''}. Ele nasce pausado: você liga em Ajustes &gt; Cupons.
      </>
    )
  }
  if (p.tipo === 'foto') {
    const nova = p.payload?.pendente ? supabase.storage.from('cardapio-fotos').getPublicUrl(p.payload.pendente).data.publicUrl : null
    return (
      <>
        Trocar a foto de <b>{p.item_nome}</b>
        {p.foto_atual_url ? ' (a foto atual será apagada)' : ''}
        <span className="mt-2 flex items-start gap-3">
          {p.foto_atual_url && (
            <span className="flex flex-col items-center gap-1 text-xs text-mesa-text-secondary">
              <img src={p.foto_atual_url} alt="Foto atual" className="h-24 w-24 rounded-mesa-lg object-cover" />
              Atual
            </span>
          )}
          {nova && (
            <span className="flex flex-col items-center gap-1 text-xs text-mesa-text-secondary">
              <img src={nova} alt={`Foto nova de ${p.item_nome}`} className="h-24 w-24 rounded-mesa-lg object-cover" />
              Nova
            </span>
          )}
        </span>
      </>
    )
  }
  if (p.tipo === 'cardapio') {
    const c = p.payload ?? {}
    return (
      <>
        Cadastrar <b>{c.a_criar ?? 0} itens</b> no cardápio (a IA enviou {c.total ?? 0}; o que já existe é pulado). Eles entram <b>ativos</b>: confira todos os preços abaixo.
        {c.categorias_novas && c.categorias_novas.length > 0 ? ` Categorias novas: ${c.categorias_novas.join(', ')}.` : ''}
        <span className="mt-2 block max-h-72 overflow-y-auto rounded-mesa-lg border border-mesa-border-default p-2 text-xs">
          {(c.amostra ?? []).map((i, n) => (
            <span key={n} className="block py-0.5">
              {i.categoria ?? 'Sem categoria'} · {i.nome} · <b>{reais(i.preco_centavos)}</b>
            </span>
          ))}
          {(c.a_criar ?? 0) > (c.amostra?.length ?? 0) && <span className="block py-0.5">… e mais {(c.a_criar ?? 0) - (c.amostra?.length ?? 0)}</span>}
        </span>
      </>
    )
  }
  if (p.tipo === 'esgotado') {
    return (
      <>
        <b>{p.item_nome}</b>: {p.payload?.para ? 'marcar como ' : 'voltar a vender, tirando de '}
        <b>esgotado</b>
      </>
    )
  }
  if (p.tipo === 'estoque') {
    const delta = p.payload?.delta ?? 0
    const sinal = delta > 0 ? '+' : ''
    return (
      <>
        <b>{p.item_nome}</b>: ajustar estoque <b>{sinal}{delta}</b>
        {p.estoque_atual === null ? ' (liga o controle de estoque)' : ` (hoje ${p.estoque_atual}, ficaria ${p.estoque_atual + delta})`}
        {p.payload?.motivo ? ` · ${p.payload.motivo}` : ''}
      </>
    )
  }
  return (
    <>
      <b>{p.item_nome}</b>: {reais(p.preco_de ?? 0)} → <b>{reais(p.preco_para ?? 0)}</b>
    </>
  )
}

const URL_MCP = `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/mcp-saiae`

function RotuloSecao({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      <Icone nome="lock" size={14} />
      {children}
    </h2>
  )
}

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

/** "Gestão por IA" (Ajustes › Conta, só dono): conecta o ChatGPT/Claude por um token por barraca. A IA só PROPÕE
 * mudanças; quem aprova é o dono, aqui, logado (RPC `mcp_proposta_decidir`). Spec: docs/superpowers/specs/2026-11-27-mcp-gestao-ia-design.md */
export function SecaoGestaoIA({ barraca }: { barraca: Barraca }) {
  const barracaId = barraca.id
  const [ehDono, setEhDono] = useState<boolean | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [propostas, setPropostas] = useState<Proposta[]>([])
  const [historico, setHistorico] = useState<Registro[]>([])
  const [nome, setNome] = useState('')
  const [tokenNovo, setTokenNovo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id
      if (!uid) return !cancelado && setEhDono(false)
      const { data: v } = await supabase
        .from('usuarios_barracas')
        .select('papel')
        .eq('barraca_id', barracaId)
        .eq('usuario_id', uid)
        .maybeSingle()
      if (!cancelado) setEhDono((v as { papel?: string } | null)?.papel === 'dono')
    })
    return () => {
      cancelado = true
    }
  }, [barracaId])

  const carregarPropostas = useCallback(async () => {
    const { data } = await supabase.rpc('mcp_proposta_listar', { p_barraca_id: barracaId })
    if (Array.isArray(data)) setPropostas(data as Proposta[])
  }, [barracaId])

  const carregarTudo = useCallback(async () => {
    const [t, h] = await Promise.all([
      supabase.rpc('mcp_token_listar', { p_barraca_id: barracaId }),
      supabase.rpc('mcp_auditoria_listar', { p_barraca_id: barracaId, p_limite: 20 }),
    ])
    if (Array.isArray(t.data)) setTokens(t.data as Token[])
    if (Array.isArray(h.data)) setHistorico(h.data as Registro[])
    await carregarPropostas()
  }, [barracaId, carregarPropostas])

  useEffect(() => {
    if (!ehDono) return
    void carregarTudo()
    const timer = window.setInterval(() => void carregarPropostas(), 5000)
    return () => window.clearInterval(timer)
  }, [ehDono, carregarTudo, carregarPropostas])

  if (!ehDono) return null

  async function criarToken() {
    setOcupado(true)
    setErro(null)
    const { data, error } = await supabase.rpc('mcp_token_criar', { p_barraca_id: barracaId, p_nome: nome })
    setOcupado(false)
    const r = data as { estado?: string; token?: string } | null
    if (error || r?.estado !== 'ok' || !r.token) {
      setErro(r?.estado === 'limite_de_tokens' ? 'Limite de 5 conexões ativas. Revogue uma antes.' : 'Não foi possível criar a conexão. Dê um nome e tente de novo.')
      return
    }
    setTokenNovo(r.token)
    setNome('')
    void carregarTudo()
  }

  async function revogar(id: string) {
    setErro(null)
    const { data, error } = await supabase.rpc('mcp_token_revogar', { p_token_id: id })
    if (error || (data as { estado?: string } | null)?.estado !== 'ok') setErro('Não foi possível revogar. Tente de novo.')
    void carregarTudo()
  }

  async function decidir(id: string, aprovar: boolean) {
    setErro(null)
    const { data, error } = await supabase.rpc('mcp_proposta_decidir', { p_proposta_id: id, p_aprovar: aprovar })
    if (error || (data as { estado?: string } | null)?.estado !== 'ok') setErro('Não foi possível registrar sua decisão (a proposta pode ter vencido).')
    void carregarTudo()
  }

  async function aoCopiar(chave: string, texto: string) {
    setCopiado((await copiar(texto)) ? chave : null)
  }

  const ativos = tokens.filter((t) => !t.revogado_em)

  return (
    <section>
      <RotuloSecao>Gestão por IA</RotuloSecao>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-mesa-text-secondary">
          Conecte o ChatGPT ou o Claude à sua barraca para pedir mudanças por conversa. A IA só propõe: nada muda sem a sua
          aprovação aqui.
        </p>

        {propostas.length > 0 && (
          <div className="flex flex-col gap-3 rounded-mesa-lg border border-mesa-border-default p-4">
            <p className="text-sm font-semibold text-mesa-text-primary">Esperando sua aprovação</p>
            {propostas.map((p) => (
              <div key={p.id} className="flex flex-col gap-2">
                <p className="text-sm text-mesa-text-primary">{descreverProposta(p)}</p>
                <p className="text-xs text-mesa-text-secondary">Pedido por “{p.token_nome}”, vale até {formatarDataCurta(new Date(p.expira_em))}</p>
                <div className="flex gap-2">
                  <Button variant="primary" size="md" className="flex-1" onClick={() => void decidir(p.id, true)}>
                    Aprovar
                  </Button>
                  <Button variant="outline" size="md" className="flex-1" onClick={() => void decidir(p.id, false)}>
                    Recusar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="gia-url" className="text-sm font-semibold text-mesa-text-primary">
            Endereço do conector
          </label>
          <div className="flex gap-2">
            <input id="gia-url" readOnly value={URL_MCP} className="min-h-11 flex-1 rounded-mesa-lg border border-mesa-border-default bg-mesa-neutral-100 px-3 text-sm dark:bg-mesa-neutral-800" />
            <Button variant="outline" size="md" onClick={() => void aoCopiar('url', URL_MCP)}>
              {copiado === 'url' ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
          <p className="text-xs text-mesa-text-secondary">No ChatGPT ou no Claude, adicione um conector personalizado com este endereço e a chave abaixo.</p>
        </div>

        {tokenNovo ? (
          <div className="flex flex-col gap-2 rounded-mesa-lg bg-mesa-neutral-100 p-4 dark:bg-mesa-neutral-800">
            <p className="text-sm font-semibold text-mesa-text-primary">Sua chave. Ela aparece só desta vez.</p>
            <p className="break-all font-mesa-mono text-sm text-mesa-text-primary">{tokenNovo}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="md" className="flex-1" onClick={() => void aoCopiar('token', tokenNovo)}>
                {copiado === 'token' ? 'Copiado' : 'Copiar chave'}
              </Button>
              <Button variant="ghost" size="md" onClick={() => setTokenNovo(null)}>
                Já guardei
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value.slice(0, 60))}
              placeholder="Nome (ex.: ChatGPT do balcão)"
              aria-label="Nome da conexão"
              className="min-h-11 flex-1 rounded-mesa-lg border border-mesa-border-default bg-transparent px-3 text-sm"
            />
            <Button variant="outline" size="md" loading={ocupado} disabled={nome.trim() === ''} onClick={() => void criarToken()}>
              Criar chave
            </Button>
          </div>
        )}

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        {ativos.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-mesa-border-default pt-4">
            {ativos.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-mesa-text-primary">{t.nome}</p>
                  <p className="text-xs text-mesa-text-secondary">
                    {t.prefixo}… · {t.ultimo_uso_em ? `usada em ${formatarDataCurta(new Date(t.ultimo_uso_em))}` : 'ainda não usada'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void revogar(t.id)}>
                  Revogar
                </Button>
              </div>
            ))}
          </div>
        )}

        {historico.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-mesa-border-default pt-4">
            <p className="text-sm font-semibold text-mesa-text-primary">Últimas ações da IA</p>
            {historico.map((h) => (
              <p key={h.id} className="text-xs text-mesa-text-secondary">
                {formatarDataCurta(new Date(h.criado_em))} · <Badge variant="neutral">{h.ferramenta}</Badge> {h.resultado}
              </p>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}
