// TODO(produto): seção "Custo do dia" foi ao mockup mas ainda não
// é feature. Se virar requisito, adicionar entre Pagamento e
// Aparência.

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useAssinaturaBarraca } from '../hooks/useAssinaturaBarraca'
import { MSG_SEM_INTERNET, mensagemErroSalvar, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { centavosParaReais, reaisParaCentavos } from '../lib/preco'
import { apagarFotoItem, enviarFotoItem } from '../lib/fotoItem'
import { apagarLogoBarraca, enviarLogoBarraca } from '../lib/logoBarraca'
import { apagarCapaBarraca, enviarCapaBarraca } from '../lib/capaBarraca'
import { ativarFaceId, desativarFaceId, faceIdAtivado, faceIdSuportado } from '../lib/faceId'
import { urlPublica } from '../lib/urlPublica'
import { METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import { BPS_MAX, bpsParaPercentual, percentualParaBps } from '../lib/taxas'
import { ModalTrocarSenha } from '../components/ModalTrocarSenha'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { SecaoImpressora } from '../components/SecaoImpressora'
import { SecaoBanners } from '../components/SecaoBanners'
import { SecaoHorarioFuncionamento } from '../components/SecaoHorarioFuncionamento'
import { SecaoAjudaSuporte } from '../components/SecaoAjudaSuporte'
import { BotaoSalvarCampo, ErroSalvar } from '../components/BotaoSalvarCampo'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { Textarea } from '../components/ui/Textarea'
import { Toggle } from '../components/ui/Toggle'
import { BottomSheet } from '../components/ui/BottomSheet'
import type { AmbienteFiscal, Barraca, Categoria, Item, RegimeTributario } from '../types/database'

function textoPrecoInicial(centavos: number): string {
  return centavos > 0 ? centavosParaReais(centavos).toFixed(2).replace('.', ',') : ''
}

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function AvisoInline({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 flex items-start gap-2 rounded-mesa-md border-l-[3px] border-mesa-warning-500 bg-mesa-warning-50 p-3 text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15">
      <Icone nome="warning" size={16} className="mt-0.5" />
      {children}
    </p>
  )
}

/**
 * Glifo de 30×30 como no mockup, mas com alvo de toque de 44×44 —
 * a regra dos 44px do CLAUDE.md vale mesmo quando o ícone é pequeno.
 */
function BotaoApagar({ onClick, rotulo }: { onClick: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="group flex size-11 shrink-0 items-center justify-center outline-none"
    >
      <span className="flex size-[30px] items-center justify-center rounded-mesa-sm text-mesa-text-secondary transition-colors duration-[var(--mesa-duration-micro)] group-hover:bg-mesa-error-50 group-hover:text-mesa-error-700 group-focus-visible:[box-shadow:var(--mesa-focus-ring-danger)] dark:group-hover:bg-mesa-error-500/15 dark:group-hover:text-mesa-error-500">
        <Icone nome="delete" size={16} />
      </span>
    </button>
  )
}

function InputPreco({ item }: { item: Item }) {
  const { mostrarToast } = useToast()
  const [texto, setTexto] = useState(() => textoPrecoInicial(item.preco_centavos))
  const [textoSalvo, setTextoSalvo] = useState(texto)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const salvoTimerRef = useRef<number | null>(null)
  const alterado = texto !== textoSalvo

  useEffect(() => {
    return () => {
      if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
    }
  }, [])

  // Preço só é gravado quando o dono confirma (botão ✓ ou Enter) — antes era
  // auto-salvar com debounce e uma falha passava em silêncio.
  async function salvar() {
    if (!alterado || salvando) return
    if (navigator.onLine === false) {
      mostrarToast(MSG_SEM_INTERNET, { variante: 'aviso' })
      return
    }

    setSalvando(true)
    setSalvo(false)
    let mensagem: string | null = null
    try {
      const { data, error } = await supabase
        .from('itens')
        .update({ preco_centavos: reaisParaCentavos(texto) })
        .eq('id', item.id)
        .select('id')
      if (error) mensagem = mensagemErroSalvar(error)
      else if (!data || data.length === 0) mensagem = 'Não foi possível salvar: sem permissão para alterar este item.'
    } catch (e) {
      mensagem = mensagemErroSalvar(e instanceof Error ? e : null)
    }
    setSalvando(false)

    if (mensagem) {
      mostrarToast(mensagem, { variante: 'erro' })
      return
    }

    setTextoSalvo(texto)
    setSalvo(true)
    if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
    salvoTimerRef.current = window.setTimeout(() => setSalvo(false), 1500)
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Input
        type="currency"
        size="sm"
        inputMode="decimal"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value.replace(/[^d.,]/g, ''))
          setSalvo(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') salvar()
        }}
        placeholder="0,00"
        aria-label={`Preço de ${item.nome}`}
        className="w-28"
      />
      {alterado || salvando ? (
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label={`Salvar preço de ${item.nome}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-mesa-md border-[1.5px] border-mesa-neutral-900 text-mesa-neutral-900 outline-none transition-colors hover:bg-[var(--mesa-state-hover-bg)] disabled:opacity-40 dark:border-mesa-neutral-50 dark:text-mesa-neutral-50"
        >
          <Icone nome={salvando ? 'progress_activity' : 'check'} size={18} />
        </button>
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center">
          {salvo && <Icone nome="check" size={16} className="text-mesa-success-700 dark:text-mesa-success-500" aria-label="Salvo" />}
        </span>
      )}
    </div>
  )
}

function MiniaturaItem({
  fotoUrl,
  onClick,
  rotulo,
  tamanho = 'md',
}: {
  fotoUrl: string | null
  onClick: () => void
  rotulo: string
  tamanho?: 'md' | 'lg'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className={clsx(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary outline-none focus-visible:[box-shadow:var(--mesa-focus-ring-primary)] dark:bg-mesa-neutral-700',
        tamanho === 'lg' ? 'size-14' : 'size-11',
      )}
    >
      {fotoUrl ? (
        <img src={fotoUrl} alt="" className="size-full object-cover" />
      ) : (
        <Icone nome="image" size={tamanho === 'lg' ? 24 : 16} />
      )}
    </button>
  )
}

function BottomSheetDetalhesItem({
  item,
  barracaId,
  onClose,
  onSalvo,
}: {
  item: Item | null
  barracaId: string
  onClose: () => void
  onSalvo: (itemId: string, alteracoes: Partial<Item>) => void
}) {
  const [descricao, setDescricao] = useState(() => item?.descricao ?? '')
  const [fotoUrl, setFotoUrl] = useState<string | null>(() => item?.foto_url ?? null)
  const [ncm, setNcm] = useState(() => item?.ncm ?? '')
  const [cfop, setCfop] = useState(() => item?.cfop ?? '')
  const [unidadeComercial, setUnidadeComercial] = useState(() => item?.unidade_comercial ?? '')
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)

  if (!item) return null

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo || !item) return

    setEnviandoFoto(true)
    setErro(null)

    try {
      const urlAntiga = fotoUrl
      const novaUrl = await enviarFotoItem(barracaId, item.id, arquivo)
      setFotoUrl(novaUrl)
      if (urlAntiga) apagarFotoItem(urlAntiga)
    } catch {
      setErro('Não foi possível enviar a foto. Tente novamente.')
    }

    setEnviandoFoto(false)
  }

  function removerFoto() {
    if (fotoUrl) apagarFotoItem(fotoUrl)
    setFotoUrl(null)
    setErro(null)
  }

  async function salvar() {
    if (!item) return
    setSalvando(true)
    setErro(null)

    const alteracoes = {
      foto_url: fotoUrl,
      descricao: descricao.trim() || null,
      ncm: ncm.trim() || null,
      cfop: cfop.trim() || null,
      unidade_comercial: unidadeComercial.trim() || null,
    }
    const { error } = await supabase.from('itens').update(alteracoes).eq('id', item.id)

    setSalvando(false)

    if (error) {
      setErro('Não foi possível salvar. Tente novamente.')
      return
    }

    onSalvo(item.id, alteracoes)
    onClose()
  }

  return (
    <BottomSheet open={!!item} onClose={onClose} aria-label={`Detalhes de ${item.nome}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">{item.nome}</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Foto e descrição aparecem pro operador em Lançar Pedido.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            {fotoUrl ? (
              <img src={fotoUrl} alt="" className="size-full object-cover" />
            ) : (
              <Icone nome="image" size={24} />
            )}
          </span>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="photo_camera" size={16} />}
              loading={enviandoFoto}
              onClick={() => inputArquivoRef.current?.click()}
            >
              {fotoUrl ? 'Trocar foto' : 'Adicionar foto'}
            </Button>
            {fotoUrl && (
              <Button
                variant="textDanger"
                size="sm"
                icon={<Icone nome="delete" size={16} />}
                onClick={removerFoto}
              >
                Remover foto
              </Button>
            )}
          </div>
          <input
            ref={inputArquivoRef}
            type="file"
            accept="image/*"
            onChange={aoEscolherArquivo}
            className="hidden"
          />
        </div>

        <Textarea
          label="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ingredientes, tamanho, o que vem no prato..."
          rows={3}
        />

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mesa-text-secondary">
            Dados fiscais (opcional, pra emissão de nota)
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              label="NCM"
              size="sm"
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="Ex.: 21069090"
              className="w-32"
            />
            <Input
              label="CFOP"
              size="sm"
              value={cfop}
              onChange={(e) => setCfop(e.target.value)}
              placeholder="Ex.: 5101"
              className="w-28"
            />
            <Input
              label="Unidade"
              size="sm"
              value={unidadeComercial}
              onChange={(e) => setUnidadeComercial(e.target.value)}
              placeholder="Ex.: un"
              className="w-24"
            />
          </div>
        </div>

        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button
          size="xl"
          icon={<Icone nome="check" size={20} />}
          loading={salvando}
          onClick={salvar}
          className="w-full"
        >
          Salvar
        </Button>
      </div>
    </BottomSheet>
  )
}

