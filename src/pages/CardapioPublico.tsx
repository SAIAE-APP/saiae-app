import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { formatarPrecoBR } from '../lib/preco'
import { ROTULO_MODO, modoInicial, modosDoCardapioPublico } from '../lib/atendimento'
import type { TipoAtendimento } from '../types/database'
import { Button } from '../components/ui/Button'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Checkbox } from '../components/ui/Checkbox'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Textarea } from '../components/ui/Textarea'
import { statusFuncionamento, type HorarioPublico } from '../lib/horarioFuncionamento'
import { montarMensagemPagarNaEntrega, urlWhatsappDono } from '../lib/pagarNaEntrega'
import { formatarTelefoneBR } from '../lib/entrega'
import { buscarBairrosPublicos, taxaDoBairro, type BairrosPublicos } from '../lib/bairros'

type LinhaCardapioPublico = {
  barraca_id: string
  barraca_nome: string
  barraca_logo_url: string | null
  barraca_imagem_capa_url: string | null
  pagamento_online_habilitado: boolean
  /** WhatsApp do dono (só dígitos) quando "Pagar na entrega" está ligado; ausente na função antiga. */
  barraca_whatsapp_pedidos?: string | null
  /** Ausente enquanto a migration da função não está no banco: usar `modosDoCardapioPublico`. */
  barraca_modos_atendimento?: TipoAtendimento[] | null
  item_id: string
  item_nome: string
  item_descricao: string | null
  item_foto_url: string | null
  item_preco_centavos: number
  item_esgotado: boolean
  item_popular: boolean
  categoria_nome: string | null
  pedidos_30d: number
}

type BannerPublico = {
  id: string
  imagem_url: string
  titulo: string | null
  cta_texto: string | null
}

type Estado =
  | { status: 'carregando' }
  | { status: 'erro' }
  | { status: 'pronto'; linhas: LinhaCardapioPublico[] }

type Carrinho = Record<string, number>
type ModoConsumo = 'mesa' | 'balcao' | 'retirada' | 'entrega'

// Fase 2+3 do Cardápio Digital (CLAUDE.md, roadmap): o pedido de verdade
// só nasce depois do pagamento confirmado (ver edge functions
// criar-pagamento-pix/webhook-mercadopago) — enquanto isso, o checkout
// fica nesses estados intermediários.
type EstadoPagamento =
  | { fase: 'formulario' }
  | { fase: 'processando' }
  | { fase: 'aguardando'; pendenteId: string; qrCode: string | null; qrCodeBase64: string | null }
  | { fase: 'aprovado'; senha: number | null }
  // "Pagar na entrega": dados do cliente -> envio -> pedido já na cozinha + wa.me do dono.
  | { fase: 'dados_entrega'; erro?: string }
  | { fase: 'enviando_entrega' }
  | { fase: 'entrega_enviada'; senha: number | null; urlWhatsapp: string; abriu: boolean }
  | { fase: 'recusado' }
  | { fase: 'erro'; mensagem: string }

const MAXIMO_MAIS_PEDIDOS = 8
const INTERVALO_POLLING_MS = 3000

function BottomSheetFinalizarBalcao({
  open,
  onClose,
  totalItens,
}: {
  open: boolean
  onClose: () => void
  totalItens: number
}) {
  return (
    <BottomSheet open={open} onClose={onClose} aria-label="Finalizar no caixa">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Finalize no caixa</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Esse cardápio ainda não tem pagamento online por aqui — não feche essa tela e mostre pra
        quem está no caixa pra fechar seu pedido: {totalItens}{' '}
        {totalItens === 1 ? 'item selecionado' : 'itens selecionados'}.
      </p>
      <Button variant="ghost" size="md" onClick={onClose} className="mt-6 w-full">
        Entendi
      </Button>
    </BottomSheet>
  )
}

/** Mesmo padrão de stepper de Lançar Pedido (BotaoStepper): vira +/- assim
 * que tem quantidade no carrinho, em vez de só "N no carrinho" sem jeito de
 * tirar item — precisava dar pra ajustar direto no card, não só dentro do
 * checkout. */
