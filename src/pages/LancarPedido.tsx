import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useBarracaAtual, useSincronizacaoAtual } from '../layouts/contextoBarraca'
import { useTheme } from '../hooks/useTheme'
import { aoConcluirCriacaoPedido } from '../lib/fila'
import { formatarPrecoBR } from '../lib/preco'
import { tocarSomPedidoCriado } from '../lib/sons'
import { buscarIdsMaisPedidos } from '../lib/popularidade'
import type {
  Carrinho,
  EntregaDiretaPorItem,
  EstadoParaConfirmar,
  EstadoParaEditar,
  EstadoPedidoEnviado,
  ObservacaoPorItem,
} from '../lib/carrinho'
import { Badge } from '../components/ui/Badge'
import { BotaoHome } from '../components/ui/BotaoHome'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { Textarea } from '../components/ui/Textarea'
import type { Categoria, Item } from '../types/database'

type ModoConsumo = 'mesa' | 'balcao' | 'viagem'

type ModoVisualizacaoCardapio = 'lista' | 'grade'
const CHAVE_MODO_VISUALIZACAO = 'mesa-modo-visualizacao-cardapio'

function lerModoVisualizacaoSalvo(): ModoVisualizacaoCardapio {
  try {
    return window.localStorage.getItem(CHAVE_MODO_VISUALIZACAO) === 'grade' ? 'grade' : 'lista'
  } catch {
    return 'lista'
  }
}

const TEMPO_LIMITE_SENHA_MS = 15000

// valor null = pedido enfileirado, aguardando o servidor atribuir a senha
// real (nunca mostramos um número provisório que pode não bater com o
// definitivo — bug reportado em operação ao vivo, 2026-09-27). Exceção:
// entregaDireta=true nunca recebe senha (set_senha_pedido.sql pula a
// geração de propósito) — valor fica null pra sempre, não é "ainda
// aguardando" (bug corrigido em 2026-09-28: a tela ficava travada em
// "Gerando a senha..." pra sempre nesse caso).
type SenhaConfirmada = {
  valor: number | null
  idFila: string
  entregaDireta: boolean
}

/**
 * Círculo visível de 40×40 (compacto o bastante pra caber lado a lado
 * num grid de 2 colunas), mas a área clicável real é 44×44 via padding
 * transparente — mesmo padrão do botão de apagar em Ajustes.tsx. A cor
 * de fundo mora só no <span> interno; o <button> em si é transparente.
 */
function BotaoStepper({
  icone,
  onClick,
  rotulo,
}: {
  icone: string
  onClick: () => void
  rotulo: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="flex size-11 shrink-0 items-center justify-center outline-none"
    >
      <span className="flex size-10 items-center justify-center rounded-mesa-full bg-mesa-neutral-900 text-white transition-transform active:scale-90 dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900">
        <Icone nome={icone} size={16} />
      </span>
    </button>
  )
}