function SecaoCardapio({ barracaId }: { barracaId: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [criandoItem, setCriandoItem] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoPreco, setNovoPreco] = useState('')
  const [salvandoNovo, setSalvandoNovo] = useState(false)

  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nomeEdicao, setNomeEdicao] = useState('')

  const [itemDetalhes, setItemDetalhes] = useState<Item | null>(null)

  const [itemParaExcluir, setItemParaExcluir] = useState<Item | null>(null)
  const [nomeExclusao, setNomeExclusao] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const { mostrarToast } = useToast()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [novaCategoriaId, setNovaCategoriaId] = useState<string | null>(null)
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false)
  const [itemEscolhendoCategoria, setItemEscolhendoCategoria] = useState<Item | 'novo' | null>(
    null,
  )
  const [novaCategoriaNome, setNovaCategoriaNome] = useState('')
  const [criandoCategoria, setCriandoCategoria] = useState(false)
  const [editandoCategoriaId, setEditandoCategoriaId] = useState<string | null>(null)
  const [nomeEdicaoCategoria, setNomeEdicaoCategoria] = useState('')

  const arrastandoIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelado = false

    supabase
      .from('itens')
      .select('*')
      .eq('barraca_id', barracaId)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) setErro(error.message)
        else setItens((data ?? []) as Item[])
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  useEffect(() => {
    let cancelado = false

    supabase
      .from('categorias')
      .select('*')
      .eq('barraca_id', barracaId)
      .order('ordem')
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setCategorias((data ?? []) as Categoria[])
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  function nomeCategoria(categoriaId: string | null): string {
    if (!categoriaId) return 'Sem categoria'
    return categorias.find((c) => c.id === categoriaId)?.nome ?? 'Sem categoria'
  }

  async function criarCategoria() {
    const nome = novaCategoriaNome.trim()
    if (!nome) return

    setCriandoCategoria(true)
    const proximaOrdem =
      categorias.length > 0 ? Math.max(...categorias.map((c) => c.ordem)) + 1 : 1

    const { data, error } = await supabase
      .from('categorias')
      .insert({ barraca_id: barracaId, nome, ordem: proximaOrdem })
      .select()
      .single()

    setCriandoCategoria(false)

    if (!error && data) {
      setCategorias((atual) => [...atual, data as Categoria])
      setNovaCategoriaNome('')
    }
  }

  // Quando um update otimista falha e o estado volta atrás, o dono precisa
  // saber — antes voltava em silêncio e parecia que nada tinha acontecido.
  function avisarFalha(error: { message?: string }) {
    const mensagem = mensagemErroSalvar(error)
    mostrarToast(mensagem, { variante: mensagem === MSG_SEM_INTERNET ? 'aviso' : 'erro' })
  }

  function iniciarEdicaoCategoria(categoria: Categoria) {
    setEditandoCategoriaId(categoria.id)
    setNomeEdicaoCategoria(categoria.nome)
  }

  async function salvarEdicaoCategoria(categoria: Categoria) {
    const nome = nomeEdicaoCategoria.trim()
    setEditandoCategoriaId(null)
    if (!nome || nome === categoria.nome) return

    setCategorias((atual) => atual.map((c) => (c.id === categoria.id ? { ...c, nome } : c)))
    const { error } = await supabase.from('categorias').update({ nome }).eq('id', categoria.id)

    if (error) {
      avisarFalha(error)
      setCategorias((atual) =>
        atual.map((c) => (c.id === categoria.id ? { ...c, nome: categoria.nome } : c)),
      )
    }
  }

  function moverCategoria(id: string, direcao: -1 | 1) {
    const indice = categorias.findIndex((c) => c.id === id)
    const novoIndice = indice + direcao
    if (indice === -1 || novoIndice < 0 || novoIndice >= categorias.length) return

    const copia = [...categorias]
    const [categoria] = copia.splice(indice, 1)
    copia.splice(novoIndice, 0, categoria)

    const comOrdem = copia.map((c, i) => ({ ...c, ordem: i + 1 }))
    setCategorias(comOrdem)
    Promise.all(
      comOrdem.map((c, i) => supabase.from('categorias').update({ ordem: i + 1 }).eq('id', c.id)),
    )
  }

  async function excluirCategoria(categoria: Categoria) {
    setCategorias((atual) => atual.filter((c) => c.id !== categoria.id))
    setItens((atual) =>
      atual.map((i) => (i.categoria_id === categoria.id ? { ...i, categoria_id: null } : i)),
    )
    await supabase.from('categorias').delete().eq('id', categoria.id)
  }

  async function escolherCategoria(categoriaId: string | null) {
    const alvo = itemEscolhendoCategoria
    setItemEscolhendoCategoria(null)
    if (!alvo) return

    if (alvo === 'novo') {
      setNovaCategoriaId(categoriaId)
      return
    }

    setItens((atual) =>
      atual.map((i) => (i.id === alvo.id ? { ...i, categoria_id: categoriaId } : i)),
    )
    const { error } = await supabase
      .from('itens')
      .update({ categoria_id: categoriaId })
      .eq('id', alvo.id)

    if (error) {
      avisarFalha(error)
      setItens((atual) =>
        atual.map((i) => (i.id === alvo.id ? { ...i, categoria_id: alvo.categoria_id } : i)),
      )
    }
  }

  async function persistirOrdem(lista: Item[]) {
    await Promise.all(
      lista.map((item, indice) =>
        supabase.from('itens').update({ ordem: indice + 1 }).eq('id', item.id),
      ),
    )
  }

  function moverItem(id: string, direcao: -1 | 1) {
    const indice = itens.findIndex((i) => i.id === id)
    const novoIndice = indice + direcao
    if (indice === -1 || novoIndice < 0 || novoIndice >= itens.length) return

    const copia = [...itens]
    const [item] = copia.splice(indice, 1)
    copia.splice(novoIndice, 0, item)

    const comOrdem = copia.map((it, i) => ({ ...it, ordem: i + 1 }))
    setItens(comOrdem)
    persistirOrdem(comOrdem)
  }

  function aoSoltar(idAlvo: string) {
    const idOrigem = arrastandoIdRef.current
    arrastandoIdRef.current = null
    if (!idOrigem || idOrigem === idAlvo) return

    const indiceOrigem = itens.findIndex((i) => i.id === idOrigem)
    const indiceAlvo = itens.findIndex((i) => i.id === idAlvo)
    if (indiceOrigem === -1 || indiceAlvo === -1) return

    const copia = [...itens]
    const [movido] = copia.splice(indiceOrigem, 1)
    copia.splice(indiceAlvo, 0, movido)

    const comOrdem = copia.map((item, i) => ({ ...item, ordem: i + 1 }))
    setItens(comOrdem)
    persistirOrdem(comOrdem)
  }

  async function criarItem() {
    const nome = novoNome.trim()
    if (!nome) return

    setSalvandoNovo(true)
    const proximaOrdem = itens.length > 0 ? Math.max(...itens.map((i) => i.ordem)) + 1 : 1
    const precoCentavos = reaisParaCentavos(novoPreco)

    const { data, error } = await supabase
      .from('itens')
      .insert({
        barraca_id: barracaId,
        nome,
        ativo: true,
        ordem: proximaOrdem,
        preco_centavos: precoCentavos,
        categoria_id: novaCategoriaId,
      })
      .select()
      .single()

    setSalvandoNovo(false)

    if (!error && data) {
      setItens((atual) => [...atual, data as Item])
      setNovoNome('')
      setNovoPreco('')
      setNovaCategoriaId(null)
      setCriandoItem(false)
    }
  }

  function iniciarEdicao(item: Item) {
    setEditandoId(item.id)
    setNomeEdicao(item.nome)
  }

  async function salvarEdicao(item: Item) {
    const nome = nomeEdicao.trim()
    setEditandoId(null)
    if (!nome || nome === item.nome) return

    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, nome } : i)))
    const { error } = await supabase.from('itens').update({ nome }).eq('id', item.id)

    if (error) {
      avisarFalha(error)
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, nome: item.nome } : i)))
    }
  }

  async function alternarAtivo(item: Item) {
    const novoAtivo = !item.ativo
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, ativo: novoAtivo } : i)))
    const { error } = await supabase.from('itens').update({ ativo: novoAtivo }).eq('id', item.id)

    if (error) {
      avisarFalha(error)
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, ativo: item.ativo } : i)))
    }
  }

  async function alternarEsgotado(item: Item) {
    const novoEsgotado = !item.esgotado
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, esgotado: novoEsgotado } : i)))
    const { error } = await supabase.from('itens').update({ esgotado: novoEsgotado }).eq('id', item.id)

    if (error) {
      avisarFalha(error)
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, esgotado: item.esgotado } : i)))
    }
  }

  // "Populares" no cardápio digital é curadoria manual do dono (decisão de
  // produto 2026-09-27) — diferente de "Mais pedido", que é algorítmico
  // (pedidos_30d). Mesmo padrão de toggle que esgotado/ativo.
  async function alternarPopular(item: Item) {
    const novoPopular = !item.popular
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, popular: novoPopular } : i)))
    const { error } = await supabase.from('itens').update({ popular: novoPopular }).eq('id', item.id)

    if (error) {
      avisarFalha(error)
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, popular: item.popular } : i)))
    }
  }

  function pedirExclusao(item: Item) {
    setItemParaExcluir(item)
    setNomeExclusao(item.nome)
  }

  // Comportamento preservado: tenta DELETE de verdade e só cai para
  // ativo:false quando o banco recusa (item já usado em pedidos).
  async function confirmarExclusao() {
    if (!itemParaExcluir) return
    const item = itemParaExcluir
    setExcluindo(true)

    const { error } = await supabase.from('itens').delete().eq('id', item.id)

    if (!error) {
      setItens((atual) => atual.filter((i) => i.id !== item.id))
      setExcluindo(false)
      setItemParaExcluir(null)
      return
    }

    const { error: erroDesativar } = await supabase
      .from('itens')
      .update({ ativo: false })
      .eq('id', item.id)

    if (!erroDesativar) {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, ativo: false } : i)))
      setAviso(`"${item.nome}" já foi usado em pedidos e não pode ser excluído — foi desativado.`)
    }

    setExcluindo(false)
    setItemParaExcluir(null)
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <RotuloSecao icone="restaurant">Cardápio</RotuloSecao>
        <Button
          variant="outline"
          size="sm"
          icon={<Icone nome="category" size={16} />}
          onClick={() => setGerenciandoCategorias(true)}
        >
          Categorias
        </Button>
      </div>
      <Card>
        {carregando && <p className="text-sm text-mesa-text-secondary">Carregando...</p>}
        {!carregando && erro && (
          <p className="text-sm text-mesa-error-500">Não foi possível carregar os itens.</p>
        )}

        {!carregando && !erro && (
          <>
            {aviso && <AvisoInline>{aviso}</AvisoInline>}

            {itens.length === 0 && (
              <p className="text-sm text-mesa-text-secondary">Nenhum item cadastrado.</p>
            )}

            <ul className="divide-y divide-mesa-border-subtle">
              {itens.map((item, indice) => (
                <li
                  key={item.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => aoSoltar(item.id)}
                  className={`flex flex-col gap-2 py-3 ${item.ativo ? '' : 'opacity-50'}`}
                >
                  <div className="flex gap-3">
                    <MiniaturaItem
                      fotoUrl={item.foto_url}
                      onClick={() => setItemDetalhes(item)}
                      rotulo={`Foto e descrição de ${item.nome}`}
                      tamanho="lg"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5">
                          {editandoId === item.id ? (
                            <Input
                              autoFocus
                              size="sm"
                              value={nomeEdicao}
                              onChange={(e) => setNomeEdicao(e.target.value)}
                              onBlur={() => salvarEdicao(item)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                if (e.key === 'Escape') setEditandoId(null)
                              }}
                              aria-label={`Nome do item ${item.nome}`}
                              className="min-w-0 flex-1"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => iniciarEdicao(item)}
                              className="min-h-11 min-w-0 truncate text-left text-base font-semibold text-mesa-text-primary"
                            >
                              {item.nome}
                            </button>
                          )}
                          <Chip
                            variant="plain"
                            onClick={() => setItemEscolhendoCategoria(item)}
                            aria-label={`Categoria de ${item.nome}: ${nomeCategoria(item.categoria_id)}`}
                          >
                            {nomeCategoria(item.categoria_id)}
                          </Chip>
                        </div>

                        <div className="flex shrink-0 flex-col">
                          <button
                            type="button"
                            onClick={() => moverItem(item.id, -1)}
                            disabled={indice === 0}
                            aria-label={`Mover ${item.nome} para cima`}
                            className="flex h-[22px] w-8 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => moverItem(item.id, 1)}
                            disabled={indice === itens.length - 1}
                            aria-label={`Mover ${item.nome} para baixo`}
                            className="flex h-[22px] w-8 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
                          >
                            ▼
                          </button>
                        </div>
                      </div>

                      {item.descricao && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-mesa-text-secondary">
                          {item.descricao}
                        </p>
                      )}

                      <div className="mt-1.5">
                        <InputPreco item={item} />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setItemDetalhes(item)}
                      className="flex min-h-11 items-center gap-1 whitespace-nowrap text-xs font-medium text-mesa-text-primary"
                    >
                      <Icone nome="edit" size={14} />
                      Editar Foto & Info
                    </button>

                    <span className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                      <span
                        draggable
                        onDragStart={() => {
                          arrastandoIdRef.current = item.id
                        }}
                        aria-hidden
                        className="hidden cursor-grab select-none px-1 text-base text-mesa-text-tertiary sm:inline"
                      >
                        ⠿
                      </span>
                      <span className="text-xs text-mesa-text-secondary">Popular</span>
                      <Toggle
                        checked={item.popular}
                        onChange={() => alternarPopular(item)}
                        aria-label={`${item.nome} em Populares no cardápio digital`}
                      />
                      <span className="text-xs text-mesa-text-secondary">Esgotado</span>
                      <Toggle
                        checked={item.esgotado}
                        onChange={() => alternarEsgotado(item)}
                        aria-label={`${item.nome} esgotado`}
                      />
                      <span className="text-xs text-mesa-text-secondary">
                        {item.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      <Toggle
                        checked={item.ativo}
                        onChange={() => alternarAtivo(item)}
                        aria-label={`${item.nome} ativo no cardápio`}
                      />
                      <BotaoApagar onClick={() => pedirExclusao(item)} rotulo={`Apagar ${item.nome}`} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {criandoItem ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Input
                  autoFocus
                  size="sm"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && criarItem()}
                  placeholder="Nome do item"
                  aria-label="Nome do novo item"
                  className="min-w-0 flex-1"
                />
                <Input
                  type="currency"
                  size="sm"
                  inputMode="decimal"
                  value={novoPreco}
                  onChange={(e) => setNovoPreco(e.target.value.replace(/[^\d.,]/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && criarItem()}
                  placeholder="0,00"
                  aria-label="Preço do novo item"
                  className="w-28"
                />
                <Chip
                  variant="plain"
                  onClick={() => setItemEscolhendoCategoria('novo')}
                  aria-label={`Categoria do novo item: ${nomeCategoria(novaCategoriaId)}`}
                >
                  {nomeCategoria(novaCategoriaId)}
                </Chip>
                <Button
                  size="sm"
                  onClick={criarItem}
                  disabled={!novoNome.trim()}
                  loading={salvandoNovo}
                >
                  Adicionar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCriandoItem(false)
                    setNovoNome('')
                    setNovoPreco('')
                    setNovaCategoriaId(null)
                  }}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="md"
                icon={<Icone nome="add" size={16} />}
                onClick={() => setCriandoItem(true)}
                className="mt-2 w-full"
              >
                Novo item
              </Button>
            )}
          </>
        )}
      </Card>

      <BottomSheetDetalhesItem
        key={itemDetalhes?.id ?? 'fechado'}
        item={itemDetalhes}
        barracaId={barracaId}
        onClose={() => setItemDetalhes(null)}
        onSalvo={(itemId, alteracoes) =>
          setItens((atual) => atual.map((i) => (i.id === itemId ? { ...i, ...alteracoes } : i)))
        }
      />

      <BottomSheet
        open={itemParaExcluir !== null}
        onClose={() => setItemParaExcluir(null)}
        aria-label="Confirmar exclusão de item"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Apagar {nomeExclusao}?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">Essa ação não pode ser desfeita.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="xl"
            loading={excluindo}
            onClick={confirmarExclusao}
            className="w-full"
          >
            Apagar
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setItemParaExcluir(null)}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={itemEscolhendoCategoria !== null}
        onClose={() => setItemEscolhendoCategoria(null)}
        aria-label="Selecionar categoria"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Categoria</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip
            variant={
              (itemEscolhendoCategoria === 'novo'
                ? novaCategoriaId
                : (itemEscolhendoCategoria?.categoria_id ?? null)) === null
                ? 'teal'
                : 'plain'
            }
            checked={
              (itemEscolhendoCategoria === 'novo'
                ? novaCategoriaId
                : (itemEscolhendoCategoria?.categoria_id ?? null)) === null
            }
            onClick={() => escolherCategoria(null)}
          >
            Sem categoria
          </Chip>
          {categorias.map((categoria) => {
            const atual =
              itemEscolhendoCategoria === 'novo'
                ? novaCategoriaId
                : (itemEscolhendoCategoria?.categoria_id ?? null)
            return (
              <Chip
                key={categoria.id}
                variant={atual === categoria.id ? 'teal' : 'plain'}
                checked={atual === categoria.id}
                onClick={() => escolherCategoria(categoria.id)}
              >
                {categoria.nome}
              </Chip>
            )
          })}
        </div>
        {categorias.length === 0 && (
          <p className="mt-3 text-sm text-mesa-text-secondary">
            Nenhuma categoria ainda. Toque em "Categorias" no topo do cardápio pra criar uma.
          </p>
        )}
        <Button
          variant="ghost"
          size="md"
          onClick={() => setItemEscolhendoCategoria(null)}
          className="mt-6 w-full"
        >
          Fechar
        </Button>
      </BottomSheet>

      <BottomSheet
        open={gerenciandoCategorias}
        onClose={() => setGerenciandoCategorias(false)}
        aria-label="Gerenciar categorias"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Categorias</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Agrupe os itens do cardápio pra facilitar quem lança o pedido.
        </p>

        {categorias.length === 0 && (
          <p className="mt-4 text-sm text-mesa-text-secondary">Nenhuma categoria cadastrada.</p>
        )}

        <ul className="mt-3 divide-y divide-mesa-border-subtle">
          {categorias.map((categoria, indice) => (
            <li key={categoria.id} className="flex items-center gap-2 py-2">
              {editandoCategoriaId === categoria.id ? (
                <Input
                  autoFocus
                  size="sm"
                  value={nomeEdicaoCategoria}
                  onChange={(e) => setNomeEdicaoCategoria(e.target.value)}
                  onBlur={() => salvarEdicaoCategoria(categoria)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditandoCategoriaId(null)
                  }}
                  aria-label={`Nome da categoria ${categoria.nome}`}
                  className="min-w-0 flex-1"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => iniciarEdicaoCategoria(categoria)}
                  className="min-h-11 min-w-0 flex-1 truncate text-left text-base text-mesa-text-primary"
                >
                  {categoria.nome}
                </button>
              )}

              <button
                type="button"
                onClick={() => moverCategoria(categoria.id, -1)}
                disabled={indice === 0}
                aria-label={`Mover ${categoria.nome} para cima`}
                className="flex h-11 w-8 shrink-0 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moverCategoria(categoria.id, 1)}
                disabled={indice === categorias.length - 1}
                aria-label={`Mover ${categoria.nome} para baixo`}
                className="flex h-11 w-8 shrink-0 items-center justify-center text-sm text-mesa-text-tertiary disabled:opacity-30"
              >
                ▼
              </button>
              <BotaoApagar onClick={() => excluirCategoria(categoria)} rotulo={`Apagar ${categoria.nome}`} />
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            value={novaCategoriaNome}
            onChange={(e) => setNovaCategoriaNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && criarCategoria()}
            placeholder="Nova categoria"
            aria-label="Nome da nova categoria"
            className="min-w-0 flex-1"
          />
          <Button
            size="sm"
            onClick={criarCategoria}
            disabled={!novaCategoriaNome.trim()}
            loading={criandoCategoria}
          >
            Adicionar
          </Button>
        </div>

        <Button
          variant="ghost"
          size="md"
          onClick={() => setGerenciandoCategorias(false)}
          className="mt-6 w-full"
        >
          Fechar
        </Button>
      </BottomSheet>
    </section>
  )
}