function BotaoAdicionar({
  variant,
  podeAdicionar,
  esgotado,
  quantidadeNoCarrinho,
  onAdicionar,
  onRemover,
}: {
  variant: 'sm' | 'md'
  podeAdicionar: boolean
  esgotado: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
  onRemover: () => void
}) {
  if (esgotado) {
    return (
      <Button variant="outline" size={variant} disabled>
        Esgotado
      </Button>
    )
  }

  if (quantidadeNoCarrinho > 0) {
    return (
      <div className="flex items-center gap-1 rounded-mesa-full bg-mesa-neutral-100 p-1 dark:bg-mesa-neutral-800">
        <button
          type="button"
          onClick={onRemover}
          aria-label="Diminuir quantidade"
          className="flex size-11 -m-2 items-center justify-center"
        >
          <span className="flex size-7 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white transition-transform active:scale-90 dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
            <Icone nome="remove" size={14} />
          </span>
        </button>
        <span className="min-w-[1.5ch] text-center font-mesa-display text-sm font-bold text-mesa-text-primary">
          {quantidadeNoCarrinho}
        </span>
        <button
          type="button"
          onClick={onAdicionar}
          disabled={!podeAdicionar}
          aria-label="Aumentar quantidade"
          className="flex size-11 -m-2 items-center justify-center disabled:opacity-40"
        >
          <span className="flex size-7 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white transition-transform active:scale-90 dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
            <Icone nome="add" size={14} />
          </span>
        </button>
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size={variant}
      icon={<Icone nome="add" size={16} />}
      disabled={!podeAdicionar}
      onClick={onAdicionar}
    >
      Adicionar
    </Button>
  )
}

function CardItemPublico({
  item,
  posicaoPopular,
  podeComprar,
  quantidadeNoCarrinho,
  onAdicionar,
  onRemover,
}: {
  item: LinhaCardapioPublico
  posicaoPopular: number | null
  podeComprar: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
  onRemover: () => void
}) {
  return (
    <div className="relative flex gap-3 rounded-mesa-xl border border-mesa-border-subtle bg-mesa-surface p-3 shadow-mesa-1">
      <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
        {item.item_foto_url ? (
          <img src={item.item_foto_url} alt="" className="size-full object-cover" />
        ) : (
          <Icone nome="image" size={20} />
        )}
        {posicaoPopular !== null && !item.item_esgotado && (
          <span className="absolute left-0.5 top-0.5 flex items-center gap-0.5 whitespace-nowrap rounded-mesa-balao bg-mesa-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-mesa-neutral-900 shadow-mesa-1">
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
            podeAdicionar={!podeComprar || item.item_preco_centavos > 0}
            esgotado={item.item_esgotado}
            quantidadeNoCarrinho={quantidadeNoCarrinho}
            onAdicionar={onAdicionar}
            onRemover={onRemover}
          />
        </div>
      </div>
    </div>
  )
}

// Fallback quando a barraca não cadastrou banner próprio (2026-09-27,
// pedido de produto) — promocional da própria marca Sai aê, imagens com
// texto já embutido (design), por isso sem overlay de título/CTA como os
// banners reais têm. `titulo` aqui só vira `alt`, nunca aparece na tela.
const BANNERS_PADRAO_SAIAE: BannerPublico[] = [
  {
    id: 'padrao-pastel-sem-fila',
    imagem_url: '/banners-padrao/pastel-sem-fila.webp',
    titulo: 'Sai aê um pastel? Pede pelo celular, sem fila',
    cta_texto: null,
  },
  {
    id: 'padrao-pix-direto-cozinha',
    imagem_url: '/banners-padrao/pix-direto-cozinha.webp',
    titulo: 'Pagou no Pix? Já foi pra cozinha! Seu pedido chega lá na hora, sem passar pelo caixa',
    cta_texto: null,
  },
  {
    id: 'padrao-fique-de-olho-senha',
    imagem_url: '/banners-padrao/fique-de-olho-senha.webp',
    titulo: 'Fique de olho na sua senha! Quando ficar pronto, a gente chama. Pode relaxar.',
    cta_texto: null,
  },
]

const INTERVALO_CARROSSEL_MS = 3000
const PAUSA_APOS_INTERACAO_MS = 4000

/** Carrossel de banners do topo — conteúdo configurável pelo dono da
 * barraca em Ajustes (SecaoBanners), não fixo do app. Sem banner próprio
 * cadastrado, mostra os padrão da marca Sai aê (BANNERS_PADRAO_SAIAE) em
 * vez de ficar vazio. Só aparece fora de busca, mesmo espírito das seções
 * Populares/Mais pedido abaixo.
 *
 * Avança sozinho a cada 3s (pedido de produto, 2026-09-27) — pausa quando o
 * cliente interage manualmente (toque/arrasto) por alguns segundos, pra não
 * brigar com o gesto dele, e retoma sozinho depois. `pausadoRef` em vez de
 * estado porque pausar não deve re-renderizar nem reiniciar o interval, só
 * fazer o próximo tick ser ignorado. */
function CarrosselBanners({ banners }: { banners: BannerPublico[] }) {
  const usandoPadrao = banners.length === 0
  const exibidos = usandoPadrao ? BANNERS_PADRAO_SAIAE : banners

  const containerRef = useRef<HTMLDivElement>(null)
  const [indiceAtivo, setIndiceAtivo] = useState(0)
  const pausadoRef = useRef(false)
  const timeoutRetomadaRef = useRef<number | null>(null)

  useEffect(() => {
    if (exibidos.length <= 1) return
    const intervalo = window.setInterval(() => {
      if (!pausadoRef.current) setIndiceAtivo((atual) => (atual + 1) % exibidos.length)
    }, INTERVALO_CARROSSEL_MS)
    return () => window.clearInterval(intervalo)
  }, [exibidos.length])

  // scrollIntoView rola qualquer ancestral rolável até o elemento ficar
  // visível — se a página já tinha rolado pra baixo (carrossel fora da
  // viewport), o auto-play jogava a página inteira de volta pro topo.
  // scrollTo no container mexe só no scroll horizontal do carrossel.
  useEffect(() => {
    const filho = containerRef.current?.children[indiceAtivo] as HTMLElement | undefined
    if (containerRef.current && filho) {
      containerRef.current.scrollTo({ left: filho.offsetLeft, behavior: 'smooth' })
    }
  }, [indiceAtivo])

  useEffect(() => {
    return () => {
      if (timeoutRetomadaRef.current) window.clearTimeout(timeoutRetomadaRef.current)
    }
  }, [])

  function pausarPorInteracao() {
    pausadoRef.current = true
    if (timeoutRetomadaRef.current) window.clearTimeout(timeoutRetomadaRef.current)
    timeoutRetomadaRef.current = window.setTimeout(() => {
      pausadoRef.current = false
    }, PAUSA_APOS_INTERACAO_MS)
  }

  return (
    <div className="mb-5">
      <div
        ref={containerRef}
        onPointerDown={pausarPorInteracao}
        onTouchStart={pausarPorInteracao}
        className="rolagem-sem-barra flex snap-x snap-mandatory overflow-x-auto"
      >
        {/* Padding mora dentro de cada slide (não no container) — cada slide
            já ocupa a largura cheia da tela, então o card fica sempre
            centralizado com a mesma margem dos dois lados, sem nenhum
            vizinho espiando na borda (que acontecia quando o padding era só
            nas pontas da fileira toda). */}
        {exibidos.map((banner) => (
          <div key={banner.id} className="w-full shrink-0 snap-start px-6">
            <div className="relative aspect-[16/7] w-full overflow-hidden rounded-mesa-xl bg-mesa-neutral-100 shadow-mesa-1 dark:bg-mesa-neutral-700">
              <img src={banner.imagem_url} alt={banner.titulo ?? ''} className="size-full object-cover" />
              {!usandoPadrao && (banner.titulo || banner.cta_texto) && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-mesa-neutral-900/85 to-transparent p-4 pt-8">
                  {banner.titulo && <p className="text-base font-bold text-white">{banner.titulo}</p>}
                  {banner.cta_texto && <p className="text-xs text-white/85">{banner.cta_texto}</p>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {exibidos.length > 1 && (
        <div className="mt-2 flex justify-center gap-1" aria-hidden>
          {exibidos.map((banner, indice) => (
            <span
              key={banner.id}
              className={clsx(
                'h-1.5 rounded-full transition-[width,background-color] duration-[var(--mesa-duration-short)]',
                indice === indiceAtivo ? 'w-5 bg-mesa-orange-500' : 'w-1.5 bg-mesa-neutral-200 dark:bg-mesa-neutral-700',
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Versão compacta do stepper — a versão com texto de BotaoAdicionar não
 * cabe no card estreito das seções horizontais (Populares/Mais pedido). O
 * aviso de "sem pagamento online" aparece só na hora de finalizar
 * (BottomSheetFinalizarBalcao), não mais no clique de cada item. */
function BotaoAdicionarCompacto({
  podeAdicionar,
  esgotado,
  quantidadeNoCarrinho,
  onAdicionar,
  onRemover,
}: {
  podeAdicionar: boolean
  esgotado: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
  onRemover: () => void
}) {
  if (quantidadeNoCarrinho > 0) {
    return (
      <div className="flex items-center gap-0.5 rounded-mesa-full bg-mesa-neutral-900 px-1 py-1 text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
        <button
          type="button"
          onClick={onRemover}
          aria-label="Diminuir quantidade"
          className="flex size-5 items-center justify-center"
        >
          <Icone nome="remove" size={12} />
        </button>
        <span className="min-w-[1ch] text-center font-mesa-display text-xs font-bold">{quantidadeNoCarrinho}</span>
        <button
          type="button"
          onClick={onAdicionar}
          disabled={!podeAdicionar}
          aria-label="Aumentar quantidade"
          className="flex size-5 items-center justify-center disabled:opacity-40"
        >
          <Icone nome="add" size={12} />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      disabled={esgotado || !podeAdicionar}
      onClick={onAdicionar}
      aria-label="Adicionar ao carrinho"
      className="flex size-8 shrink-0 items-center justify-center rounded-mesa-full border border-mesa-border-strong text-mesa-text-primary disabled:opacity-40"
    >
      <Icone nome="add" size={16} />
    </button>
  )
}

/** Card compacto usado nas seções horizontais Populares/Mais pedido —
 * mais estreito que CardItemPublico (que é a linha da lista completa
 * abaixo). `destaque` reaproveita o mesmo selo Top1/Popular do card do
 * meio da lista. */
function CardItemHorizontal({
  item,
  destaque,
  podeComprar,
  quantidadeNoCarrinho,
  onAdicionar,
  onRemover,
}: {
  item: LinhaCardapioPublico
  destaque: 'top1' | 'popular' | null
  podeComprar: boolean
  quantidadeNoCarrinho: number
  onAdicionar: () => void
  onRemover: () => void
}) {
  return (
    <div className="w-36 shrink-0 overflow-hidden rounded-mesa-xl border border-mesa-border-subtle bg-mesa-surface shadow-mesa-1">
      <div className="relative aspect-square w-full bg-mesa-neutral-100 dark:bg-mesa-neutral-700">
        {item.item_foto_url ? (
          <img src={item.item_foto_url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-mesa-text-tertiary">
            <Icone nome="image" size={20} />
          </span>
        )}
        {destaque && !item.item_esgotado && (
          <span className="absolute left-1 top-1 flex items-center gap-0.5 whitespace-nowrap rounded-mesa-balao bg-mesa-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-mesa-neutral-900 shadow-mesa-1">
            <Icone nome="star" size={8} preenchido />
            {destaque === 'top1' ? 'Top 1' : 'Popular'}
          </span>
        )}
        {item.item_esgotado && (
          <span className="absolute inset-0 flex items-center justify-center bg-mesa-neutral-900/60 text-[9px] font-bold uppercase text-white">
            Esgotado
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="line-clamp-1 text-sm font-semibold text-mesa-text-primary">{item.item_nome}</p>
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span className="font-mesa-display text-xs font-semibold text-mesa-text-primary">
            {item.item_preco_centavos > 0 ? formatarPrecoBR(item.item_preco_centavos) : 'Consulta'}
          </span>
          <BotaoAdicionarCompacto
            podeAdicionar={!podeComprar || item.item_preco_centavos > 0}
            esgotado={item.item_esgotado}
            quantidadeNoCarrinho={quantidadeNoCarrinho}
            onAdicionar={onAdicionar}
            onRemover={onRemover}
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
  const [banners, setBanners] = useState<BannerPublico[]>([])
  const [horarios, setHorarios] = useState<HorarioPublico[]>([])
  const [busca, setBusca] = useState('')
  const [filtroAtivo, setFiltroAtivo] = useState<string | null>(null)

  const [carrinho, setCarrinho] = useState<Carrinho>({})
  const [mostrarCheckout, setMostrarCheckout] = useState(false)
  const [modoConsumo, setModoConsumo] = useState<ModoConsumo>('balcao')
  const [mesa, setMesa] = useState('')
  const [observacao, setObservacao] = useState('')
  const [pagamento, setPagamento] = useState<EstadoPagamento>({ fase: 'formulario' })
  const [nomeCliente, setNomeCliente] = useState('')
  const [telefoneCliente, setTelefoneCliente] = useState('')
  const [enderecoCliente, setEnderecoCliente] = useState('')
  const [honeypot, setHoneypot] = useState('')
  // Entrega estruturada (modo Entrega do cardápio)
  const [ruaCliente, setRuaCliente] = useState('')
  const [numeroCliente, setNumeroCliente] = useState('')
  const [bairroCliente, setBairroCliente] = useState('')
  const [bairroOutro, setBairroOutro] = useState(false)
  const [referenciaCliente, setReferenciaCliente] = useState('')
  const [consentimento, setConsentimento] = useState(false)
  const [aceitaOfertas, setAceitaOfertas] = useState(false)
  const [bairrosPublicos, setBairrosPublicos] = useState<BairrosPublicos | null>(null)
  const aberturaCheckoutRef = useRef(0)
  const [copiado, setCopiado] = useState(false)

  // Só os modos que a barraca ligou em Ajustes. Entrega entra se a barraca a
  // ligou E o cardápio consegue finalizá-la ("Pagar na entrega" ou Pix).
  // Se o modo escolhido saiu da lista, cai no inicial em vez de pedir algo
  // indisponível.
  const modosPublicos = useMemo(() => {
    const primeira = estado.status === 'pronto' ? estado.linhas[0] : undefined
    const entregaDisponivel = Boolean(primeira?.barraca_whatsapp_pedidos) || Boolean(primeira?.pagamento_online_habilitado)
    return modosDoCardapioPublico(primeira?.barraca_modos_atendimento, entregaDisponivel)
  }, [estado]) as ModoConsumo[]
  const modoEfetivo: ModoConsumo = modosPublicos.includes(modoConsumo) ? modoConsumo : (modoInicial(modosPublicos) as ModoConsumo)
  const [mostrarAvisoBalcao, setMostrarAvisoBalcao] = useState(false)
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

  const entregaOfertada = modosPublicos.includes('entrega')
  useEffect(() => {
    if (!slug || !entregaOfertada) return
    let cancelado = false
    buscarBairrosPublicos(slug)
      .then((r) => {
        if (!cancelado) setBairrosPublicos(r)
      })
      .catch(() => {
        // Sem a lista o formulário cai em "bairro digitado"; o servidor decide a taxa.
      })
    return () => {
      cancelado = true
    }
  }, [slug, entregaOfertada])

  useEffect(() => {
    if (!slug) return

    let cancelado = false
    supabase
      .rpc('banners_publicos', { p_slug: slug })
      .then(({ data, error }) => {
        if (cancelado || error || !data) return
        setBanners(data as BannerPublico[])
      })

    return () => {
      cancelado = true
    }
  }, [slug])

  useEffect(() => {
    if (!slug) return

    let cancelado = false
    supabase
      .rpc('horarios_publicos', { p_slug: slug })
      .then(({ data, error }) => {
        if (cancelado || error || !data) return
        setHorarios(data as HorarioPublico[])
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

  const status = useMemo(() => statusFuncionamento(horarios), [horarios])

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

  // Curadoria manual do dono (itens.popular, Ajustes) — diferente de "Mais
  // pedido" acima, que é algorítmico (pedidos_30d).
  const itensPopulares = useMemo(() => linhas.filter((l) => l.item_popular), [linhas])

  // "Mais Pedidos" virou seção própria (abaixo), não é mais filtro de chip —
  // sobra só "Todos" + categorias, então o padrão passa a ser "Todos".
  const filtroEfetivo = filtroAtivo ?? 'todos'

  const itensDoFiltro =
    filtroEfetivo === 'todos'
      ? linhas
      : (categorias.find((c) => c.nome === filtroEfetivo)?.itens ?? [])

  const buscaNormalizada = busca.trim().toLowerCase()
  const itensExibidos = buscaNormalizada
    ? itensDoFiltro.filter(
        (i) =>
          i.item_nome.toLowerCase().includes(buscaNormalizada) ||
          (i.item_descricao ?? '').toLowerCase().includes(buscaNormalizada),
      )
    : itensDoFiltro

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
    if (pagamento.fase === 'aprovado' || pagamento.fase === 'entrega_enviada') {
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
        mesa: modoEfetivo === 'mesa' ? mesa.trim() || null : null,
        viagem: modoEfetivo === 'retirada',
        observacao: observacao.trim() || null,
        client_uuid: clientUuidRef.current,
        itens: itensCarrinho.map((l) => ({ item_id: l.item.item_id, quantidade: l.quantidade })),
      },
    })

    if (error || !data || data.erro) {
      // Com status não-2xx o supabase-js devolve `data` nulo e o corpo da
      // resposta fica em error.context — é de lá que sai o erro real.
      let corpo: { erro?: string; detalhe?: unknown } | null = data ?? null
      const contexto = (error as { context?: unknown } | null)?.context
      if (!corpo && contexto instanceof Response) {
        corpo = await contexto.json().catch(() => null)
      }
      console.error('Falha ao gerar pagamento Pix:', error, corpo?.erro, corpo?.detalhe)
      // 4xx são recusas nossas com texto pensado pro cliente (ex.: item
      // esgotado); 5xx/502 carregam erro cru do Mercado Pago — esse não vai
      // pra tela.
      const recusaNossa = contexto instanceof Response && contexto.status < 500
      setPagamento({
        fase: 'erro',
        mensagem:
          recusaNossa && corpo?.erro
            ? corpo.erro
            : 'Não foi possível gerar o Pix agora. Tente novamente em instantes ou chame o atendente.',
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

  async function enviarPedidoNaEntrega() {
    if (itensCarrinho.length === 0) return
    const numeroDono = linhas[0].barraca_whatsapp_pedidos
    if (!numeroDono) return
    const nome = nomeCliente.trim()
    const telefone = telefoneCliente.replace(/\D/g, '')
    const estruturada = modoEfetivo === 'entrega'
    if (estruturada) {
      const rua = ruaCliente.trim()
      const numero = numeroCliente.trim()
      const bairro = bairroCliente.trim()
      if (!rua || !numero || !bairro) {
        setPagamento({ fase: 'dados_entrega', erro: 'Informe rua, número e bairro.' })
        return
      }
      if (previaTaxa && !previaTaxa.permitido) {
        setPagamento({ fase: 'dados_entrega', erro: 'Não entregamos nesse bairro.' })
        return
      }
      if (!consentimento) {
        setPagamento({ fase: 'dados_entrega', erro: 'Marque a autorização para usarmos seus dados na entrega.' })
        return
      }
    }
    if (nome.length < 2) {
      setPagamento({ fase: 'dados_entrega', erro: 'Informe seu nome.' })
      return
    }
    if (telefone.length < 10 || telefone.length > 13) {
      setPagamento({ fase: 'dados_entrega', erro: 'Informe seu telefone com DDD.' })
      return
    }

    // Envio humano leva mais que 2s depois de abrir o formulário; mais rápido é
    // script (o servidor confere o mesmo tempo).
    const msNoCheckout = Date.now() - aberturaCheckoutRef.current
    if (msNoCheckout < 2000) {
      setPagamento({ fase: 'dados_entrega', erro: 'Confira seus dados e toque em Enviar pedido.' })
      return
    }

    setPagamento({ fase: 'enviando_entrega' })

    const { data, error } = await supabase.functions.invoke('criar-pedido-cardapio', {
      body: {
        barraca_id: itensCarrinho[0].item.barraca_id,
        client_uuid: clientUuidRef.current,
        website: honeypot,
        ms_no_checkout: msNoCheckout,
        nome,
        telefone,
        endereco: estruturada ? null : enderecoCliente.trim() || null,
        ...(estruturada
          ? {
              entrega: {
                nome,
                telefone,
                rua: ruaCliente.trim(),
                numero: numeroCliente.trim(),
                bairro: bairroCliente.trim(),
                referencia: referenciaCliente.trim() || null,
              },
              consentimento_lgpd: true,
              consentimento_marketing: aceitaOfertas,
            }
          : {}),
        observacao: observacao.trim() || null,
        itens: itensCarrinho.map((l) => ({ item_id: l.item.item_id, quantidade: l.quantidade })),
      },
    })

    if (error || !data || data.erro) {
      // Mesmo cuidado do Pix: com status não-2xx o corpo fica em error.context.
      let corpo: { erro?: string } | null = data ?? null
      const contexto = (error as { context?: unknown } | null)?.context
      if (!corpo && contexto instanceof Response) {
        corpo = await contexto.json().catch(() => null)
      }
      console.error('Falha ao enviar pedido (pagar na entrega):', error, corpo?.erro)
      const recusaNossa = contexto instanceof Response && contexto.status < 500
      // Mantém o client_uuid: tentar de novo é idempotente, não duplica o pedido.
      setPagamento({
        fase: 'dados_entrega',
        erro:
          recusaNossa && corpo?.erro
            ? corpo.erro
            : 'Não foi possível enviar o pedido agora. Tente de novo em instantes.',
      })
      return
    }

    // Resumo montado com o que o SERVIDOR devolveu (preços reais).
    const mensagem = montarMensagemPagarNaEntrega({
      nomeBarraca: linhas[0].barraca_nome,
      senha: data.senha ?? null,
      nome,
      telefone: formatarTelefoneBR(telefone),
      endereco: estruturada
        ? [`${ruaCliente.trim()}, ${numeroCliente.trim()} - ${bairroCliente.trim()}`, referenciaCliente.trim() && `(${referenciaCliente.trim()})`]
            .filter(Boolean)
            .join(' ')
        : enderecoCliente,
      observacao,
      itens: data.itens,
      totalCentavos: data.total_centavos,
      taxaCentavos: data.taxa_entrega_centavos ?? 0,
    })
    const urlWhatsapp = urlWhatsappDono(numeroDono, mensagem)
    // Depois de um await o navegador pode bloquear o pop-up: se bloquear, a tela
    // seguinte mostra o botão "Avisar no WhatsApp" (toque do cliente = permitido).
    const janela = window.open(urlWhatsapp, '_blank', 'noopener')
    setPagamento({ fase: 'entrega_enviada', senha: data.senha ?? null, urlWhatsapp, abriu: janela !== null })
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
  const capaUrl = linhas[0].barraca_imagem_capa_url
  const podeComprar = linhas[0].pagamento_online_habilitado
  const pagarNaEntrega = Boolean(linhas[0].barraca_whatsapp_pedidos)
  const entregaNoCardapio = modoEfetivo === 'entrega'
  // "Pagar na entrega": com Entrega ofertada só vale nesse modo; sem Entrega
  // ofertada segue como era (nome/telefone/endereço livre).
  const mostrarPagarNaEntrega = pagarNaEntrega && (!entregaOfertada || entregaNoCardapio)
  const bairrosLista = bairrosPublicos?.bairros ?? []
  const politicaBloqueia = bairrosPublicos?.config.naoListado === 'bloquear'
  const previaTaxa =
    entregaNoCardapio && bairrosPublicos && bairroCliente.trim()
      ? taxaDoBairro(bairrosPublicos.config, bairrosLista, bairroCliente)
      : null

  return (
    <div className="min-h-dvh bg-mesa-bg-base pb-12 pt-[env(safe-area-inset-top)] md:mx-auto md:max-w-4xl">
      {capaUrl && (
        <div className="aspect-[3/1] w-full overflow-hidden bg-mesa-neutral-100 dark:bg-mesa-neutral-700 md:aspect-[4/1] md:rounded-b-mesa-xl">
          <img src={capaUrl} alt="" className="size-full object-cover" />
        </div>
      )}

      <div
        className={
          capaUrl
            ? 'relative -mt-9 flex flex-col items-center gap-3 px-6 pb-5 text-center'
            : 'flex flex-col items-center gap-3 px-6 pb-5 pt-8 text-center'
        }
      >
        <span className="flex size-16 items-center justify-center overflow-hidden rounded-mesa-full bg-mesa-surface shadow-mesa-1 ring-4 ring-mesa-bg-base">
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
              : 'Monte sua lista aqui e finalize no caixa'}
          </p>
          {status && (
            <span
              className={`mt-2 inline-flex items-center gap-1 rounded-mesa-balao px-2 py-0.5 text-xs font-bold ${
                status.aberto
                  ? 'bg-mesa-success-50 text-mesa-success-700 dark:bg-mesa-success-500/15'
                  : 'bg-mesa-neutral-100 text-mesa-text-secondary dark:bg-mesa-neutral-700'
              }`}
            >
              <Icone nome={status.aberto ? 'check_circle' : 'schedule'} size={12} preenchido={status.aberto} />
              {status.texto}
            </span>
          )}
        </div>
      </div>

      {!busca.trim() && <CarrosselBanners banners={banners} />}

      {!busca.trim() && itensPopulares.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 px-6 text-base font-bold text-mesa-text-primary">Populares</h2>
          <div className="flex gap-3 overflow-x-auto px-6 pb-1">
            {itensPopulares.map((item) => (
              <CardItemHorizontal
                key={item.item_id}
                item={item}
                destaque={null}
                podeComprar={podeComprar}
                quantidadeNoCarrinho={carrinho[item.item_id] ?? 0}
                onAdicionar={() => adicionarAoCarrinho(item.item_id)}
                onRemover={() => alterarQuantidade(item.item_id, -1)}
              />
            ))}
          </div>
        </div>
      )}

      {!busca.trim() && itensMaisPedidos.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 px-6 text-base font-bold text-mesa-text-primary">Mais pedido</h2>
          <div className="flex gap-3 overflow-x-auto px-6 pb-1">
            {itensMaisPedidos.map((item, indice) => (
              <CardItemHorizontal
                key={item.item_id}
                item={item}
                destaque={indice === 0 ? 'top1' : 'popular'}
                podeComprar={podeComprar}
                quantidadeNoCarrinho={carrinho[item.item_id] ?? 0}
                onAdicionar={() => adicionarAoCarrinho(item.item_id)}
                onRemover={() => alterarQuantidade(item.item_id, -1)}
              />
            ))}
          </div>
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

      <div className="mt-4 flex flex-col gap-3 px-6 pb-24 md:grid md:grid-cols-2 md:items-start md:gap-4 xl:grid-cols-3">
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
                onRemover={() => alterarQuantidade(item.item_id, -1)}
              />
            )
          })
        )}
      </div>

      <div className="mt-8 flex flex-col items-center gap-1 text-center">
        <p className="font-mesa-sans text-sm font-semibold text-mesa-text-secondary">
          Sai aê um pastel, um açaí... o que você quiser
        </p>
        <p className="text-xs text-mesa-text-tertiary">Feito com Sai aê</p>
      </div>

      {totalItensCarrinho > 0 && !mostrarCheckout && (
        <div className="fixed inset-x-0 bottom-4 px-4 md:inset-x-auto md:left-1/2 md:w-full md:max-w-4xl md:-translate-x-1/2 md:px-6">
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
                      className="flex size-11 -m-1.5 items-center justify-center"
                    >
                      <span className="flex size-8 items-center justify-center rounded-mesa-full bg-mesa-neutral-100 text-mesa-text-primary dark:bg-mesa-neutral-700">
                        <Icone nome="remove" size={14} />
                      </span>
                    </button>
                    <span className="w-4 text-center text-sm font-semibold text-mesa-text-primary">
                      {quantidade}
                    </span>
                    <button
                      type="button"
                      aria-label={`Aumentar ${item.item_nome}`}
                      onClick={() => alterarQuantidade(item.item_id, 1)}
                      className="flex size-11 -m-1.5 items-center justify-center"
                    >
                      <span className="flex size-8 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
                        <Icone nome="add" size={14} />
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {modosPublicos.length > 1 && (
              <SegmentedControl
                aria-label="Tipo de atendimento"
                items={modosPublicos.map((modo) => ({ label: ROTULO_MODO[modo] }))}
                activeIndex={modosPublicos.indexOf(modoEfetivo)}
                onChange={(indice) => setModoConsumo(modosPublicos[indice])}
              />
            )}

            {modoEfetivo === 'mesa' && (
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

            {mostrarPagarNaEntrega && (
              <Button
                variant="outline"
                size="xl"
                icon={<Icone nome="two_wheeler" size={20} />}
                className="w-full"
                disabled={itensCarrinho.length === 0}
                onClick={() => {
                  aberturaCheckoutRef.current = Date.now()
                  setPagamento({ fase: 'dados_entrega' })
                }}
              >
                Pagar na entrega
              </Button>
            )}

            {entregaNoCardapio ? (
              // Pix com Entrega só chega na Story 2 (a cobrança precisa somar a taxa
              // no servidor): aqui NUNCA gera Pix de pedido de Entrega.
              podeComprar && (
                <p className="rounded-mesa-md bg-mesa-neutral-100 p-3 text-center text-sm font-medium text-mesa-text-secondary dark:bg-mesa-neutral-800">
                  Pix com entrega: em breve
                </p>
              )
            ) : podeComprar ? (
              <Button
                size="xl"
                icon={<Icone nome="qr_code" size={20} />}
                className="w-full"
                disabled={itensCarrinho.length === 0}
                onClick={pagar}
              >
                Pagar com Pix
              </Button>
            ) : (
              <Button
                size="xl"
                icon={<Icone nome="point_of_sale" size={20} />}
                className="w-full"
                disabled={itensCarrinho.length === 0}
                onClick={() => setMostrarAvisoBalcao(true)}
              >
                Finalizar no caixa
              </Button>
            )}
          </div>
        )}

        {(pagamento.fase === 'dados_entrega' || pagamento.fase === 'enviando_entrega') && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-mesa-text-primary">Pagar na entrega</h2>
            <p className="text-sm text-mesa-text-secondary">
              Seu pedido vai direto pra cozinha e você avisa a barraca pelo WhatsApp. O pagamento é
              combinado na entrega.
            </p>
            {/* Honeypot: fora da tela e fora da tabulação; só robô preenche. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
            <Input
              label="Seu nome"
              type="text"
              autoComplete="name"
              maxLength={60}
              value={nomeCliente}
              onChange={(e) => setNomeCliente(e.target.value)}
            />
            <Input
              label="Seu telefone (com DDD)"
              type="text"
              inputMode="tel"
              autoComplete="tel"
              value={telefoneCliente}
              onChange={(e) => setTelefoneCliente(e.target.value)}
            />
            {entregaNoCardapio ? (
              <>
                <Input
                  label="Rua"
                  type="text"
                  autoComplete="address-line1"
                  maxLength={100}
                  value={ruaCliente}
                  onChange={(e) => setRuaCliente(e.target.value)}
                />
                <div className="grid grid-cols-[96px_1fr] gap-3">
                  <Input
                    label="Número"
                    type="text"
                    autoComplete="off"
                    maxLength={20}
                    value={numeroCliente}
                    onChange={(e) => setNumeroCliente(e.target.value)}
                  />
                  {bairrosLista.length > 0 && !bairroOutro ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-mesa-text-secondary">Bairro</span>
                      <select
                        value={bairroCliente}
                        onChange={(e) => {
                          if (e.target.value === '__outro__') {
                            setBairroOutro(true)
                            setBairroCliente('')
                          } else {
                            setBairroCliente(e.target.value)
                          }
                        }}
                        className="h-12 w-full rounded-mesa-md border border-mesa-border-subtle bg-mesa-surface px-3 text-base text-mesa-text-primary"
                      >
                        <option value="">Escolha...</option>
                        {bairrosLista.map((b) => (
                          <option key={b.bairro} value={b.bairro}>
                            {b.bairro}
                          </option>
                        ))}
                        {!politicaBloqueia && <option value="__outro__">Outro bairro</option>}
                      </select>
                    </label>
                  ) : (
                    <Input
                      label="Bairro"
                      type="text"
                      autoComplete="off"
                      maxLength={80}
                      value={bairroCliente}
                      onChange={(e) => setBairroCliente(e.target.value)}
                    />
                  )}
                </div>
                <Input
                  label="Referência (opcional)"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  value={referenciaCliente}
                  onChange={(e) => setReferenciaCliente(e.target.value)}
                />
                {previaTaxa && !previaTaxa.permitido && (
                  <p role="alert" className="text-sm font-semibold text-mesa-error-700 dark:text-mesa-error-400">
                    Não entregamos nesse bairro.
                  </p>
                )}
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-mesa-text-secondary">
                  <Checkbox
                    checked={consentimento}
                    onChange={() => setConsentimento((v) => !v)}
                    aria-label="Autorizo o uso dos meus dados para a entrega"
                  />
                  <span>
                    Autorizo a barraca a guardar meu nome, telefone e endereço para entregar este pedido
                    e agilizar os próximos. Posso pedir a exclusão a qualquer momento.
                  </span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-mesa-text-secondary">
                  <Checkbox
                    checked={aceitaOfertas}
                    onChange={() => setAceitaOfertas((v) => !v)}
                    aria-label="Aceito receber ofertas e novidades desta loja por WhatsApp"
                  />
                  <span>
                    (Opcional) Aceito receber ofertas e novidades desta loja por WhatsApp. Posso parar de
                    receber quando quiser.
                  </span>
                </label>
              </>
            ) : (
              <Input
                label="Endereço de entrega (opcional)"
                type="text"
                autoComplete="street-address"
                maxLength={200}
                value={enderecoCliente}
                onChange={(e) => setEnderecoCliente(e.target.value)}
              />
            )}
            {pagamento.fase === 'dados_entrega' && pagamento.erro && (
              <p className="rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
                {pagamento.erro}
              </p>
            )}
            <div className="flex flex-col gap-1 border-t border-mesa-border-subtle pt-3">
              {entregaNoCardapio && (
                <>
                  <div className="flex items-center justify-between text-sm text-mesa-text-secondary">
                    <span>Itens</span>
                    <span>{formatarPrecoBR(totalCentavosCarrinho)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-mesa-text-secondary">
                    <span>Taxa de entrega</span>
                    <span>
                      {previaTaxa?.permitido
                        ? formatarPrecoBR(previaTaxa.taxaCentavos)
                        : previaTaxa
                          ? '—'
                          : 'definida pelo bairro'}
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-mesa-text-secondary">Total</span>
                <span className="font-mesa-display text-lg font-bold text-mesa-text-primary">
                  {formatarPrecoBR(totalCentavosCarrinho + (previaTaxa?.permitido ? previaTaxa.taxaCentavos : 0))}
                </span>
              </div>
              {entregaNoCardapio && (
                <p className="text-xs text-mesa-text-tertiary">
                  O valor final da taxa é confirmado pela barraca ao enviar o pedido.
                </p>
              )}
            </div>
            <Button
              size="xl"
              icon={<Icone nome="send" size={20} />}
              disabled={Boolean(entregaNoCardapio && previaTaxa && !previaTaxa.permitido)}
              className="w-full"
              loading={pagamento.fase === 'enviando_entrega'}
              onClick={enviarPedidoNaEntrega}
            >
              Enviar pedido
            </Button>
            <Button
              variant="ghost"
              size="md"
              className="w-full"
              disabled={pagamento.fase === 'enviando_entrega'}
              onClick={() => setPagamento({ fase: 'formulario' })}
            >
              Voltar
            </Button>
          </div>
        )}

        {pagamento.fase === 'entrega_enviada' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Icone nome="check_circle" size={40} className="text-mesa-success-500" />
            <h2 className="text-lg font-semibold text-mesa-text-primary">Pedido enviado!</h2>
            <p className="text-sm text-mesa-text-secondary">
              Seu pedido já foi pra cozinha.
              {pagamento.abriu
                ? ' Confirme o aviso no WhatsApp pra barraca saber que é você.'
                : ' Toque abaixo pra avisar a barraca no WhatsApp.'}
            </p>
            {pagamento.senha !== null && (
              <p className="font-mesa-display text-3xl font-black text-mesa-text-primary">
                Senha {String(pagamento.senha).padStart(3, '0')}
              </p>
            )}
            <a
              href={pagamento.urlWhatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-mesa-btn bg-mesa-orange-500 px-5 text-base font-bold text-mesa-neutral-900"
            >
              <Icone nome="chat" size={20} />
              {pagamento.abriu ? 'Abrir o WhatsApp de novo' : 'Avisar no WhatsApp'}
            </a>
            <Button variant="ghost" size="md" onClick={fecharCheckout} className="w-full">
              Fechar
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

      <BottomSheetFinalizarBalcao
        open={mostrarAvisoBalcao}
        onClose={() => setMostrarAvisoBalcao(false)}
        totalItens={totalItensCarrinho}
      />
    </div>
  )
}