function CardItemCardapio({
  item,
  quantidade,
  observacao,
  posicaoPopular,
  onIncrementar,
  onDecrementar,
  onAbrirObservacao,
}: {
  item: Item
  quantidade: number
  observacao: string
  posicaoPopular: number | null
  onIncrementar: () => void
  onDecrementar: () => void
  onAbrirObservacao: () => void
}) {
  const selecionado = quantidade > 0

  return (
    <Card
      className={clsx(
        'flex gap-3 border-2',
        selecionado ? 'border-mesa-neutral-900 dark:border-mesa-neutral-50' : 'border-transparent',
      )}
    >
      <div className="relative shrink-0">
        {item.foto_url ? (
          <img src={item.foto_url} alt="" className="size-[72px] rounded-mesa-md object-cover" />
        ) : (
          <span className="flex size-[72px] items-center justify-center rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            <Icone nome="image" size={24} />
          </span>
        )}
        {posicaoPopular !== null && (
          <span className="absolute -left-1.5 -top-1.5 flex items-center gap-0.5 whitespace-nowrap rounded-mesa-balao bg-mesa-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-mesa-neutral-900 shadow-mesa-1">
            <Icone nome="star" size={10} preenchido />
            {posicaoPopular === 0 ? 'Top 1' : 'Popular'}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-base font-semibold text-mesa-text-primary">{item.nome}</p>
          <div className="shrink-0">
            {item.esgotado ? (
              <span className="text-xs font-medium text-mesa-text-tertiary">Esgotado</span>
            ) : selecionado ? (
              <div className="flex items-center gap-1 rounded-mesa-full bg-mesa-neutral-100 py-1 pr-1 dark:bg-mesa-neutral-800">
                <BotaoStepper icone="remove" onClick={onDecrementar} rotulo={`Remover uma unidade de ${item.nome}`} />
                <span className="min-w-[1.5ch] text-center font-mesa-display text-base font-bold text-mesa-text-primary">
                  {quantidade}
                </span>
                <BotaoStepper icone="add" onClick={onIncrementar} rotulo={`Adicionar uma unidade de ${item.nome}`} />
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                icon={<Icone nome="add" size={16} />}
                onClick={onIncrementar}
              >
                Adicionar
              </Button>
            )}
          </div>
        </div>

        {item.descricao && (
          <p className="mt-0.5 line-clamp-2 text-xs text-mesa-text-secondary">{item.descricao}</p>
        )}
        <p className="mt-1 font-mesa-display text-sm font-semibold text-mesa-text-primary">
          {item.preco_centavos > 0 ? formatarPrecoBR(item.preco_centavos) : 'Sem preço'}
        </p>

        {selecionado && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onAbrirObservacao}
              className="flex min-h-11 min-w-0 items-center gap-1 truncate text-xs font-medium text-mesa-text-secondary"
            >
              <Icone nome="description" size={14} />
              <span className="truncate">{observacao ? `Obs: ${observacao}` : 'Adicionar observação'}</span>
            </button>
            {item.preco_centavos > 0 && (
              <span className="shrink-0 font-mesa-display text-xs font-semibold text-mesa-text-primary">
                Total: {formatarPrecoBR(item.preco_centavos * quantidade)}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

/** Mesma informação do CardItemCardapio, só que compacto e em coluna —
 * pro operador que prefere ver mais itens de uma vez em vez de detalhe
 * (descrição, observação inline). Alternado via o botão de visualização. */
function CardItemCardapioGrade({
  item,
  quantidade,
  observacao,
  posicaoPopular,
  onIncrementar,
  onDecrementar,
  onAbrirObservacao,
}: {
  item: Item
  quantidade: number
  observacao: string
  posicaoPopular: number | null
  onIncrementar: () => void
  onDecrementar: () => void
  onAbrirObservacao: () => void
}) {
  const selecionado = quantidade > 0

  return (
    <Card
      className={clsx(
        'flex flex-col overflow-hidden border-2',
        selecionado ? 'border-mesa-neutral-900 dark:border-mesa-neutral-50' : 'border-transparent',
      )}
    >
      <div className="relative -mx-4 -mt-4 mb-3">
        {item.foto_url ? (
          <img
            src={item.foto_url}
            alt=""
            className="aspect-[4/3] w-[calc(100%+2rem)] rounded-t-mesa-md object-cover"
          />
        ) : (
          <span className="flex aspect-[4/3] w-[calc(100%+2rem)] items-center justify-center rounded-t-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            <Icone nome="image" size={24} />
          </span>
        )}
        {posicaoPopular !== null && (
          <span className="absolute left-2 top-2 flex items-center gap-0.5 whitespace-nowrap rounded-mesa-balao bg-mesa-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-mesa-neutral-900 shadow-mesa-1">
            <Icone nome="star" size={10} preenchido />
            {posicaoPopular === 0 ? 'Top 1' : 'Popular'}
          </span>
        )}
      </div>

      <p className="text-base font-semibold text-mesa-text-primary">{item.nome}</p>
      {item.descricao && (
        <p className="mt-0.5 line-clamp-2 text-xs text-mesa-text-secondary">{item.descricao}</p>
      )}
      <p className="mt-1 font-mesa-display text-sm font-semibold text-mesa-text-primary">
        {item.preco_centavos > 0 ? formatarPrecoBR(item.preco_centavos) : 'Sem preço'}
      </p>

      <div className="mt-3">
        {item.esgotado ? (
          <div className="flex h-11 items-center justify-center">
            <span className="text-xs font-medium text-mesa-text-tertiary">Esgotado</span>
          </div>
        ) : selecionado ? (
          <div className="flex items-center justify-center gap-1 rounded-mesa-full bg-mesa-neutral-100 py-1.5 dark:bg-mesa-neutral-800">
            <BotaoStepper icone="remove" onClick={onDecrementar} rotulo={`Remover uma unidade de ${item.nome}`} />
            <span className="min-w-[1.5ch] text-center font-mesa-display text-base font-bold text-mesa-text-primary">
              {quantidade}
            </span>
            <BotaoStepper icone="add" onClick={onIncrementar} rotulo={`Adicionar uma unidade de ${item.nome}`} />
          </div>
        ) : (
          <Button
            variant="outline"
            size="md"
            icon={<Icone nome="add" size={16} />}
            onClick={onIncrementar}
            className="w-full"
          >
            Adicionar
          </Button>
        )}
      </div>

      {selecionado && (
        <button
          type="button"
          onClick={onAbrirObservacao}
          className="mt-1 flex min-h-11 min-w-0 items-center gap-1 text-xs font-medium text-mesa-text-secondary"
        >
          <Icone nome="description" size={14} />
          <span className="truncate">{observacao ? `Obs: ${observacao}` : 'Adicionar observação'}</span>
        </button>
      )}
    </Card>
  )
}

function ehEstadoParaEditar(estado: unknown): estado is EstadoParaEditar {
  return typeof estado === 'object' && estado !== null && 'carrinho' in estado
}

function ehEstadoPedidoEnviado(estado: unknown): estado is EstadoPedidoEnviado {
  return typeof estado === 'object' && estado !== null && 'senhaEnviada' in estado
}

export function LancarPedido() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const location = useLocation()
  const { pendentes, online } = useSincronizacaoAtual()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  // Arrastar com o mouse em cima dos chips pra rolar a fileira, não só
  // pela scrollbar — touch já rola assim nativamente (por isso ignora
  // pointerType 'touch'). setPointerCapture só é chamado depois que o
  // movimento passa do limiar: chamar ele logo no pointerdown redireciona
  // até o clique pro container (bug do Chromium com pointer capture),
  // quebrando o clique normal nos chips mesmo sem arrastar de verdade.
  const chipsRef = useRef<HTMLDivElement>(null)
  const arrastoChipsRef = useRef({
    ativo: false,
    capturado: false,
    pointerId: 0,
    comecouEmX: 0,
    scrollInicial: 0,
    moveu: false,
  })

  function aoPressionarChips(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch') return
    const el = chipsRef.current
    if (!el) return
    arrastoChipsRef.current = {
      ativo: true,
      capturado: false,
      pointerId: e.pointerId,
      comecouEmX: e.clientX,
      scrollInicial: el.scrollLeft,
      moveu: false,
    }
  }

  function aoMoverChips(e: ReactPointerEvent<HTMLDivElement>) {
    const el = chipsRef.current
    const estado = arrastoChipsRef.current
    if (!el || !estado.ativo) return

    const delta = e.clientX - estado.comecouEmX
    if (!estado.moveu && Math.abs(delta) > 4) {
      estado.moveu = true
      estado.capturado = true
      el.setPointerCapture(estado.pointerId)
    }
    if (estado.moveu) el.scrollLeft = estado.scrollInicial - delta
  }

  function aoSoltarChips() {
    const estado = arrastoChipsRef.current
    if (estado.capturado) chipsRef.current?.releasePointerCapture(estado.pointerId)
    estado.ativo = false
  }

  function aoClicarChipsCapturando(e: ReactMouseEvent<HTMLDivElement>) {
    if (arrastoChipsRef.current.moveu) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // Estado recebido ao voltar de ConfirmarPedido ("Voltar e editar") ou
  // logo depois de um envio confirmado por lá — ver src/lib/carrinho.ts
  // pro contrato completo. Lido uma vez, nos inicializadores abaixo.
  const estadoRecebido = location.state as unknown
  const edicaoRecebida = ehEstadoParaEditar(estadoRecebido) ? estadoRecebido : null
  const envioRecebido = ehEstadoPedidoEnviado(estadoRecebido) ? estadoRecebido : null

  const [itens, setItens] = useState<Item[]>([])
  const [carregandoItens, setCarregandoItens] = useState(true)
  const [erroItens, setErroItens] = useState<string | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])

  const [carrinho, setCarrinho] = useState<Carrinho>(() => edicaoRecebida?.carrinho ?? {})
  const [mesa, setMesa] = useState(() => edicaoRecebida?.mesa ?? '')
  const [viagem, setViagem] = useState(() => edicaoRecebida?.viagem ?? false)
  // Só decide qual aba mostra marcada — mesa/viagem continuam sendo os
  // campos de verdade que vão pro pedido. "Balcão" e "Mesa vazia" resultam
  // no mesmo dado (mesa=null, viagem=false); essa aba só existe pra deixar
  // a intenção explícita em vez de o operador ter que "adivinhar" deixando
  // o campo em branco.
  const [modoConsumo, setModoConsumo] = useState<ModoConsumo>(() => {
    if (edicaoRecebida?.viagem) return 'viagem'
    if (edicaoRecebida?.mesa) return 'mesa'
    return 'balcao'
  })
  const [buscaItem, setBuscaItem] = useState('')
  const [modoVisualizacao, setModoVisualizacao] = useState<ModoVisualizacaoCardapio>(lerModoVisualizacaoSalvo)
  const [idsMaisPedidos, setIdsMaisPedidos] = useState<string[]>([])
  // null = ainda não decidiu qual chip abre selecionado (depende dos dados
  // chegarem — "Mais Pedidos" só faz sentido se existir pedido no
  // histórico, senão cai pra primeira categoria com item).
  const [filtroAtivo, setFiltroAtivo] = useState<string | null>(null)
  const [observacao, setObservacao] = useState(() => edicaoRecebida?.observacao ?? '')
  const [observacaoPorItem, setObservacaoPorItem] = useState<ObservacaoPorItem>(
    () => edicaoRecebida?.observacaoPorItem ?? {},
  )
  const [itemObservacaoAberta, setItemObservacaoAberta] = useState<Item | null>(null)
  // Não editável nesta tela — só guardado pra devolver pra ConfirmarPedido
  // intacto se o operador for e voltar sem mudar nada.
  const [entregaDiretaHerdada] = useState<EntregaDiretaPorItem>(
    () => edicaoRecebida?.entregaDireta ?? {},
  )

  const [senhaDemorando, setSenhaDemorando] = useState(false)
  const [senha, setSenha] = useState<SenhaConfirmada | null>(
    () => envioRecebido?.senhaEnviada ?? null,
  )

  // Limpa o state da entrada de histórico depois de consumido: sem isso,
  // um refresh de página bem depois (ex: já em "Novo pedido") ressuscita a
  // senha antiga ou o carrinho antigo, porque location.state sobrevive no
  // history entry até algo sobrescrever.
  useEffect(() => {
    if (estadoRecebido) navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toca só ao chegar nessa tela já com um pedido recém-enviado (state de
  // navegação vindo de ConfirmarPedido) — mount-only de propósito, senão
  // tocaria de novo quando `senha.valor` chega do servidor.
  useEffect(() => {
    if (senha !== null) tocarSomPedidoCriado()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelado = false
    setCarregandoItens(true)
    setErroItens(null)

    supabase
      .from('itens')
      .select('*')
      .eq('barraca_id', barraca.id)
      .eq('ativo', true)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setErroItens(error.message)
          setCarregandoItens(false)
          return
        }
        setItens((data ?? []) as Item[])
        setCarregandoItens(false)
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  useEffect(() => {
    let cancelado = false

    supabase
      .from('categorias')
      .select('*')
      .eq('barraca_id', barraca.id)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setCategorias((data ?? []) as Categoria[])
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  useEffect(() => {
    let cancelado = false
    buscarIdsMaisPedidos(barraca.id).then((ids) => {
      if (!cancelado) setIdsMaisPedidos(ids)
    })
    return () => {
      cancelado = true
    }
  }, [barraca.id])

  const itensPorCategoria = useMemo(() => {
    const mapa = new Map<string, Item[]>()
    const semCategoria: Item[] = []
    for (const item of itens) {
      if (item.categoria_id) {
        const lista = mapa.get(item.categoria_id) ?? []
        lista.push(item)
        mapa.set(item.categoria_id, lista)
      } else {
        semCategoria.push(item)
      }
    }
    if (semCategoria.length > 0) mapa.set('sem-categoria', semCategoria)
    return mapa
  }, [itens])

  const itensMaisPedidos = useMemo(
    () => idsMaisPedidos.map((id) => itens.find((i) => i.id === id)).filter((i): i is Item => Boolean(i)),
    [idsMaisPedidos, itens],
  )

  // Chips exibidos na fileira: "Mais Pedidos" (só se tiver histórico de
  // pedido) + uma por categoria com item ativo + "Outros" se sobrar item
  // sem categoria.
  const chipsCategoria = useMemo(() => {
    const chips: { id: string; nome: string; quantidade: number }[] = []
    for (const categoria of categorias) {
      const quantidade = itensPorCategoria.get(categoria.id)?.length ?? 0
      if (quantidade > 0) chips.push({ id: categoria.id, nome: categoria.nome, quantidade })
    }
    const semCategoria = itensPorCategoria.get('sem-categoria')?.length ?? 0
    if (semCategoria > 0) chips.push({ id: 'sem-categoria', nome: 'Outros', quantidade: semCategoria })
    return chips
  }, [categorias, itensPorCategoria])

  // Chip padrão antes do operador escolher algo: prioriza "Mais Pedidos" se
  // tiver histórico, senão a primeira categoria com item. Derivado direto do
  // dado em vez de sincronizado por efeito — `filtroAtivo` só existe de fato
  // depois que o operador clica em algum chip.
  const filtroEfetivo =
    filtroAtivo ?? (itensMaisPedidos.length > 0 ? 'mais-pedidos' : (chipsCategoria[0]?.id ?? null))

  const nomeSecaoAtiva =
    filtroEfetivo === 'todos'
      ? 'Todos os itens'
      : filtroEfetivo === 'mais-pedidos'
        ? 'Mais pedidos'
        : (chipsCategoria.find((c) => c.id === filtroEfetivo)?.nome ?? null)

  const itensFiltrados = useMemo(() => {
    const termo = buscaItem.trim().toLowerCase()
    // Busca por nome ignora o chip ativo de propósito — o operador digitando
    // um prato quer achar ele em qualquer categoria, não só na aberta.
    if (termo) return itens.filter((item) => item.nome.toLowerCase().includes(termo))
    if (filtroEfetivo === 'todos') return itens
    if (filtroEfetivo === 'mais-pedidos') return itensMaisPedidos
    if (filtroEfetivo) return itensPorCategoria.get(filtroEfetivo) ?? []
    return itens
  }, [itens, buscaItem, filtroEfetivo, itensMaisPedidos, itensPorCategoria])

  useEffect(() => {
    if (!senha || senha.valor !== null) return

    return aoConcluirCriacaoPedido(senha.idFila, (resultado) => {
      setSenha((atual) => (atual ? { ...atual, valor: resultado.senha } : atual))
    })
  }, [senha])

  useEffect(() => {
    if (!senha || senha.valor !== null || senha.entregaDireta) return

    const timer = window.setTimeout(() => setSenhaDemorando(true), TEMPO_LIMITE_SENHA_MS)
    return () => {
      window.clearTimeout(timer)
      setSenhaDemorando(false)
    }
  }, [senha])

  const totalItens = useMemo(
    () => Object.values(carrinho).reduce((soma, quantidade) => soma + quantidade, 0),
    [carrinho],
  )

  const totalCentavos = useMemo(
    () =>
      Object.entries(carrinho).reduce((soma, [itemId, quantidade]) => {
        const item = itens.find((i) => i.id === itemId)
        if (!item || item.preco_centavos <= 0) return soma
        return soma + item.preco_centavos * quantidade
      }, 0),
    [carrinho, itens],
  )

  const itensSemPreco = useMemo(
    () =>
      Object.entries(carrinho).filter(([itemId, quantidade]) => {
        if (quantidade <= 0) return false
        const item = itens.find((i) => i.id === itemId)
        return item !== undefined && item.preco_centavos <= 0
      }).length,
    [carrinho, itens],
  )

  function incrementar(itemId: string) {
    setCarrinho((atual) => ({ ...atual, [itemId]: (atual[itemId] ?? 0) + 1 }))
  }

  function decrementar(itemId: string) {
    setCarrinho((atual) => {
      const quantidadeAtual = atual[itemId] ?? 0
      if (quantidadeAtual <= 1) {
        const copia = { ...atual }
        delete copia[itemId]
        return copia
      }
      return { ...atual, [itemId]: quantidadeAtual - 1 }
    })
  }

  function limparFormulario() {
    setCarrinho({})
    setMesa('')
    setViagem(false)
    setModoConsumo('balcao')
    setObservacao('')
    setObservacaoPorItem({})
  }

  function selecionarModo(modo: ModoConsumo) {
    setModoConsumo(modo)
    setViagem(modo === 'viagem')
    if (modo === 'balcao') setMesa('')
  }

  function alternarModoVisualizacao() {
    setModoVisualizacao((atual) => {
      const novo: ModoVisualizacaoCardapio = atual === 'lista' ? 'grade' : 'lista'
      try {
        window.localStorage.setItem(CHAVE_MODO_VISUALIZACAO, novo)
      } catch {
        // localStorage indisponível — a escolha vale só pra essa sessão
      }
      return novo
    })
  }

  function definirObservacaoItem(itemId: string, texto: string) {
    setObservacaoPorItem((atual) => {
      if (!texto.trim()) {
        const copia = { ...atual }
        delete copia[itemId]
        return copia
      }
      return { ...atual, [itemId]: texto.trim() }
    })
  }

  function verNota() {
    if (totalItens === 0) return
    navigate(`/${barraca.slug}/confirmar`, {
      state: {
        carrinho,
        itens,
        mesa,
        viagem,
        observacao,
        entregaDireta: entregaDiretaHerdada,
        observacaoPorItem,
      } satisfies EstadoParaConfirmar,
    })
  }

  // Confirmação pós-envio: sem mockup de referência nesta fase (só a tela de
  // seleção de itens tem). Linguagem visual emprestada da Chamada (overline
  // da marca, número herói), mas com o glow atmosférico normal — essa tela é
  // pro operador, não pro balcão, não precisa do contraste absoluto da Chamada.
  if (senha !== null) {
    // entregaDireta nunca recebe senha (set_senha_pedido.sql pula a geração
    // de propósito) — precisa do próprio estado visual, senão fica preso em
    // "aguardando" pra sempre (valor null nunca deixa de ser null aqui).
    const aguardandoSenha = !senha.entregaDireta && senha.valor === null

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-mesa-orange-500">
          {barraca.nome}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-mesa-text-secondary">
          Pedido enviado
        </span>

        {senha.entregaDireta ? (
          <Icone
            nome="check_circle"
            size={80}
            preenchido
            className="text-mesa-success-700 dark:text-mesa-success-500"
          />
        ) : aguardandoSenha ? (
          <Icone
            nome="progress_activity"
            size={64}
            className="animate-spin text-mesa-text-tertiary"
          />
        ) : (
          <span className="text-[96px] font-bold leading-[104px] tracking-tight text-mesa-success-700 dark:text-mesa-success-500">
            {senha.valor}
          </span>
        )}

        {senha.entregaDireta ? (
          <span className="inline-flex items-center gap-2 rounded-mesa-balao bg-mesa-success-50 px-4 py-2 text-sm font-semibold text-mesa-success-700 dark:bg-mesa-success-500/15 dark:text-mesa-success-500">
            <Icone nome="local_shipping" size={16} />
            Entregue direto — sem senha, não passou pela cozinha
          </span>
        ) : aguardandoSenha ? (
          <span className="inline-flex items-center gap-2 rounded-mesa-balao bg-mesa-neutral-100 px-4 py-2 dark:bg-mesa-neutral-800">
            <span
              className="size-2 animate-pulse rounded-mesa-full bg-mesa-neutral-400"
              aria-hidden
            />
            <span className="text-sm font-medium text-mesa-text-secondary">
              {senhaDemorando
                ? 'Demorando mais que o normal — o pedido segue na fila e será enviado assim que a conexão permitir.'
                : 'Gerando a senha...'}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-mesa-balao bg-mesa-success-50 px-4 py-2 text-sm font-semibold text-mesa-success-700 dark:bg-mesa-success-500/15 dark:text-mesa-success-500">
            <Icone nome="check" size={16} />
            Enviado para a cozinha
          </span>
        )}

        <Button
          size="xl"
          onClick={() => {
            limparFormulario()
            setSenha(null)
          }}
          className="mt-4 w-full max-w-xs"
        >
          Novo pedido
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex items-start justify-between gap-3 px-6 pt-[calc(env(safe-area-inset-top)+20px)]">
        <div className="flex items-center gap-1">
          <BotaoHome />
          <h1 className="text-[32px] font-bold leading-[40px] text-mesa-text-primary">
            Lançar Pedido
          </h1>
        </div>
        <div className="flex shrink-0 items-start gap-2 pt-1">
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={online ? 'success' : 'warning'} dot>
              {online ? 'Online' : 'Offline'}
            </Badge>
            {pendentes > 0 && (
              <Badge variant="neutral">
                {pendentes} pendente{pendentes === 1 ? '' : 's'}
              </Badge>
            )}
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
      </div>

      {!online && (
        <p className="mx-6 mt-4 rounded-mesa-md border-l-[3px] border-mesa-orange-500 bg-mesa-orange-50 p-3 text-sm font-medium text-mesa-orange-700 dark:bg-mesa-orange-500/15 dark:text-mesa-orange-400">
          Sem conexão — os pedidos serão enviados quando a rede voltar
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-6 pb-40 pt-5 md:mx-auto md:w-full md:max-w-5xl">
        <Input
          type="search"
          value={buscaItem}
          onChange={(e) => setBuscaItem(e.target.value)}
          onClear={() => setBuscaItem('')}
          placeholder="Buscar item do cardápio"
          aria-label="Buscar item do cardápio"
        />

        <div className="mt-4">
          <SegmentedControl
            aria-label="Mesa, balcão ou viagem"
            items={[{ label: 'Mesa' }, { label: 'Balcão' }, { label: 'Viagem' }]}
            activeIndex={modoConsumo === 'mesa' ? 0 : modoConsumo === 'balcao' ? 1 : 2}
            onChange={(indice) => selecionarModo(indice === 0 ? 'mesa' : indice === 1 ? 'balcao' : 'viagem')}
          />
        </div>

        {modoConsumo === 'mesa' && (
          <Input
            value={mesa}
            onChange={(e) => setMesa(e.target.value)}
            placeholder="Número ou nome da mesa"
            aria-label="Mesa"
            className="mt-3"
            autoFocus
          />
        )}

        <div className="mt-6">
          {carregandoItens && (
            <p className="py-8 text-center text-sm text-mesa-text-secondary">
              Carregando cardápio...
            </p>
          )}

          {!carregandoItens && erroItens && (
            <p className="py-8 text-center text-sm text-mesa-error-500">
              Não foi possível carregar o cardápio.
            </p>
          )}

          {!carregandoItens && !erroItens && itens.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-mesa-xl border border-dashed border-mesa-border-default py-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-mesa-full bg-mesa-orange-50 text-mesa-orange-700 dark:bg-mesa-orange-500/15 dark:text-mesa-orange-400">
                <Icone nome="restaurant" size={28} />
              </span>
              <div className="px-6">
                <p className="text-base font-semibold text-mesa-text-primary">Seu cardápio está vazio</p>
                <p className="mt-1 text-sm text-mesa-text-secondary">
                  Cadastre os itens que sua barraca vende antes de lançar o primeiro pedido.
                </p>
              </div>
              <Button
                size="md"
                icon={<Icone nome="add" size={16} />}
                onClick={() => navigate(`/${barraca.slug}/ajustes`)}
              >
                Cadastrar itens em Ajustes
              </Button>
            </div>
          )}

          {!carregandoItens &&
            !erroItens &&
            itens.length > 0 &&
            !buscaItem.trim() &&
            (itensMaisPedidos.length > 0 || chipsCategoria.length > 0) && (
            <div
              ref={chipsRef}
              onPointerDown={aoPressionarChips}
              onPointerMove={aoMoverChips}
              onPointerUp={aoSoltarChips}
              onPointerLeave={aoSoltarChips}
              onClickCapture={aoClicarChipsCapturando}
              className="rolagem-sem-barra mb-4 flex cursor-grab gap-2 overflow-x-auto pb-1 active:cursor-grabbing"
            >
              <Chip
                variant={filtroEfetivo === 'todos' ? 'teal' : 'plain'}
                checked={filtroEfetivo === 'todos'}
                onClick={() => setFiltroAtivo('todos')}
                className="shrink-0"
              >
                Todos
              </Chip>
              {itensMaisPedidos.length > 0 && (
                <Chip
                  variant={filtroEfetivo === 'mais-pedidos' ? 'teal' : 'plain'}
                  checked={filtroEfetivo === 'mais-pedidos'}
                  onClick={() => setFiltroAtivo('mais-pedidos')}
                  className="shrink-0"
                >
                  <Icone nome="star" size={14} />
                  Mais Pedidos
                </Chip>
              )}
              {chipsCategoria.map((chip) => (
                <Chip
                  key={chip.id}
                  variant={filtroEfetivo === chip.id ? 'teal' : 'plain'}
                  checked={filtroEfetivo === chip.id}
                  onClick={() => setFiltroAtivo(chip.id)}
                  className="shrink-0"
                >
                  {chip.nome} · {chip.quantidade}
                </Chip>
              ))}
            </div>
            )}

          {!carregandoItens && !erroItens && !buscaItem.trim() && nomeSecaoAtiva && itensFiltrados.length > 0 && (
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
                <span className="size-1.5 shrink-0 rounded-mesa-full bg-current" aria-hidden />
                {nomeSecaoAtiva}
                <span className="text-mesa-text-tertiary">
                  · {itensFiltrados.length} {itensFiltrados.length === 1 ? 'item' : 'itens'}
                </span>
              </h2>
              <Button
                variant="outline"
                size="sm"
                icon={<Icone nome={modoVisualizacao === 'lista' ? 'grid_view' : 'list'} size={16} />}
                onClick={alternarModoVisualizacao}
                className="shrink-0"
                aria-label={
                  modoVisualizacao === 'lista'
                    ? 'Mudar para visualização em grade'
                    : 'Mudar para visualização em lista'
                }
              >
                {modoVisualizacao === 'lista' ? 'View' : 'Tiles'}
              </Button>
            </div>
          )}

          {!carregandoItens && !erroItens && itensFiltrados.length === 0 && itens.length > 0 && (
            <p className="py-8 text-center text-sm text-mesa-text-secondary">
              {buscaItem.trim() ? `Nenhum item encontrado pra "${buscaItem}".` : 'Nenhum item nesta categoria.'}
            </p>
          )}

          {!carregandoItens && !erroItens && itensFiltrados.length > 0 && modoVisualizacao === 'lista' && (
            <div className="flex flex-col gap-3">
              {itensFiltrados.map((item) => {
                const indicePopular = idsMaisPedidos.indexOf(item.id)
                return (
                  <CardItemCardapio
                    key={item.id}
                    item={item}
                    quantidade={carrinho[item.id] ?? 0}
                    observacao={observacaoPorItem[item.id] ?? ''}
                    posicaoPopular={indicePopular === -1 ? null : indicePopular}
                    onIncrementar={() => incrementar(item.id)}
                    onDecrementar={() => decrementar(item.id)}
                    onAbrirObservacao={() => setItemObservacaoAberta(item)}
                  />
                )
              })}
            </div>
          )}

          {!carregandoItens && !erroItens && itensFiltrados.length > 0 && modoVisualizacao === 'grade' && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
              {itensFiltrados.map((item) => {
                const indicePopular = idsMaisPedidos.indexOf(item.id)
                return (
                  <CardItemCardapioGrade
                    key={item.id}
                    item={item}
                    quantidade={carrinho[item.id] ?? 0}
                    observacao={observacaoPorItem[item.id] ?? ''}
                    posicaoPopular={indicePopular === -1 ? null : indicePopular}
                    onIncrementar={() => incrementar(item.id)}
                    onDecrementar={() => decrementar(item.id)}
                    onAbrirObservacao={() => setItemObservacaoAberta(item)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      {totalItens > 0 && (
        <div className="fixed inset-x-0 bottom-16 flex flex-col gap-2 px-4 pb-3 md:inset-x-auto md:left-1/2 md:w-full md:max-w-5xl md:-translate-x-1/2 md:px-6">
          {itensSemPreco > 0 && (
            <p className="text-center text-xs font-medium text-mesa-text-secondary">
              {itensSemPreco === 1 ? '1 item sem preço' : `${itensSemPreco} itens sem preço`}
            </p>
          )}

          <div className="overflow-hidden rounded-mesa-lg bg-mesa-neutral-900 shadow-mesa-3">
            <div className="flex justify-center border-b border-white/10">
              <button
                type="button"
                onClick={limparFormulario}
                className="min-h-11 px-4 text-sm font-medium text-white/70 outline-none transition-colors hover:text-white"
              >
                Limpar pedido
              </button>
            </div>

            <button
              type="button"
              onClick={verNota}
              className="flex w-full items-center justify-between gap-3 py-4 pl-5 pr-2 text-left text-white outline-none transition-transform active:scale-[0.99]"
            >
              <span>
                <span className="block text-sm text-white/80">
                  {totalItens} {totalItens === 1 ? 'item selecionado' : 'itens selecionados'}
                </span>
                <span className="block font-mesa-display text-2xl font-bold leading-tight">
                  {formatarPrecoBR(totalCentavos)}
                </span>
              </span>
              {/* Único elemento mostarda desta tela ("um primário por
                  tela") — tudo o mais nessa barra é tinta/branco. */}
              <span className="flex shrink-0 items-center gap-1.5 rounded-mesa-full bg-mesa-orange-500 px-4 py-2.5 text-sm font-semibold text-mesa-neutral-900 hover:bg-mesa-orange-400">
                Ver nota
                <Icone nome="arrow_forward" size={16} />
              </span>
            </button>
          </div>
        </div>
      )}

      <BottomSheet
        open={itemObservacaoAberta !== null}
        onClose={() => setItemObservacaoAberta(null)}
        aria-label="Observação do item"
      >
        {itemObservacaoAberta && (
          <ObservacaoItemForm
            item={itemObservacaoAberta}
            valorInicial={observacaoPorItem[itemObservacaoAberta.id] ?? ''}
            onSalvar={(texto) => {
              definirObservacaoItem(itemObservacaoAberta.id, texto)
              setItemObservacaoAberta(null)
            }}
          />
        )}
      </BottomSheet>
    </div>
  )
}

function ObservacaoItemForm({
  item,
  valorInicial,
  onSalvar,
}: {
  item: Item
  valorInicial: string
  onSalvar: (texto: string) => void
}) {
  const [texto, setTexto] = useState(valorInicial)

  return (
    <>
      <h2 className="text-lg font-semibold text-mesa-text-primary">Observação · {item.nome}</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Só pra esse item — restrição, ponto do prato, etc.
      </p>
      <Textarea
        autoFocus
        className="mt-4"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Ex.: sem cebola, alergia a amendoim"
        rows={3}
      />
      <Button size="xl" onClick={() => onSalvar(texto)} className="mt-4 w-full">
        Salvar
      </Button>
    </>
  )
}