/** Nome e logo da barraca — sempre existiu a coluna logo_url, mas nunca
 * teve como fazer upload de verdade, só setando direto no banco. Mesmo
 * padrão de foto+resize do cardápio (lib/fotoItem.ts), bucket próprio
 * (lib/logoBarraca.ts) porque o dono do upload é a barraca, não um item. */
function SecaoIdentidade({ barraca }: { barraca: Barraca }) {
  const nomeR = useRascunho(barraca.nome)
  const logoR = useRascunho<string | null>(barraca.logo_url)
  const capaR = useRascunho<string | null>(barraca.imagem_capa_url)
  const logoUrl = logoR.valor
  const capaUrl = capaR.valor
  const [enviandoLogo, setEnviandoLogo] = useState(false)
  const [enviandoCapa, setEnviandoCapa] = useState(false)
  const [erroUpload, setErroUpload] = useState<string | null>(null)
  const { salvar: salvarBarraca, salvando, salvo, erro } = useSalvarBarraca(barraca)
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const inputCapaRef = useRef<HTMLInputElement>(null)
  const alterado = nomeR.alterado || logoR.alterado || capaR.alterado

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return

    setEnviandoLogo(true)
    setErroUpload(null)

    try {
      logoR.definir(await enviarLogoBarraca(barraca.id, arquivo))
    } catch {
      setErroUpload('Não foi possível enviar o logo. Tente novamente.')
    }

    setEnviandoLogo(false)
  }

  async function aoEscolherCapa(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return

    setEnviandoCapa(true)
    setErroUpload(null)

    try {
      capaR.definir(await enviarCapaBarraca(barraca.id, arquivo))
    } catch {
      setErroUpload('Não foi possível enviar a capa. Tente novamente.')
    }

    setEnviandoCapa(false)
  }

  function removerCapa() {
    capaR.definir(null)
  }

  async function salvar() {
    const nome = nomeR.valor.trim()
    if (!nome) return

    const alteracoes = { nome, logo_url: logoR.valor, imagem_capa_url: capaR.valor }
    const ok = await salvarBarraca(alteracoes)
    if (!ok) return

    // Só apaga o arquivo antigo do Storage depois de o banco confirmar que
    // aponta pro novo — antes, trocar o logo e não salvar deixava a barraca
    // apontando pra um arquivo já apagado.
    if (barraca.logo_url && barraca.logo_url !== alteracoes.logo_url) apagarLogoBarraca(barraca.logo_url)
    if (barraca.imagem_capa_url && barraca.imagem_capa_url !== alteracoes.imagem_capa_url) {
      apagarCapaBarraca(barraca.imagem_capa_url)
    }
    nomeR.descartar()
    logoR.descartar()
    capaR.descartar()
  }

  return (
    <section>
      <RotuloSecao icone="storefront">Identidade da barraca</RotuloSecao>
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-mesa-full bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <Icone nome="image" size={24} />
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            icon={<Icone nome="photo_camera" size={16} />}
            loading={enviandoLogo}
            onClick={() => inputArquivoRef.current?.click()}
          >
            {logoUrl ? 'Trocar logo' : 'Adicionar logo'}
          </Button>
          <input
            ref={inputArquivoRef}
            type="file"
            accept="image/*"
            onChange={aoEscolherArquivo}
            className="hidden"
          />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Imagem de capa</p>
          <div className="relative flex aspect-[16/6] w-full items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            {capaUrl ? (
              <img src={capaUrl} alt="" className="size-full object-cover" />
            ) : (
              <Icone nome="image" size={24} />
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="photo_camera" size={16} />}
              loading={enviandoCapa}
              onClick={() => inputCapaRef.current?.click()}
            >
              {capaUrl ? 'Trocar capa' : 'Adicionar capa'}
            </Button>
            {capaUrl && (
              <Button variant="textDanger" size="sm" icon={<Icone nome="delete" size={16} />} onClick={removerCapa}>
                Remover
              </Button>
            )}
          </div>
          <input
            ref={inputCapaRef}
            type="file"
            accept="image/*"
            onChange={aoEscolherCapa}
            className="hidden"
          />
          <p className="mt-1.5 text-xs text-mesa-text-secondary">
            Aparece no topo do cardápio público, atrás do logo e do nome.
          </p>
        </div>

        <Input
          label="Nome da barraca"
          value={nomeR.valor}
          onChange={(e) => nomeR.definir(e.target.value)}
          className="mt-4"
        />

        <ErroSalvar erro={erroUpload} className="mt-2" />

        <BotaoSalvarCampo
          alterado={alterado}
          salvando={salvando}
          salvo={salvo}
          erro={erro}
          desabilitado={!nomeR.valor.trim()}
          onSalvar={salvar}
          className="mt-4"
        />
      </Card>
    </section>
  )
}

