import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { supabase } from '../lib/supabase'
import { formatarPrecoBR } from '../lib/preco'
import { Button } from '../components/ui/Button'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Textarea } from '../components/ui/Textarea'

type LinhaCardapioPublico = {
  barraca_id: string
  barraca_nome: string
  barraca_logo_url: string | null
  pagamento_online_habilitado: boolean
  item_id: string
  item_nome: string
  item_descricao: string | null
  item_foto_url: string | null
  item_preco_centavos: number
  item_esgotado: boolean
  categoria_nome: string | null
  pedidos_30d: number
}

type Estado =
  | { status: 'carregando' }
  | { status: 'erro' }
  | { status: 'pronto'; linhas: LinhaCardapioPublico[] }

type Carrinho = Record<string, number>
type ModoConsumo = 'mesa' | 'balcao' | 'viagem'

// Fase 2+3 do Cardápio Digital (CLAUDE.md, roadmap): o pedido de verdade
// só nasce depois do pagamento confirmado (ver edge functions
// criar-pagamento-pix/webhook-mercadopago) — enquanto isso, o checkout
// fica nesses estados intermediários.
type EstadoPagamento =
  | { fase: 'formulario' }
  | { fase: 'processando' }
  | { fase: 'aguardando'; pendenteId: string; qrCode: string | null; qrCodeBase64: string | null }
  | { fase: 'aprovado'; senha: number | null }
  | { fase: 'recusado' }
  | { fase: 'erro'; mensagem: string }

const MAXIMO_MAIS_PEDIDOS = 8
const INTERVALO_POLLING_MS = 3000

function BottomSheetEmBreve({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} aria-label="Pedido pelo cardápio em breve">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Em breve</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Por enquanto este cardápio é só pra você dar uma olhada. Fale seu pedido com quem está no
        balcão — logo, logo você vai poder montar o pedido direto por aqui.
      </p>
      <Button variant="ghost" size="md" onClick={onClose} className="mt-6 w-full">
        Entendi
      </Button>
    </BottomSheet>
  )
}

function BotaoAdicionar({
  variant,
  podeComprar,
  esgotado,
  quantidadeNoCarrinho,
  onAdicionar,
}: {
  variant: 'sm' | 'md'
  podeComprar: boolean
  esgotado: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
}) {
  const [mostrarEmBreve, setMostrarEmBreve] = useState(false)
  const podeAdicionar = podeComprar && !esgotado

  return (
    <>
      <Button
        variant={quantidadeNoCarrinho > 0 ? 'confirm' : 'outline'}
        size={variant}
        icon={<Icone nome="add" size={16} />}
        disabled={esgotado}
        onClick={() => (podeAdicionar ? onAdicionar() : setMostrarEmBreve(true))}
      >
        {esgotado ? 'Esgotado' : quantidadeNoCarrinho > 0 ? `${quantidadeNoCarrinho} no carrinho` : 'Adicionar'}
      </Button>
      <BottomSheetEmBreve open={mostrarEmBreve} onClose={() => setMostrarEmBreve(false)} />
    </>
  )
}

