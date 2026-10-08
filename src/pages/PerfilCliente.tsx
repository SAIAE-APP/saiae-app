import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ModalIdentificacao } from '../components/cliente/ModalIdentificacao'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Checkbox } from '../components/ui/Checkbox'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { useClienteSessao } from '../hooks/useClienteSessao'
import { chamarSessao, lerSessao } from '../lib/clienteApi'
import { resumoPedirDeNovo, type LinhaPedirDeNovo } from '../lib/clientePerfil'
import { formatarPrecoBR } from '../lib/preco'

type Perfil = { id: string; nome: string; telefone: string; aceita_promocoes: boolean; aceita_avisos_pedido: boolean }
type Endereco = { id: string; apelido: string; rua: string; numero: string; bairro: string; referencia: string | null; padrao: boolean }
type PedidoHistorico = {
  id: string
  senha: number | null
  status: string
  criado_em: string
  taxa_entrega_centavos: number | null
  itens_do_pedido: { nome_item: string; quantidade: number; preco_centavos_unitario: number; removido: boolean }[]
}
type RascunhoEndereco = { id: string | null; apelido: string; rua: string; numero: string; bairro: string; referencia: string }

const ROTULO_STATUS: Record<string, string> = {
  a_fazer: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
}

function totalDoPedido(p: PedidoHistorico): number {
  const itens = p.itens_do_pedido.filter((i) => !i.removido).reduce((s, i) => s + i.preco_centavos_unitario * i.quantidade, 0)
  return itens + (p.taxa_entrega_centavos ?? 0)
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** "Meu perfil" do cliente final nesta loja: dados, endereços, pedidos, pedir de novo, sair e apagar. */
export function PerfilCliente() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { sessao, entrar, sair } = useClienteSessao(slug)

  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [enderecos, setEnderecos] = useState<Endereco[]>([])
  const [pedidos, setPedidos] = useState<PedidoHistorico[]>([])
  const [carregando, setCarregando] = useState(Boolean(sessao))
  const [erro, setErro] = useState<string | null>(null)
  const [precisaEntrar, setPrecisaEntrar] = useState(!sessao)
  const [recarga, setRecarga] = useState(0)

  const [nome, setNome] = useState<string | null>(null)
  const [promocoes, setPromocoes] = useState<boolean | null>(null)
  const [avisos, setAvisos] = useState<boolean | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)

  const [endereco, setEndereco] = useState<RascunhoEndereco | null>(null)
  const [erroEndereco, setErroEndereco] = useState<string | null>(null)
  const [pedirDeNovo, setPedirDeNovo] = useState<{ avisos: string[]; montar: LinhaPedirDeNovo[] } | null>(null)
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)
  const [apagando, setApagando] = useState(false)

  const tratarFalha = useCallback((r: { sessaoInvalida: boolean; erro: string }) => {
    if (r.sessaoInvalida) setPrecisaEntrar(true)
    else setErro(r.erro)
  }, [])

  useEffect(() => {
    if (!slug || precisaEntrar) return
    let cancelado = false
    void (async () => {
      const [p, h] = await Promise.all([
        chamarSessao<{ cliente: Perfil; enderecos: Endereco[] }>(slug, 'perfil'),
        chamarSessao<{ pedidos: PedidoHistorico[] }>(slug, 'historico'),
      ])
      if (cancelado) return
      setCarregando(false)
      if (!p.ok) return tratarFalha(p)
      setPerfil(p.dados.cliente)
      setEnderecos(p.dados.enderecos)
      setErro(null)
      if (h.ok) setPedidos(h.dados.pedidos)
    })()
    return () => {
      cancelado = true
    }
  }, [slug, precisaEntrar, recarga, tratarFalha])

  if (!slug) return null
  const voltar = () => navigate(`/${slug}/cardapio`)

  async function salvarDados() {
    if (!perfil || !slug) return
    const nomeFinal = (nome ?? perfil.nome).trim()
    if (nomeFinal.length < 2) return setMensagem('Informe seu nome.')
    setSalvando(true)
    setMensagem(null)
    const r = await chamarSessao(slug, 'salvar_perfil', {
      nome: nomeFinal,
      aceita_promocoes: promocoes ?? perfil.aceita_promocoes,
      aceita_avisos_pedido: avisos ?? perfil.aceita_avisos_pedido,
    })
    setSalvando(false)
    if (!r.ok) return tratarFalha(r)
    setNome(null)
    setPromocoes(null)
    setAvisos(null)
    setMensagem('Dados salvos.')
    setRecarga((n) => n + 1)
  }

  async function salvarEndereco() {
    if (!endereco || !slug) return
    if (!endereco.rua.trim() || !endereco.numero.trim() || !endereco.bairro.trim()) {
      return setErroEndereco('Informe rua, número e bairro.')
    }
    setErroEndereco(null)
    const r = await chamarSessao(slug, 'endereco_salvar', { ...endereco, id: endereco.id ?? '' })
    if (!r.ok) {
      if (r.sessaoInvalida) return tratarFalha(r)
      return setErroEndereco(r.erro)
    }
    setEndereco(null)
    setRecarga((n) => n + 1)
  }

  async function acaoEndereco(acao: 'endereco_padrao' | 'endereco_excluir', id: string) {
    if (!slug) return
    const r = await chamarSessao(slug, acao, { id })
    if (!r.ok) return tratarFalha(r)
    setRecarga((n) => n + 1)
  }

  async function iniciarPedirDeNovo(pedidoId: string) {
    if (!slug) return
    setErro(null)
    const r = await chamarSessao<{ linhas: LinhaPedirDeNovo[] }>(slug, 'pedir_de_novo', { pedido_id: pedidoId })
    if (!r.ok) return tratarFalha(r)
    const resumo = resumoPedirDeNovo(r.dados.linhas)
    setPedirDeNovo({ avisos: resumo.avisos, montar: resumo.montar })
  }

  function confirmarPedirDeNovo() {
    if (!pedirDeNovo || !slug) return
    const itens = pedirDeNovo.montar.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id as string, quantidade: l.quantidade }))
    try {
      window.sessionStorage.setItem(`saiae:pedir-de-novo:${slug}`, JSON.stringify(itens))
    } catch {
      /* sem armazenamento: o cliente monta o pedido à mão */
    }
    voltar()
  }

  async function aoSair() {
    if (slug) await chamarSessao(slug, 'sair')
    sair()
    voltar()
  }

  async function apagarDados() {
    if (!slug) return
    setApagando(true)
    const r = await chamarSessao(slug, 'apagar')
    setApagando(false)
    setConfirmandoApagar(false)
    if (!r.ok) return tratarFalha(r)
    sair()
    voltar()
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 bg-mesa-bg-base p-6 pb-12 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={voltar}
          aria-label="Voltar ao cardápio"
          className="flex size-11 items-center justify-center rounded-mesa-full text-mesa-text-secondary hover:bg-[var(--mesa-state-hover-bg)]"
        >
          <Icone nome="arrow_back" size={20} />
        </button>
        <h1 className="font-mesa-display text-xl font-bold text-mesa-text-primary">Meu perfil</h1>
      </div>

      {carregando && !precisaEntrar && <p className="text-sm text-mesa-text-secondary">Carregando…</p>}
      {erro && (
        <p role="alert" className="text-sm font-medium text-mesa-error-500">
          {erro}
        </p>
      )}

      {perfil && !precisaEntrar && (
        <>
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Meus dados</h2>
            <Card>
              <div className="flex flex-col gap-3">
                <Input label="Nome" value={nome ?? perfil.nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
                <p className="text-sm text-mesa-text-secondary">WhatsApp: {perfil.telefone}</p>
                <Checkbox
                  checked={avisos ?? perfil.aceita_avisos_pedido}
                  onChange={setAvisos}
                  label="Receber avisos sobre meus pedidos"
                />
                <Checkbox
                  checked={promocoes ?? perfil.aceita_promocoes}
                  onChange={setPromocoes}
                  label="Receber promoções desta loja"
                />
                {mensagem && (
                  <p role="status" className="text-sm text-mesa-text-secondary">
                    {mensagem}
                  </p>
                )}
                <Button
                  variant="outline"
                  size="md"
                  loading={salvando}
                  disabled={salvando || (nome === null && promocoes === null && avisos === null)}
                  onClick={() => void salvarDados()}
                >
                  Salvar
                </Button>
              </div>
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Endereços</h2>
            <Card>
              <ul className="divide-y divide-mesa-border-subtle">
                {enderecos.map((e) => (
                  <li key={e.id} className="py-3">
                    <p className="text-base font-semibold text-mesa-text-primary">
                      {e.apelido}
                      {e.padrao && (
                        <span className="ml-2 rounded-mesa-balao bg-mesa-neutral-100 px-2 py-0.5 text-xs font-bold text-mesa-text-secondary dark:bg-mesa-neutral-700">
                          Padrão
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-mesa-text-secondary">
                      {e.rua}, {e.numero} - {e.bairro}
                      {e.referencia ? ` (${e.referencia})` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-x-4">
                      <button
                        type="button"
                        className="min-h-11 text-sm underline"
                        onClick={() => {
                          setErroEndereco(null)
                          setEndereco({ id: e.id, apelido: e.apelido, rua: e.rua, numero: e.numero, bairro: e.bairro, referencia: e.referencia ?? '' })
                        }}
                      >
                        Editar
                      </button>
                      {!e.padrao && (
                        <button type="button" className="min-h-11 text-sm underline" onClick={() => void acaoEndereco('endereco_padrao', e.id)}>
                          Tornar padrão
                        </button>
                      )}
                      <button type="button" className="min-h-11 text-sm text-mesa-error-500 underline" onClick={() => void acaoEndereco('endereco_excluir', e.id)}>
                        Excluir
                      </button>
                    </div>
                  </li>
                ))}
                {enderecos.length === 0 && <li className="py-3 text-sm text-mesa-text-secondary">Nenhum endereço guardado.</li>}
              </ul>
              {enderecos.length < 5 && (
                <Button
                  variant="outline"
                  size="md"
                  className="mt-3"
                  icon={<Icone nome="add" size={16} />}
                  onClick={() => {
                    setErroEndereco(null)
                    setEndereco({ id: null, apelido: 'Casa', rua: '', numero: '', bairro: '', referencia: '' })
                  }}
                >
                  Adicionar endereço
                </Button>
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Meus pedidos</h2>
            <Card>
              <ul className="divide-y divide-mesa-border-subtle">
                {pedidos.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-mesa-text-primary">
                        {formatarData(p.criado_em)}
                        {p.senha !== null && ` · senha ${String(p.senha).padStart(3, '0')}`}
                      </span>
                      <span className="rounded-mesa-balao bg-mesa-neutral-100 px-2 py-0.5 text-xs font-bold text-mesa-text-secondary dark:bg-mesa-neutral-700">
                        {ROTULO_STATUS[p.status] ?? p.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-mesa-text-secondary">
                      {p.itens_do_pedido
                        .filter((i) => !i.removido)
                        .map((i) => `${i.quantidade}x ${i.nome_item}`)
                        .join(', ')}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mesa-display text-sm font-semibold text-mesa-text-primary">{formatarPrecoBR(totalDoPedido(p))}</span>
                      <Button variant="outline" size="sm" onClick={() => void iniciarPedirDeNovo(p.id)}>
                        Pedir de novo
                      </Button>
                    </div>
                  </li>
                ))}
                {pedidos.length === 0 && <li className="py-3 text-sm text-mesa-text-secondary">Você ainda não fez pedidos aqui.</li>}
              </ul>
            </Card>
          </section>

          <div className="flex flex-col gap-2">
            <Button variant="outline" size="lg" className="w-full" onClick={() => void aoSair()}>
              Sair
            </Button>
            <Button variant="textDanger" size="lg" className="w-full" onClick={() => setConfirmandoApagar(true)}>
              Apagar meus dados
            </Button>
          </div>
        </>
      )}

      {precisaEntrar && (
        <ModalIdentificacao
          slug={slug}
          onCancelar={() => {
            // Sem sessão válida não há o que mostrar: volta ao cardápio.
            if (!lerSessao(slug)) voltar()
            else setPrecisaEntrar(false)
          }}
          onConcluir={(s) => {
            entrar(s)
            setPrecisaEntrar(false)
            setCarregando(true)
            setRecarga((n) => n + 1)
          }}
        />
      )}

      <BottomSheet open={endereco !== null} onClose={() => setEndereco(null)} aria-label="Endereço">
        {endereco && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-mesa-text-primary">{endereco.id ? 'Editar endereço' : 'Novo endereço'}</h2>
            <Input label="Apelido" value={endereco.apelido} maxLength={30} onChange={(e) => setEndereco({ ...endereco, apelido: e.target.value })} />
            <Input label="Rua" value={endereco.rua} maxLength={120} onChange={(e) => setEndereco({ ...endereco, rua: e.target.value })} />
            <Input label="Número" value={endereco.numero} maxLength={20} onChange={(e) => setEndereco({ ...endereco, numero: e.target.value })} />
            <Input label="Bairro" value={endereco.bairro} maxLength={80} onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })} />
            <Input label="Referência (opcional)" value={endereco.referencia} maxLength={120} onChange={(e) => setEndereco({ ...endereco, referencia: e.target.value })} />
            {erroEndereco && (
              <p role="alert" className="text-sm font-medium text-mesa-error-500">
                {erroEndereco}
              </p>
            )}
            <Button variant="primary" size="xl" className="w-full" onClick={() => void salvarEndereco()}>
              Salvar endereço
            </Button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={pedirDeNovo !== null} onClose={() => setPedirDeNovo(null)} aria-label="Pedir de novo">
        {pedirDeNovo && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-mesa-text-primary">Pedir de novo</h2>
            {pedirDeNovo.avisos.length > 0 && (
              <ul role="status" className="flex flex-col gap-1 text-sm text-mesa-text-secondary">
                {pedirDeNovo.avisos.map((a) => (
                  <li key={a}>⚠ {a}</li>
                ))}
              </ul>
            )}
            {pedirDeNovo.montar.length > 0 ? (
              <>
                <p className="text-sm text-mesa-text-secondary">
                  {pedirDeNovo.montar.length === 1 ? '1 item vai' : `${pedirDeNovo.montar.length} itens vão`} para o carrinho. Você confere tudo antes de finalizar.
                </p>
                <Button variant="primary" size="xl" className="w-full" onClick={confirmarPedirDeNovo}>
                  Levar para o carrinho
                </Button>
              </>
            ) : (
              <p className="text-sm text-mesa-text-secondary">Nenhum item deste pedido pode ser pedido de novo agora.</p>
            )}
            <Button variant="ghost" size="md" className="w-full" onClick={() => setPedirDeNovo(null)}>
              Cancelar
            </Button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={confirmandoApagar} onClose={() => !apagando && setConfirmandoApagar(false)} aria-label="Apagar meus dados">
        <h2 className="text-lg font-semibold text-mesa-text-primary">Apagar meus dados?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Vamos apagar seu perfil, endereços e histórico de dados pessoais. Os pedidos ficam registrados sem o seu nome.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="destructive" size="xl" className="w-full" loading={apagando} onClick={() => void apagarDados()}>
            Apagar meus dados
          </Button>
          <Button variant="ghost" size="md" className="w-full" disabled={apagando} onClick={() => setConfirmandoApagar(false)}>
            Manter
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