/** Extraída de dentro de SecaoIdentidade em 2026-09-27 (pedido do dono do
 * produto): é sobre o cardápio digital, não sobre identidade/conta da
 * barraca — precisava cair na categoria "Cardápio & Operação" do desktop,
 * não em "Conta" junto do resto de SecaoIdentidade. */
function SecaoCardapioDigital({ barraca }: { barraca: Barraca }) {
  const [linkCopiado, setLinkCopiado] = useState(false)
  const linkCardapio = urlPublica(`/${barraca.slug}/cardapio`)

  async function compartilharCardapio() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Cardápio ${barraca.nome}`, url: linkCardapio })
      } catch {
        // usuário cancelou o share nativo — não é erro
      }
      return
    }

    try {
      await navigator.clipboard.writeText(linkCardapio)
      setLinkCopiado(true)
      window.setTimeout(() => setLinkCopiado(false), 2500)
    } catch {
      // clipboard indisponível — sem fallback melhor por ora
    }
  }

  return (
    <section>
      <Card>
        <p className="text-sm font-semibold text-mesa-text-primary">Cardápio digital</p>
        <p className="mt-0.5 text-xs text-mesa-text-secondary">
          Um link público, sem login, pro seu cliente ver o cardápio com foto e preço direto do
          celular.
        </p>
        <p className="mt-2 truncate text-xs text-mesa-text-tertiary">{linkCardapio}</p>
        <Button
          variant="outline"
          size="md"
          icon={<Icone nome="share" size={16} />}
          onClick={compartilharCardapio}
          className="mt-3 w-full"
        >
          {linkCopiado ? 'Link copiado!' : 'Compartilhar cardápio'}
        </Button>
      </Card>
    </section>
  )
}

function SecaoFaixas({ barraca }: { barraca: Barraca }) {
  const verdeR = useRascunho(String(barraca.verde_ate))
  const amareloR = useRascunho(String(barraca.amarelo_ate))
  const faixas = useSalvarBarraca(barraca)
  const exibicao = useSalvarBarraca(barraca)
  const horarioR = useRascunho(barraca.mostrar_horario_pedido)
  const mostrarHorario = horarioR.valor

  async function escolherExibicao(valor: boolean) {
    horarioR.definir(valor)
    await exibicao.salvar({ mostrar_horario_pedido: valor })
    // sucesso: o cache já traz o valor novo; falha: volta pro que está no banco
    horarioR.descartar()
  }

  const verdeNum = Number(verdeR.valor)
  const amareloNum = Number(amareloR.valor)
  const valido =
    Number.isFinite(verdeNum) &&
    Number.isFinite(amareloNum) &&
    verdeNum > 0 &&
    amareloNum > verdeNum

  async function salvar() {
    if (!valido) return
    const ok = await faixas.salvar({ verde_ate: verdeNum, amarelo_ate: amareloNum })
    if (ok) {
      verdeR.descartar()
      amareloR.descartar()
    }
  }

  return (
    <section>
      <RotuloSecao icone="timer">Faixas de tempo</RotuloSecao>
      <Card>
        <ul className="divide-y divide-mesa-border-subtle">
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2 text-base text-mesa-text-primary">
              <span className="size-2.5 shrink-0 rounded-mesa-full bg-mesa-kanban-green" aria-hidden />
              Verde até
            </span>
            <span className="flex items-center gap-1.5">
              <Input
                type="number"
                size="sm"
                min={1}
                value={verdeR.valor}
                onChange={(e) => verdeR.definir(e.target.value)}
                aria-label="Verde até (minutos)"
                className="w-20"
              />
              <span className="text-sm text-mesa-text-secondary">min</span>
            </span>
          </li>

          <li className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2 text-base text-mesa-text-primary">
              <span
                className="size-2.5 shrink-0 rounded-mesa-full bg-mesa-kanban-yellow"
                aria-hidden
              />
              Amarelo até
            </span>
            <span className="flex items-center gap-1.5">
              <Input
                type="number"
                size="sm"
                min={1}
                value={amareloR.valor}
                onChange={(e) => amareloR.definir(e.target.value)}
                aria-label="Amarelo até (minutos)"
                className="w-20"
              />
              <span className="text-sm text-mesa-text-secondary">min</span>
            </span>
          </li>

          <li className="flex items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-2 text-base text-mesa-text-primary">
              <span className="size-2.5 shrink-0 rounded-mesa-full bg-mesa-kanban-red" aria-hidden />
              Acima disso
            </span>
            <span className="text-sm font-semibold text-mesa-kanban-red">vermelho + alerta sonoro</span>
          </li>
        </ul>

        {!valido && (
          <p className="mt-3 text-sm text-mesa-error-500">
            O tempo do amarelo precisa ser maior que o do verde.
          </p>
        )}

        <BotaoSalvarCampo
          alterado={verdeR.alterado || amareloR.alterado}
          salvando={faixas.salvando}
          salvo={faixas.salvo}
          erro={faixas.erro}
          desabilitado={!valido}
          onSalvar={salvar}
          rotulo="Salvar faixas"
          className="mt-3"
        />

        <div className="mt-4 border-t border-mesa-border-subtle pt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">
            Cabeçalho do card na Cozinha
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip checked={!mostrarHorario} onClick={() => escolherExibicao(false)}>
              Cronômetro
            </Chip>
            <Chip checked={mostrarHorario} onClick={() => escolherExibicao(true)}>
              Horário de envio
            </Chip>
          </div>
          <p className="mt-2 text-xs text-mesa-text-secondary">
            Só muda o texto mostrado — a cor continua sempre pelo tempo decorrido
          </p>
          <ErroSalvar erro={exibicao.erro} className="mt-2" />
        </div>
      </Card>
      <p className="mt-2 text-xs text-mesa-text-secondary">
        Definem quando o card muda de cor na Cozinha
      </p>
    </section>
  )
}

function textoTaxaInvalido(valor: string): boolean {
  const temCaracterInvalido = /[^d.,s-]/.test(valor)
  const bps = percentualParaBps(valor)
  const foraDoIntervalo = bps !== null && (bps < 0 || bps > BPS_MAX)
  return temCaracterInvalido || foraDoIntervalo
}

function SecaoPagamento({ barraca }: { barraca: Barraca }) {
  const metodosServidor = barraca.metodos_pagamento_ativos ?? ['dinheiro', 'debito', 'credito', 'pix']
  const metodosR = useRascunho<string[]>(metodosServidor, (a, b) => a.join() === b.join())
  const ativos = metodosR.valor
  const [aviso, setAviso] = useState<string | null>(null)
  const metodos = useSalvarBarraca(barraca)

  const debitoR = useRascunho(bpsParaPercentual(barraca.taxa_debito_bps ?? null))
  const creditoR = useRascunho(bpsParaPercentual(barraca.taxa_credito_bps ?? null))
  const taxas = useSalvarBarraca(barraca)
  const invalidoDebito = debitoR.alterado && textoTaxaInvalido(debitoR.valor)
  const invalidoCredito = creditoR.alterado && textoTaxaInvalido(creditoR.valor)

  async function alternar(chave: string) {
    const estaAtivo = ativos.includes(chave)

    if (estaAtivo && ativos.length === 1) {
      setAviso('Você precisa ter ao menos um método de pagamento ativo.')
      return
    }

    setAviso(null)
    const novaLista = estaAtivo ? ativos.filter((m) => m !== chave) : [...ativos, chave]
    metodosR.definir(novaLista)
    await metodos.salvar({ metodos_pagamento_ativos: novaLista })
    // sucesso: cache já tem a lista nova; falha: volta pra lista do banco
    metodosR.descartar()
  }

  async function salvarTaxas() {
    if (invalidoDebito || invalidoCredito) return
    const alteracoes: Partial<Barraca> = {}
    if (debitoR.alterado) alteracoes.taxa_debito_bps = percentualParaBps(debitoR.valor)
    if (creditoR.alterado) alteracoes.taxa_credito_bps = percentualParaBps(creditoR.valor)
    const ok = await taxas.salvar(alteracoes)
    if (ok) {
      debitoR.descartar()
      creditoR.descartar()
    }
  }

  return (
    <section>
      <RotuloSecao icone="credit_card">Pagamento e taxas</RotuloSecao>
      <Card>
        {aviso && <AvisoInline>{aviso}</AvisoInline>}

        <ul className="divide-y divide-mesa-border-subtle">
          {METODOS_DISPONIVEIS.map((metodo) => (
            <li key={metodo.chave}>
              <label
                htmlFor={`metodo-${metodo.chave}`}
                className="flex cursor-pointer items-center justify-between gap-3 py-3"
              >
                <span className="inline-flex items-center gap-2 text-base text-mesa-text-primary">
                  <Icone nome={metodo.icone} size={16} />
                  {metodo.label}
                </span>
                <Toggle
                  id={`metodo-${metodo.chave}`}
                  checked={ativos.includes(metodo.chave)}
                  onChange={() => alternar(metodo.chave)}
                  aria-label={metodo.label}
                />
              </label>
            </li>
          ))}
        </ul>

        <ErroSalvar erro={metodos.erro} className="mt-2" />

        <p className="mt-4 text-sm text-mesa-text-secondary">
          Taxas que a maquininha cobra por transação. Usadas só para estimar o valor líquido no
          relatório.
        </p>

        <div className="mt-3 flex flex-wrap gap-4">
          <div className="min-w-[140px] flex-1">
            <span className="text-sm text-mesa-text-secondary">Débito</span>
            <Input
              type="percentage"
              size="sm"
              inputMode="decimal"
              value={debitoR.valor}
              onChange={(e) => debitoR.definir(e.target.value)}
              placeholder="0,00"
              aria-label="Taxa de débito"
              error={invalidoDebito ? 'Entre 0 e 50%' : undefined}
              className="mt-1"
            />
          </div>

          <div className="min-w-[140px] flex-1">
            <span className="text-sm text-mesa-text-secondary">Crédito</span>
            <Input
              type="percentage"
              size="sm"
              inputMode="decimal"
              value={creditoR.valor}
              onChange={(e) => creditoR.definir(e.target.value)}
              placeholder="0,00"
              aria-label="Taxa de crédito"
              error={invalidoCredito ? 'Entre 0 e 50%' : undefined}
              className="mt-1"
            />
          </div>
        </div>

        <BotaoSalvarCampo
          alterado={debitoR.alterado || creditoR.alterado}
          salvando={taxas.salvando}
          salvo={taxas.salvo}
          erro={taxas.erro}
          desabilitado={invalidoDebito || invalidoCredito}
          onSalvar={salvarTaxas}
          rotulo="Salvar taxas"
          className="mt-4"
        />
      </Card>
    </section>
  )
}

function SecaoAparencia() {
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  return (
    <section>
      <RotuloSecao icone="palette">Aparência</RotuloSecao>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span className="text-base text-mesa-text-primary">Tema</span>
          <button
            type="button"
            onClick={alternarTema}
            aria-label={escuro ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            className={classesBotaoIcone()}
          >
            {escuro ? <Icone nome="light_mode" size={20} /> : <Icone nome="dark_mode" size={20} />}
          </button>
        </div>
      </Card>
    </section>
  )
}

const REGIMES_TRIBUTARIOS: { valor: RegimeTributario; rotulo: string }[] = [
  { valor: 'simples_nacional', rotulo: 'Simples Nacional' },
  { valor: 'mei', rotulo: 'MEI' },
]

const AMBIENTES_FISCAIS: { valor: AmbienteFiscal; rotulo: string }[] = [
  { valor: 'homologacao', rotulo: 'Homologação (teste)' },
  { valor: 'producao', rotulo: 'Produção' },
]

/** A FocusNFe emite um token DIFERENTE por ambiente (token_homologacao e
 * token_producao são credenciais distintas de verdade, não o mesmo valor
 * com URL diferente) — confirmado na doc deles e na UI de um concorrente
 * que já implementou (dois campos de token separados). Por isso esse
 * sheet é parametrizado por ambiente em vez de ter um campo só. */
function BottomSheetTokenFiscal({
  barracaId,
  ambiente,
  open,
  onClose,
  onSucesso,
}: {
  barracaId: string
  ambiente: AmbienteFiscal
  open: boolean
  onClose: () => void
  onSucesso: () => void
}) {
  const [token, setToken] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const rotuloAmbiente = ambiente === 'producao' ? 'Produção' : 'Homologação'

  function fechar() {
    setToken('')
    setErro(null)
    onClose()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!token.trim()) {
      setErro('Cole o token gerado no painel da FocusNFe')
      return
    }

    if (navigator.onLine === false) {
      setErro(MSG_SEM_INTERNET)
      return
    }

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_token_fiscal', {
      p_barraca_id: barracaId,
      p_ambiente: ambiente,
      p_token: token.trim(),
    })

    setProcessando(false)

    if (error) {
      setErro(mensagemErroSalvar(error))
      return
    }

    fechar()
    onSucesso()
  }

  return (
    <BottomSheet open={open} onClose={fechar} aria-label={`Token da FocusNFe — ${rotuloAmbiente}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">Token da FocusNFe — {rotuloAmbiente}</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Gerado no painel da FocusNFe depois de cadastrar sua empresa lá — a FocusNFe emite um token
        diferente pra cada ambiente. Fica guardado só pra uso do sistema, não é mostrado de novo
        depois de salvo.
      </p>

      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <Input
          label={`Token (${rotuloAmbiente})`}
          type="password"
          autoComplete="off"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}
        <Button
          type="submit"
          size="xl"
          icon={<Icone nome="check" size={20} />}
          loading={processando}
          className="w-full"
        >
          Salvar
        </Button>
      </form>
    </BottomSheet>
  )
}