function CardItemPublico({
  item,
  posicaoPopular,
  podeComprar,
  quantidadeNoCarrinho,
  onAdicionar,
}: {
  item: LinhaCardapioPublico
  posicaoPopular: number | null
  podeComprar: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
}) {
  return (
    <div className="relative flex gap-3 rounded-mesa-lg border border-mesa-border-subtle bg-mesa-surface p-3 shadow-mesa-1">
      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
        {item.item_foto_url ? (
          <img src={item.item_foto_url} alt="" className="size-full object-cover" />
        ) : (
          <Icone nome="image" size={20} />
        )}
        {posicaoPopular !== null && !item.item_esgotado && (
          <span className="absolute left-0.5 top-0.5 flex items-center gap-0.5 whitespace-nowrap rounded-mesa-full bg-mesa-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-mesa-neutral-900 shadow-mesa-1">
            <Icone nome="star" size={8} preenchido />
            {posicaoPopular === 0 ? 'Top 1' : 'Popular'}
          </span>
        )}
        {item.item_esgotado && (
          <span className="absolute inset-0 flex items-center justify-center bg-mesa-neutral-900/60 text-[9px] font-bold uppercase text-white">
            Esgotado
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-mesa-text-primary">{item.item_nome}</p>
        {item.item_descricao && (
          <p className="mt-0.5 line-clamp-2 text-xs text-mesa-text-secondary">{item.item_descricao}</p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mesa-display text-sm font-semibold text-mesa-text-primary">
            {item.item_preco_centavos > 0 ? formatarPrecoBR(item.item_preco_centavos) : 'Sob consulta'}
          </span>
          <BotaoAdicionar
            variant="sm"
            podeComprar={podeComprar && item.item_preco_centavos > 0}
            esgotado={item.item_esgotado}
            quantidadeNoCarrinho={quantidadeNoCarrinho}
            onAdicionar={onAdicionar}
          />
        </div>
      </div>
    </div>
  )
}

function CardDestaque({
  item,
  podeComprar,
  quantidadeNoCarrinho,
  onAdicionar,
}: {
  item: LinhaCardapioPublico
  podeComprar: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
}) {
  return (
    <div className="overflow-hidden rounded-mesa-lg border border-mesa-border-subtle bg-mesa-surface shadow-mesa-2">
      <div className="relative aspect-[16/10] w-full bg-mesa-neutral-100 dark:bg-mesa-neutral-700">
        {item.item_foto_url ? (
          <img src={item.item_foto_url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-mesa-text-tertiary">
            <Icone nome="image" size={32} />
          </span>
        )}
        <span className="absolute left-3 top-3 flex items-center gap-1 whitespace-nowrap rounded-mesa-full bg-mesa-orange-500 px-2.5 py-1 text-xs font-bold text-mesa-neutral-900 shadow-mesa-1">
          <Icone nome="trophy" size={14} preenchido />
          Mais pedido do cardápio
        </span>
        {item.item_esgotado && (
          <span className="absolute inset-0 flex items-center justify-center bg-mesa-neutral-900/60 text-sm font-bold uppercase text-white">
            Esgotado
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="text-lg font-bold text-mesa-text-primary">{item.item_nome}</p>
        {item.item_descricao && (
          <p className="mt-1 text-sm text-mesa-text-secondary">{item.item_descricao}</p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="font-mesa-display text-xl font-bold text-mesa-text-primary">
            {item.item_preco_centavos > 0 ? formatarPrecoBR(item.item_preco_centavos) : 'Sob consulta'}
          </span>
          <BotaoAdicionar
            variant="md"
            podeComprar={podeComprar && item.item_preco_centavos > 0}
            esgotado={item.item_esgotado}
            quantidadeNoCarrinho={quantidadeNoCarrinho}
            onAdicionar={onAdicionar}
          />
        </div>
      </div>
    </div>
  )
}

export function CardapioPublico() {
  const { slug } = useParams<{ slug: string }>()
  const [estado, setEstado] = useState<Estado>(() =>
    slug ? { status: 'carregando' } : { status: 'erro' },
  )
  const [busca, setBusca] = useState('')
  const [filtroAtivo, setFiltroAtivo] = useState<string | null>(null)

  const [carrinho, setCarrinho] = useState<Carrinho>({})
  const [mostrarCheckout, setMostrarCheckout] = useState(false)
  const [modoConsumo, setModoConsumo] = useState<ModoConsumo>('balcao')
  const [mesa, setMesa] = useState('')
  const [observacao, setObservacao] = useState('')
  const [pagamento, setPagamento] = useState<EstadoPagamento>({ fase: 'formulario' })
  const [copiado, setCopiado] = useState(false)
  const clientUuidRef = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!slug) return

    let cancelado = false
    supabase
      .rpc('cardapio_publico', { p_slug: slug })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error || !data || (data as LinhaCardapioPublico[]).length === 0) {
          setEstado({ status: 'erro' })
          return
        }
        setEstado({ status: 'pronto', linhas: data as LinhaCardapioPublico[] })
      })

    return () => {
      cancelado = true
    }
  }, [slug])

  // Polling do status do pagamento — mesmo espírito do polling de
  // fallback que useRealtimePedidos usa quando o Realtime cai, só que
  // aqui é sempre polling (o cliente é anônimo, sem sessão pra abrir uma
  // subscription Realtime).
  useEffect(() => {
    if (pagamento.fase !== 'aguardando') return
    const pendenteId = pagamento.pendenteId
    let cancelado = false

    const intervalo = window.setInterval(async () => {
      const { data: linha } = await supabase
        .rpc('consultar_status_pagamento', { p_id: pendenteId })
        .maybeSingle()
      const data = linha as { status: string; senha: number | null } | null
      if (cancelado || !data) return

      if (data.status === 'aprovado') {
        setPagamento({ fase: 'aprovado', senha: data.senha })
      } else if (data.status === 'rejeitado' || data.status === 'expirado') {
        setPagamento({ fase: 'recusado' })
      }
    }, INTERVALO_POLLING_MS)

    return () => {
      cancelado = true
      window.clearInterval(intervalo)
    }
  }, [pagamento])

  const linhas = useMemo(() => (estado.status === 'pronto' ? estado.linhas : []), [estado])

  const itemPorId = useMemo(() => new Map(linhas.map((l) => [l.item_id, l])), [linhas])

  const categorias = useMemo(() => {
    const grupos: { nome: string; itens: LinhaCardapioPublico[] }[] = []
    for (const linha of linhas) {
      const nomeCategoria = linha.categoria_nome ?? 'Outros'
      const grupo = grupos.find((c) => c.nome === nomeCategoria)
      if (grupo) grupo.itens.push(linha)
      else grupos.push({ nome: nomeCategoria, itens: [linha] })
    }
    return grupos
  }, [linhas])

  const itensMaisPedidos = useMemo(
    () =>
      linhas
        .filter((l) => l.pedidos_30d > 0)
        .sort((a, b) => b.pedidos_30d - a.pedidos_30d)
        .slice(0, MAXIMO_MAIS_PEDIDOS),
    [linhas],
  )

  // Mesmo padrão de Lançar Pedido: prioriza "Mais Pedidos" quando existe
  // histórico, senão cai na primeira categoria — computado direto do dado,
  // sem sincronizar em efeito.
  const filtroEfetivo =
    filtroAtivo ?? (itensMaisPedidos.length > 0 ? 'mais-pedidos' : (categorias[0]?.nome ?? null))

  const itensDoFiltro =
    filtroEfetivo === 'todos'
      ? linhas
      : filtroEfetivo === 'mais-pedidos'
        ? itensMaisPedidos
        : (categorias.find((c) => c.nome === filtroEfetivo)?.itens ?? [])

  const itemDestaque = itensMaisPedidos[0] ?? null

  const buscaNormalizada = busca.trim().toLowerCase()
  const itensExibidos = buscaNormalizada
    ? itensDoFiltro.filter(
        (i) =>
          i.item_nome.toLowerCase().includes(buscaNormalizada) ||
          (i.item_descricao ?? '').toLowerCase().includes(buscaNormalizada),
      )
    : // O item destaque já aparece no card grande acima — tira ele da lista
      // pra não repetir o mesmo prato duas vezes na tela.
      itensDoFiltro.filter((i) => i.item_id !== itemDestaque?.item_id)

  const itensCarrinho = useMemo(
    () =>
      Object.entries(carrinho)
        .map(([itemId, quantidade]) => ({ item: itemPorId.get(itemId), quantidade }))
        .filter((l): l is { item: LinhaCardapioPublico; quantidade: number } => Boolean(l.item)),
    [carrinho, itemPorId],
  )
  const totalItensCarrinho = itensCarrinho.reduce((soma, l) => soma + l.quantidade, 0)
  const totalCentavosCarrinho = itensCarrinho.reduce(
    (soma, l) => soma + l.item.item_preco_centavos * l.quantidade,
    0,
  )

  function adicionarAoCarrinho(itemId: string) {
    setCarrinho((atual) => ({ ...atual, [itemId]: (atual[itemId] ?? 0) + 1 }))
  }

  function alterarQuantidade(itemId: string, delta: number) {
    setCarrinho((atual) => {
      const nova = Math.max(0, (atual[itemId] ?? 0) + delta)
      const copia = { ...atual }
      if (nova === 0) delete copia[itemId]
      else copia[itemId] = nova
      return copia
    })
  }

  function fecharCheckout() {
    setMostrarCheckout(false)
    if (pagamento.fase === 'aprovado') {
      setCarrinho({})
      setMesa('')
      setObservacao('')
      clientUuidRef.current = crypto.randomUUID()
    }
    setPagamento({ fase: 'formulario' })
  }

  async function pagar() {
    if (!slug || itensCarrinho.length === 0) return
    const barracaId = itensCarrinho[0].item.barraca_id

    setPagamento({ fase: 'processando' })

    const { data, error } = await supabase.functions.invoke('criar-pagamento-pix', {
      body: {
        barraca_id: barracaId,
        mesa: modoConsumo === 'mesa' ? mesa.trim() || null : null,
        viagem: modoConsumo === 'viagem',
        observacao: observacao.trim() || null,
        client_uuid: clientUuidRef.current,
        itens: itensCarrinho.map((l) => ({ item_id: l.item.item_id, quantidade: l.quantidade })),
      },
    })

    if (error || !data || data.erro) {
      setPagamento({
        fase: 'erro',
        mensagem: data?.erro ?? 'Não foi possível gerar o pagamento. Tente novamente.',
      })
      return
    }

    setPagamento({
      fase: 'aguardando',
      pendenteId: data.pendente_id,
      qrCode: data.qr_code,
      qrCodeBase64: data.qr_code_base64,
    })
  }

  async function copiarCodigoPix() {
    if (pagamento.fase !== 'aguardando' || !pagamento.qrCode) return
    try {
      await navigator.clipboard.writeText(pagamento.qrCode)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard indisponível (ex.: contexto não-seguro) — sem fallback,
      // o código ainda fica selecionável na tela.
    }
  }

  if (estado.status === 'carregando') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-mesa-text-secondary">Carregando cardápio...</p>
      </div>
    )
  }

  if (estado.status === 'erro') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-mesa-bg-base p-6 text-center">
        <Icone nome="restaurant" size={32} className="text-mesa-text-tertiary" />
        <p className="text-base font-semibold text-mesa-text-primary">Cardápio não encontrado</p>
        <p className="text-sm text-mesa-text-secondary">
          Confira se o link está certo ou pergunte pra barraca se o cardápio já está publicado.
        </p>
      </div>
    )
  }

  const nomeBarraca = linhas[0].barraca_nome
  const logoUrl = linhas[0].barraca_logo_url
  const podeComprar = linhas[0].pagamento_online_habilitado

  return (
    <div className="min-h-dvh bg-mesa-bg-base pb-12">
      <div className="flex flex-col items-center gap-3 px-6 pb-5 pt-[calc(env(safe-area-inset-top)+32px)] text-center">
        <span className="flex size-16 items-center justify-center overflow-hidden rounded-mesa-full bg-mesa-surface shadow-mesa-1">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <Icone nome="restaurant" size={24} className="text-mesa-text-tertiary" />
          )}
        </span>
        <div>
          <h1 className="text-2xl font-bold leading-tight text-mesa-text-primary">{nomeBarraca}</h1>
          <p className="mt-0.5 text-sm text-mesa-text-secondary">
            {podeComprar
              ? 'Monte seu pedido e pague com Pix direto por aqui'
              : 'Dá uma olhada no cardápio antes de pedir no balcão'}
          </p>
        </div>
      </div>

      {itemDestaque && !busca.trim() && (
        <div className="mb-5 px-6">
          <CardDestaque
            item={itemDestaque}
            podeComprar={podeComprar}
            quantidadeNoCarrinho={carrinho[itemDestaque.item_id] ?? 0}
            onAdicionar={() => adicionarAoCarrinho(itemDestaque.item_id)}
          />
        </div>
      )}

      <div className="px-6">
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onClear={() => setBusca('')}
          placeholder="Buscar item do cardápio"
          aria-label="Buscar item do cardápio"
          icon={<Icone nome="search" size={16} />}
        />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto px-6 pb-1">
        <Chip
          variant={filtroEfetivo === 'todos' ? 'teal' : 'plain'}
          checked={filtroEfetivo === 'todos'}
          onClick={() => setFiltroAtivo('todos')}
        >
          Todos
        </Chip>
        {itensMaisPedidos.length > 0 && (
          <Chip
            variant={filtroEfetivo === 'mais-pedidos' ? 'teal' : 'plain'}
            checked={filtroEfetivo === 'mais-pedidos'}
            onClick={() => setFiltroAtivo('mais-pedidos')}
          >
            <Icone nome="star" size={14} /> Mais Pedidos
          </Chip>
        )}
        {categorias.map((categoria) => (
          <Chip
            key={categoria.nome}
            variant={filtroEfetivo === categoria.nome ? 'teal' : 'plain'}
            checked={filtroEfetivo === categoria.nome}
            onClick={() => setFiltroAtivo(categoria.nome)}
          >
            {categoria.nome} · {categoria.itens.length}
          </Chip>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 px-6 pb-24">
        {itensExibidos.length === 0 ? (
          <p className="py-8 text-center text-sm text-mesa-text-secondary">
            Nenhum item encontrado.
          </p>
        ) : (
          itensExibidos.map((item) => {
            // Mesmo padrão de Lançar Pedido: o selo aparece em qualquer
            // categoria/filtro em que o item esteja, não só na aba "Mais
            // Pedidos" — é isso que ajuda o cliente a se direcionar.
            const indicePopular = itensMaisPedidos.indexOf(item)
            return (
              <CardItemPublico
                key={item.item_id}
                item={item}
                posicaoPopular={indicePopular === -1 ? null : indicePopular}
                podeComprar={podeComprar}
                quantidadeNoCarrinho={carrinho[item.item_id] ?? 0}
                onAdicionar={() => adicionarAoCarrinho(item.item_id)}
              />
            )
          })
        )}
      </div>

      <p className="mt-8 text-center text-xs text-mesa-text-tertiary">
        Feito com Sai aê
      </p>

      {podeComprar && totalItensCarrinho > 0 && !mostrarCheckout && (
        <div className="fixed inset-x-0 bottom-4 px-4">
          <button
            type="button"
            onClick={() => setMostrarCheckout(true)}
            className="flex w-full items-center justify-between gap-3 rounded-mesa-lg bg-mesa-neutral-900 py-4 pl-5 pr-4 text-left text-white shadow-mesa-3 outline-none transition-transform active:scale-[0.99] dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900"
          >
            <span>
              <span className="block text-sm text-white/80 dark:text-mesa-neutral-900/70">
                {totalItensCarrinho} {totalItensCarrinho === 1 ? 'item' : 'itens'}
              </span>
              <span className="block font-mesa-display text-xl font-bold leading-tight">
                {formatarPrecoBR(totalCentavosCarrinho)}
              </span>
            </span>
            <span className="flex items-center gap-1 rounded-mesa-full bg-mesa-orange-500 px-4 py-2.5 text-sm font-bold text-mesa-neutral-900">
              Ver pedido
              <Icone nome="arrow_forward" size={16} />
            </span>
          </button>
        </div>
      )}

      <BottomSheet open={mostrarCheckout} onClose={fecharCheckout} aria-label="Seu pedido">
        {pagamento.fase === 'formulario' && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-mesa-text-primary">Seu pedido</h2>

            <div className="flex flex-col gap-2">
              {itensCarrinho.map(({ item, quantidade }) => (
                <div key={item.item_id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-mesa-text-primary">{item.item_nome}</p>
                    <p className="text-xs text-mesa-text-secondary">{formatarPrecoBR(item.item_preco_centavos)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Diminuir ${item.item_nome}`}
                      onClick={() => alterarQuantidade(item.item_id, -1)}
                      className="flex size-8 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 text-mesa-text-primary dark:bg-mesa-neutral-700"
                    >
                      <Icone nome="remove" size={14} />
                    </button>
                    <span className="w-4 text-center text-sm font-semibold text-mesa-text-primary">
                      {quantidade}
                    </span>
                    <button
                      type="button"
                      aria-label={`Aumentar ${item.item_nome}`}
                      onClick={() => alterarQuantidade(item.item_id, 1)}
                      className="flex size-8 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900"
                    >
                      <Icone nome="add" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <SegmentedControl
              aria-label="Mesa, balcão ou viagem"
              items={[{ label: 'Mesa' }, { label: 'Balcão' }, { label: 'Viagem' }]}
              activeIndex={modoConsumo === 'mesa' ? 0 : modoConsumo === 'balcao' ? 1 : 2}
              onChange={(indice) => setModoConsumo(indice === 0 ? 'mesa' : indice === 1 ? 'balcao' : 'viagem')}
            />

            {modoConsumo === 'mesa' && (
              <Input
                value={mesa}
                onChange={(e) => setMesa(e.target.value)}
                placeholder="Número ou nome da mesa"
                aria-label="Mesa"
              />
            )}

            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Observação do pedido (opcional)"
              aria-label="Observação do pedido"
            />

            <div className="flex items-center justify-between border-t border-mesa-border-subtle pt-3">
              <span className="text-sm text-mesa-text-secondary">Total</span>
              <span className="font-mesa-display text-lg font-bold text-mesa-text-primary">
                {formatarPrecoBR(totalCentavosCarrinho)}
              </span>
            </div>

            <Button
              size="xl"
              icon={<Icone nome="qr_code" size={20} />}
              className="w-full"
              disabled={itensCarrinho.length === 0}
              onClick={pagar}
            >
              Pagar com Pix
            </Button>
          </div>
        )}

        {pagamento.fase === 'processando' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Icone nome="progress_activity" size={32} className="animate-spin text-mesa-text-tertiary" />
            <p className="text-sm text-mesa-text-secondary">Gerando o Pix...</p>
          </div>
        )}

        {pagamento.fase === 'aguardando' && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <h2 className="text-lg font-semibold text-mesa-text-primary">Pague com Pix pra confirmar</h2>
            <p className="text-sm text-mesa-text-secondary">
              Assim que o pagamento cair, seu pedido já vai direto pra cozinha.
            </p>
            {pagamento.qrCodeBase64 && (
              <img
                src={`data:image/png;base64,${pagamento.qrCodeBase64}`}
                alt="QR code Pix"
                className="size-56 rounded-mesa-md border border-mesa-border-subtle"
              />
            )}
            {pagamento.qrCode && (
              <Button variant="outline" size="md" icon={<Icone nome="content_copy" size={16} />} onClick={copiarCodigoPix}>
                {copiado ? 'Copiado!' : 'Copiar código Pix'}
              </Button>
            )}
          </div>
        )}

        {pagamento.fase === 'aprovado' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Icone nome="check_circle" size={40} className="text-mesa-success-500" />
            <h2 className="text-lg font-semibold text-mesa-text-primary">Pagamento confirmado!</h2>
            <p className="text-sm text-mesa-text-secondary">Seu pedido já foi pra cozinha.</p>
            {pagamento.senha !== null && (
              <p className="font-mesa-display text-3xl font-black text-mesa-text-primary">
                Senha {String(pagamento.senha).padStart(3, '0')}
              </p>
            )}
            <Button variant="ghost" size="md" onClick={fecharCheckout} className="mt-2 w-full">
              Fechar
            </Button>
          </div>
        )}

        {(pagamento.fase === 'recusado' || pagamento.fase === 'erro') && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Icone nome="error" size={32} className="text-mesa-error-500" />
            <h2 className="text-lg font-semibold text-mesa-text-primary">
              {pagamento.fase === 'recusado' ? 'Pagamento não confirmado' : 'Não deu certo'}
            </h2>
            <p className="text-sm text-mesa-text-secondary">
              {pagamento.fase === 'erro' ? pagamento.mensagem : 'O Pix expirou ou foi recusado. Tente de novo.'}
            </p>
            <Button
              size="md"
              className="mt-2 w-full"
              onClick={() => {
                clientUuidRef.current = crypto.randomUUID()
                setPagamento({ fase: 'formulario' })
              }}
            >
              Tentar de novo
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