/** Configuração fiscal (CLAUDE.md, roadmap 2026-09-26): FocusNFe como
 * provedor fiscal-as-a-service. Certificado digital e CSC são
 * cadastrados pelo dono direto no site da FocusNFe — o Sai aê nunca
 * guarda o certificado, só o token da empresa. Emissão de verdade é
 * rodada futura; aqui só a configuração. */
function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

function formatarCnpj(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function SecaoFiscal({ barraca }: { barraca: Barraca }) {
  const habilitadoR = useRascunho(barraca.fiscal_habilitado)
  const regimeR = useRascunho(barraca.fiscal_regime_tributario)
  const ambienteR = useRascunho(barraca.fiscal_ambiente)
  const cnpjR = useRascunho(formatarCnpj(barraca.cnpj ?? ''), (a, b) => apenasDigitos(a) === apenasDigitos(b))
  const habilitado = habilitadoR.valor
  const regime = regimeR.valor
  const ambiente = ambienteR.valor
  const salvarCnpjEstado = useSalvarBarraca(barraca)
  const salvarHabilitado = useSalvarBarraca(barraca)
  const salvarRegime = useSalvarBarraca(barraca)
  const salvarAmbiente = useSalvarBarraca(barraca)
  const [erroCnpj, setErroCnpj] = useState<string | null>(null)
  const [tokensConfigurados, setTokensConfigurados] = useState<{
    homologacao: boolean
    producao: boolean
  } | null>(null)
  const [erroTokens, setErroTokens] = useState<string | null>(null)
  const [recargaTokens, setRecargaTokens] = useState(0)
  const [sheetTokenAmbiente, setSheetTokenAmbiente] = useState<AmbienteFiscal | null>(null)

  // O estado "configurado" vem SEMPRE do banco (RPC), nunca de suposição: depois
  // de salvar um token o sheet pede uma nova consulta em vez de marcar true.
  useEffect(() => {
    let cancelado = false

    supabase
      .rpc('token_fiscal_configurado', { p_barraca_id: barraca.id })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setErroTokens(mensagemErroSalvar(error).replace('salvar', 'verificar os tokens'))
          return
        }
        const linha = Array.isArray(data) ? data[0] : data
        setErroTokens(null)
        setTokensConfigurados({
          homologacao: Boolean(linha?.homologacao),
          producao: Boolean(linha?.producao),
        })
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id, recargaTokens])

  async function alternarHabilitado(valor: boolean) {
    habilitadoR.definir(valor)
    await salvarHabilitado.salvar({ fiscal_habilitado: valor })
    habilitadoR.descartar()
  }

  async function salvarCnpj() {
    const limpo = apenasDigitos(cnpjR.valor)
    if (limpo.length !== 0 && limpo.length !== 14) {
      setErroCnpj('O CNPJ precisa ter 14 números.')
      return
    }
    setErroCnpj(null)
    const ok = await salvarCnpjEstado.salvar({ cnpj: limpo || null })
    if (ok) cnpjR.descartar()
  }

  async function escolherRegime(valor: RegimeTributario) {
    regimeR.definir(valor)
    await salvarRegime.salvar({ fiscal_regime_tributario: valor })
    regimeR.descartar()
  }

  async function escolherAmbiente(valor: AmbienteFiscal) {
    ambienteR.definir(valor)
    await salvarAmbiente.salvar({ fiscal_ambiente: valor })
    ambienteR.descartar()
  }

  function textoToken(configurado: boolean | undefined): string {
    if (tokensConfigurados === null) return erroTokens ? 'Não verificado' : 'Verificando...'
    return configurado ? 'Configurado' : 'Não configurado'
  }

  return (
    <section>
      <RotuloSecao icone="receipt_long">Fiscal</RotuloSecao>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Crie sua conta em focusnfe.com.br, faça o upload do certificado digital A1 diretamente no
          painel deles e cole os tokens abaixo. O certificado fica sob custódia do provedor — o Sai
          aê apenas orquestra a emissão.
        </p>

        <div className="mt-4">
          <Input
            label="CNPJ (emitente)"
            inputMode="numeric"
            value={cnpjR.valor}
            onChange={(e) => {
              setErroCnpj(null)
              cnpjR.definir(formatarCnpj(e.target.value))
            }}
            placeholder="00.000.000/0000-00"
            error={erroCnpj ?? undefined}
            className="max-w-xs"
          />
          <BotaoSalvarCampo
            alterado={cnpjR.alterado}
            salvando={salvarCnpjEstado.salvando}
            salvo={salvarCnpjEstado.salvo}
            erro={salvarCnpjEstado.erro}
            onSalvar={salvarCnpj}
            rotulo="Salvar CNPJ"
            className="mt-2"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-base text-mesa-text-primary">Fiscal habilitado</span>
          <Toggle checked={habilitado} onChange={alternarHabilitado} aria-label="Fiscal habilitado" />
        </div>
        <ErroSalvar erro={salvarHabilitado.erro} className="mt-2" />

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Regime tributário</p>
          <div className="flex flex-wrap gap-1.5">
            {REGIMES_TRIBUTARIOS.map((r) => (
              <Chip key={r.valor} checked={regime === r.valor} onClick={() => escolherRegime(r.valor)}>
                {r.rotulo}
              </Chip>
            ))}
          </div>
          <ErroSalvar erro={salvarRegime.erro} className="mt-2" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Ambiente</p>
          <div className="flex flex-wrap gap-1.5">
            {AMBIENTES_FISCAIS.map((a) => (
              <Chip key={a.valor} checked={ambiente === a.valor} onClick={() => escolherAmbiente(a.valor)}>
                {a.rotulo}
              </Chip>
            ))}
          </div>
          <ErroSalvar erro={salvarAmbiente.erro} className="mt-2" />
          {ambiente === 'producao' && (
            <div className="mt-3">
              <AvisoInline>Notas emitidas em produção têm validade fiscal real.</AvisoInline>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Token da FocusNFe</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
              <div>
                <p className="text-sm text-mesa-text-primary">Homologação</p>
                <p className="text-xs text-mesa-text-secondary">
                  {textoToken(tokensConfigurados?.homologacao)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSheetTokenAmbiente('homologacao')}>
                {tokensConfigurados?.homologacao ? 'Trocar' : 'Definir'}
              </Button>
            </div>
            <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
              <div>
                <p className="text-sm text-mesa-text-primary">Produção</p>
                <p className="text-xs text-mesa-text-secondary">
                  {textoToken(tokensConfigurados?.producao)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSheetTokenAmbiente('producao')}>
                {tokensConfigurados?.producao ? 'Trocar' : 'Definir'}
              </Button>
            </div>
          </div>
          {erroTokens && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ErroSalvar erro={erroTokens} />
              <Button variant="ghost" size="sm" onClick={() => setRecargaTokens((n) => n + 1)}>
                Tentar de novo
              </Button>
            </div>
          )}
        </div>
      </Card>

      <BottomSheetTokenFiscal
        barracaId={barraca.id}
        ambiente={sheetTokenAmbiente ?? 'homologacao'}
        open={sheetTokenAmbiente !== null}
        onClose={() => setSheetTokenAmbiente(null)}
        onSucesso={() => setRecargaTokens((n) => n + 1)}
      />
    </section>
  )
}

function BottomSheetTokenPagamento({
  barracaId,
  open,
  onClose,
  onSucesso,
}: {
  barracaId: string
  open: boolean
  onClose: () => void
  onSucesso: () => void
}) {
  const [token, setToken] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setToken('')
    setErro(null)
    onClose()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!token.trim()) {
      setErro('Cole o Access Token gerado no painel do Mercado Pago')
      return
    }

    if (navigator.onLine === false) {
      setErro(MSG_SEM_INTERNET)
      return
    }

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_token_pagamento', {
      p_barraca_id: barracaId,
      p_token: token.trim(),
    })

    setProcessando(false)

    if (error) {
      setErro(mensagemErroSalvar(error))
      return
    }

    fechar()
    onSucesso()
  }

  return (
    <BottomSheet open={open} onClose={fechar} aria-label="Access Token do Mercado Pago">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Access Token do Mercado Pago</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Gerado no painel de desenvolvedores da sua conta Mercado Pago ("Suas integrações" → credenciais
        de produção). Fica guardado só pra uso do sistema, não é mostrado de novo depois de salvo.
      </p>

      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <Input
          label="Access Token"
          type="password"
          autoComplete="off"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}
        <Button
          type="submit"
          size="xl"
          icon={<Icone nome="check" size={20} />}
          loading={processando}
          className="w-full"
        >
          Salvar
        </Button>
      </form>
    </BottomSheet>
  )
}

/** Pagamento online via Pix (CLAUDE.md, roadmap Cardápio Digital Fase
 * 2+3): cada barraca cria a própria conta no Mercado Pago e cola o
 * Access Token dela aqui — mesmo modelo do Fiscal (FocusNFe). O dinheiro
 * cai direto na conta da barraca, o Sai aê nunca guarda nem repassa. */
function SecaoPagamentoOnline({ barraca }: { barraca: Barraca }) {
  const habilitadoR = useRascunho(barraca.pagamento_online_habilitado)
  const habilitado = habilitadoR.valor
  const salvarHabilitado = useSalvarBarraca(barraca)
  const [tokenConfigurado, setTokenConfigurado] = useState<boolean | null>(null)
  const [erroToken, setErroToken] = useState<string | null>(null)
  const [recargaToken, setRecargaToken] = useState(0)
  const [mostrarSheetToken, setMostrarSheetToken] = useState(false)

  // Mesmo princípio do Fiscal: "configurado" é o que o banco responde.
  useEffect(() => {
    let cancelado = false

    supabase
      .rpc('token_pagamento_configurado', { p_barraca_id: barraca.id })
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          setErroToken(mensagemErroSalvar(error).replace('salvar', 'verificar o token'))
          return
        }
        setErroToken(null)
        setTokenConfigurado(Boolean(data))
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id, recargaToken])

  async function alternarHabilitado(valor: boolean) {
    habilitadoR.definir(valor)
    await salvarHabilitado.salvar({ pagamento_online_habilitado: valor })
    habilitadoR.descartar()
  }

  return (
    <section>
      <RotuloSecao icone="payments">Pagamento online</RotuloSecao>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Crie uma conta no Mercado Pago em nome da sua barraca e cole o Access Token de produção
          abaixo — o dinheiro do Pix cai direto na sua conta, o Sai aê nunca guarda nem repassa esse
          valor. Só depois do pagamento confirmado o pedido feito no cardápio digital cai na Cozinha.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-base text-mesa-text-primary">Pagamento online habilitado</span>
          <Toggle
            checked={habilitado}
            onChange={alternarHabilitado}
            aria-label="Pagamento online habilitado"
          />
        </div>
        <ErroSalvar erro={salvarHabilitado.erro} className="mt-2" />

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Access Token do Mercado Pago</p>
          <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
            <p className="text-xs text-mesa-text-secondary">
              {tokenConfigurado === null
                ? erroToken
                  ? 'Não verificado'
                  : 'Verificando...'
                : tokenConfigurado
                  ? 'Configurado'
                  : 'Não configurado'}
            </p>
            <Button variant="outline" size="sm" onClick={() => setMostrarSheetToken(true)}>
              {tokenConfigurado ? 'Trocar' : 'Definir'}
            </Button>
          </div>
          {erroToken && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ErroSalvar erro={erroToken} />
              <Button variant="ghost" size="sm" onClick={() => setRecargaToken((n) => n + 1)}>
                Tentar de novo
              </Button>
            </div>
          )}
        </div>
      </Card>

      <BottomSheetTokenPagamento
        barracaId={barraca.id}
        open={mostrarSheetToken}
        onClose={() => setMostrarSheetToken(false)}
        onSucesso={() => setRecargaToken((n) => n + 1)}
      />
    </section>
  )
}

const PIN_INVALIDO = 'O PIN precisa ter exatamente 4 números'

function BottomSheetSenhaAdmin({
  barracaId,
  open,
  onClose,
  onSucesso,
}: {
  barracaId: string
  open: boolean
  onClose: () => void
  onSucesso: () => void
}) {
  const [pin, setPin] = useState('')
  const [pinConfirmacao, setPinConfirmacao] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setPin('')
    setPinConfirmacao('')
    setErro(null)
    onClose()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!/^[0-9]{4}$/.test(pin)) {
      setErro(PIN_INVALIDO)
      return
    }
    if (pin !== pinConfirmacao) {
      setErro('Os dois PINs não conferem')
      return
    }

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_senha_admin', {
      p_barraca_id: barracaId,
      p_pin: pin,
    })

    setProcessando(false)

    if (error) {
      setErro('Não foi possível salvar. Tente novamente.')
      return
    }

    fechar()
    onSucesso()
  }

  return (
    <BottomSheet open={open} onClose={fechar} aria-label="Alterar senha administrativa">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Senha administrativa</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Esse PIN protege o acesso a Ajustes e Histórico.
      </p>

      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <Input
          label="Novo PIN"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoFocus
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        <Input
          label="Confirmar PIN"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="off"
          value={pinConfirmacao}
          onChange={(e) => setPinConfirmacao(e.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        {erro && <p className="text-sm font-medium text-mesa-error-500">{erro}</p>}
        <Button
          type="submit"
          size="xl"
          icon={<Icone nome="check" size={20} />}
          loading={processando}
          className="w-full"
        >
          Salvar
        </Button>
      </form>
    </BottomSheet>
  )
}

/** Exclusão de conta irreversível: só habilita o botão depois de digitar
 * EXCLUIR. A edge function apaga dados + login; aqui só limpa o aparelho
 * (biometria) e volta pro Login. */
function BottomSheetExcluirConta({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { sair } = useAuth()
  const { mostrarToast } = useToast()
  const [texto, setTexto] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    if (excluindo) return
    setTexto('')
    setErro(null)
    onClose()
  }

  async function excluir() {
    setExcluindo(true)
    setErro(null)
    const { data, error } = await supabase.functions.invoke('excluir-conta', {
      body: { confirmacao: 'EXCLUIR' },
    })
    if (error || !data || data.erro) {
      setErro(data?.erro ?? 'Não foi possível excluir a conta. Tente novamente.')
      setExcluindo(false)
      return
    }

    desativarFaceId()
    await sair()
    mostrarToast('Sua conta foi excluída.', { variante: 'sucesso' })
    navigate('/login', { replace: true })
  }

  return (
    <BottomSheet open={open} onClose={fechar} aria-label="Excluir minha conta">
      <h2 className="text-lg font-semibold text-mesa-text-primary">Excluir minha conta</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Isso apaga seu login e todas as barracas em que você é o único dono, com pedidos, cardápio e
        configurações. Não dá pra desfazer. Se você tem assinatura, cancele-a à parte.
      </p>
      <p className="mt-3 text-sm text-mesa-text-secondary">
        Para confirmar, digite <strong>EXCLUIR</strong>:
      </p>
      <Input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        autoCapitalize="characters"
        autoComplete="off"
        aria-label="Digite EXCLUIR para confirmar"
        className="mt-2"
      />
      {erro && <p className="mt-3 text-sm font-medium text-mesa-error-500">{erro}</p>}
      <div className="mt-6 flex flex-col gap-2">
        <Button
          variant="destructive"
          size="xl"
          loading={excluindo}
          disabled={texto.trim().toUpperCase() !== 'EXCLUIR'}
          className="w-full"
          onClick={excluir}
        >
          Excluir minha conta
        </Button>
        <Button variant="ghost" size="md" className="w-full" onClick={fechar} disabled={excluindo}>
          Cancelar
        </Button>
      </div>
    </BottomSheet>
  )
}

function Rodape({ barracaId }: { barracaId: string }) {
  const navigate = useNavigate()
  const { usuario, sair } = useAuth()
  const [mostrarModal, setMostrarModal] = useState(false)
  const [sucesso, setSucesso] = useState(false)
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)
  const [excluindoConta, setExcluindoConta] = useState(false)

  const [suportaFaceId, setSuportaFaceId] = useState(false)
  const [faceIdLigado, setFaceIdLigado] = useState(() => faceIdAtivado())
  const [processandoFaceId, setProcessandoFaceId] = useState(false)
  const [erroFaceId, setErroFaceId] = useState<string | null>(null)

  const [mostrarSenhaAdmin, setMostrarSenhaAdmin] = useState(false)
  const [sucessoSenhaAdmin, setSucessoSenhaAdmin] = useState(false)

  const email = usuario?.email ?? null

  useEffect(() => {
    let cancelado = false
    faceIdSuportado().then((suportado) => {
      if (!cancelado) setSuportaFaceId(suportado)
    })
    return () => {
      cancelado = true
    }
  }, [])

  function aoTrocarComSucesso() {
    setMostrarModal(false)
    setSucesso(true)
    window.setTimeout(() => setSucesso(false), 3000)
  }

  async function alternarFaceId() {
    setErroFaceId(null)

    if (faceIdLigado) {
      desativarFaceId()
      setFaceIdLigado(false)
      return
    }

    if (!usuario?.email) return

    setProcessandoFaceId(true)
    try {
      await ativarFaceId({ id: usuario.id, email: usuario.email })
      setFaceIdLigado(true)
    } catch {
      setErroFaceId('Não foi possível ativar a biometria neste aparelho. Tente de novo.')
    }
    setProcessandoFaceId(false)
  }

  return (
    <section className="flex flex-col gap-1">
      <RotuloSecao icone="verified_user">Segurança e operador</RotuloSecao>

      {suportaFaceId && (
        <>
          <Button
            variant="ghost"
            size="md"
            onClick={alternarFaceId}
            loading={processandoFaceId}
            className="w-full"
          >
            {faceIdLigado ? 'Desativar biometria neste aparelho' : 'Ativar biometria neste aparelho'}
          </Button>
          {erroFaceId && (
            <p className="text-center text-sm font-medium text-mesa-error-500">{erroFaceId}</p>
          )}
        </>
      )}

      <Button variant="ghost" size="md" onClick={() => setMostrarModal(true)} className="w-full">
        Trocar senha de operador
      </Button>

      {sucesso && (
        <p className="text-center text-sm font-medium text-mesa-success-700 dark:text-mesa-success-500">
          Senha alterada com sucesso
        </p>
      )}

      <Button
        variant="ghost"
        size="md"
        onClick={() => {
          setSucessoSenhaAdmin(false)
          setMostrarSenhaAdmin(true)
        }}
        className="w-full"
      >
        Alterar senha administrativa / Mestre
      </Button>

      {sucessoSenhaAdmin && (
        <p className="text-center text-sm font-medium text-mesa-success-700 dark:text-mesa-success-500">
          Senha administrativa alterada
        </p>
      )}

      <Button
        variant="destructive"
        size="lg"
        icon={<Icone nome="logout" size={16} />}
        onClick={() => setConfirmandoSaida(true)}
        className="mt-3 w-full"
      >
        Sair da conta
      </Button>

      <Button variant="ghost" size="md" onClick={() => setExcluindoConta(true)} className="w-full">
        Excluir minha conta
      </Button>

      <BottomSheetExcluirConta open={excluindoConta} onClose={() => setExcluindoConta(false)} />

      {mostrarModal && email && (
        <ModalTrocarSenha
          email={email}
          onFechar={() => setMostrarModal(false)}
          onSucesso={aoTrocarComSucesso}
        />
      )}

      <BottomSheetSenhaAdmin
        barracaId={barracaId}
        open={mostrarSenhaAdmin}
        onClose={() => setMostrarSenhaAdmin(false)}
        onSucesso={() => setSucessoSenhaAdmin(true)}
      />

      <BottomSheet
        open={confirmandoSaida}
        onClose={() => setConfirmandoSaida(false)}
        aria-label="Confirmar saída"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Você quer mesmo sair?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Vai precisar entrar com e-mail e senha de novo.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="destructive"
            size="xl"
            icon={<Icone nome="logout" size={20} />}
            className="w-full"
            onClick={async () => {
              await sair()
              navigate('/login')
            }}
          >
            Sair
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            onClick={() => setConfirmandoSaida(false)}
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}

// Só aparece pro dono — funcionário não assina nada, é liberado/bloqueado
// pelo status do dono da barraca (ver assinatura_da_barraca no banco).
function SecaoAssinatura({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const { assinatura } = useAssinaturaBarraca(slug)

  if (!assinatura?.eh_dono) return null

  const rotuloStatus =
    assinatura.status === 'trialing'
      ? 'Teste grátis'
      : assinatura.status === 'active'
        ? 'Ativa'
        : assinatura.status === 'past_due'
          ? 'Pagamento pendente'
          : assinatura.status === 'canceled'
            ? 'Cancelada'
            : 'Assinar agora'

  return (
    <section className="flex flex-col gap-1">
      <RotuloSecao icone="auto_awesome">Assinatura</RotuloSecao>
      <button
        type="button"
        onClick={() => navigate(`/${slug}/assinatura`)}
        className="flex w-full items-center justify-between rounded-mesa-lg border border-mesa-border-default bg-mesa-surface px-4 py-3.5 text-left hover:bg-[var(--mesa-state-hover-bg)]"
      >
        <span>
          <span className="block text-sm font-medium text-mesa-text-primary">
            {assinatura.plano === 'pro' ? 'Plano Pro' : assinatura.plano === 'essencial' ? 'Plano Essencial' : 'Sai aê'}
          </span>
          <span className="block text-xs text-mesa-text-secondary">{rotuloStatus}</span>
        </span>
        <Icone nome="chevron_right" size={20} className="text-mesa-text-tertiary" />
      </button>
    </section>
  )
}

type CategoriaAjustes = 'conta' | 'cardapio'

const ABAS_CATEGORIA: { valor: CategoriaAjustes; rotulo: string; rota: string }[] = [
  { valor: 'conta', rotulo: 'Conta', rota: 'ajustes' },
  { valor: 'cardapio', rotulo: 'Cardápio & Operação', rota: 'ajustes/cardapio' },
]

/**
 * Só no desktop (`md:` pra cima) as 11 seções de Ajustes se separam em duas
 * categorias/rotas (pedido do dono do produto, 2026-09-27: a página tinha
 * crescido demais numa rolagem só) — no mobile continua tudo numa página só,
 * na MESMA ordem de sempre, padrão normal de configuração em app mobile.
 * Em vez de duas rotas com conteúdo totalmente separado, as 11 seções
 * continuam todas montadas (mesmo componente, mesma ordem no DOM) — cada uma
 * entra num wrapper `contents` (não afeta layout/ordem) que só ganha
 * `md:hidden` quando não pertence à categoria da rota atual. Isso preserva a
 * ordem exata do mobile sem duplicar nenhuma seção.
 */
function SecaoDaCategoria({
  categoria,
  atual,
  children,
}: {
  categoria: CategoriaAjustes
  atual: CategoriaAjustes
  children: ReactNode
}) {
  return <div className={clsx('contents', categoria !== atual && 'md:hidden')}>{children}</div>
}

export function Ajustes({ categoria = 'conta' }: { categoria?: CategoriaAjustes }) {
  const barraca = useBarracaAtual()

  return (
    <GateSenhaAdmin key={barraca.id} barracaId={barraca.id} slug={barraca.slug}>
      <div className="min-h-dvh">
        <div className="sticky top-0 z-[var(--mesa-z-sticky)] bg-[var(--mesa-color-surface-blur)] px-6 py-5 [backdrop-filter:blur(var(--mesa-surface-blur-strength))]">
          <div className="md:mx-auto md:max-w-3xl">
            <Link
              to={`/${barraca.slug}`}
              aria-label="Voltar para o início"
              className="inline-flex items-center gap-2 text-mesa-text-primary"
            >
              <Icone nome="chevron_left" size={28} />
              <h1 className="text-[32px] font-bold leading-[40px]">Ajustes</h1>
            </Link>

            <div className="mt-3 hidden gap-1.5 md:flex">
              {ABAS_CATEGORIA.map((aba) => (
                <Link
                  key={aba.valor}
                  to={`/${barraca.slug}/${aba.rota}`}
                  className={clsx(
                    'inline-flex min-h-9 items-center rounded-mesa-full px-3.5 text-sm font-semibold transition-colors',
                    aba.valor === categoria
                      ? 'bg-mesa-neutral-900 text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900'
                      : 'bg-mesa-neutral-100 text-mesa-text-secondary hover:text-mesa-text-primary dark:bg-mesa-neutral-800',
                  )}
                >
                  {aba.rotulo}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-8 px-6 pb-28 pt-2 md:mx-auto md:max-w-3xl">
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoAssinatura slug={barraca.slug} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoIdentidade barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoCardapioDigital barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoCardapio barracaId={barraca.id} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoBanners barracaId={barraca.id} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoHorarioFuncionamento barracaId={barraca.id} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoFaixas barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoPagamento barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoFiscal barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoPagamentoOnline barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoImpressora barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoAparencia />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <SecaoAjudaSuporte barracaNome={barraca.nome} barracaSlug={barraca.slug} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="conta" atual={categoria}>
            <Rodape barracaId={barraca.id} />
          </SecaoDaCategoria>
        </div>
      </div>
    </GateSenhaAdmin>
  )
}
