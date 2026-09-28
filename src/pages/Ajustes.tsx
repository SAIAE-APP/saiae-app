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
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
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

function IndicadorSalvo({ salvo }: { salvo: boolean }) {
  return (
    <span className="flex h-4 items-center gap-1 text-xs font-medium text-mesa-success-700 dark:text-mesa-success-500">
      {salvo && (
        <>
          <Icone nome="check" size={14} />
          Salvo
        </>
      )}
    </span>
  )
}

function InputPreco({ item }: { item: Item }) {
  const [texto, setTexto] = useState(() => textoPrecoInicial(item.preco_centavos))
  const [salvo, setSalvo] = useState(false)
  const debounceRef = useRef<number | null>(null)
  const salvoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
    }
  }, [])

  function aoMudar(valor: string) {
    const limpo = valor.replace(/[^\d.,]/g, '')
    setTexto(limpo)

    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      const centavos = reaisParaCentavos(limpo)
      const { error } = await supabase
        .from('itens')
        .update({ preco_centavos: centavos })
        .eq('id', item.id)

      if (!error) {
        setSalvo(true)
        if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
        salvoTimerRef.current = window.setTimeout(() => setSalvo(false), 1000)
      }
    }, 500)
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Input
        type="currency"
        size="sm"
        inputMode="decimal"
        value={texto}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder="0,00"
        aria-label={`Preço de ${item.nome}`}
        className="w-28"
      />
      <span className="flex w-4 shrink-0 items-center justify-center">
        {salvo && <Icone nome="check" size={16} className="text-mesa-success-700 dark:text-mesa-success-500" aria-label="Salvo" />}
      </span>
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
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, nome: item.nome } : i)))
    }
  }

  async function alternarAtivo(item: Item) {
    const novoAtivo = !item.ativo
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, ativo: novoAtivo } : i)))
    const { error } = await supabase.from('itens').update({ ativo: novoAtivo }).eq('id', item.id)

    if (error) {
      setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, ativo: item.ativo } : i)))
    }
  }

  async function alternarEsgotado(item: Item) {
    const novoEsgotado = !item.esgotado
    setItens((atual) => atual.map((i) => (i.id === item.id ? { ...i, esgotado: novoEsgotado } : i)))
    const { error } = await supabase.from('itens').update({ esgotado: novoEsgotado }).eq('id', item.id)

    if (error) {
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
  const [nome, setNome] = useState(barraca.nome)
  const [logoUrl, setLogoUrl] = useState(barraca.logo_url)
  const [capaUrl, setCapaUrl] = useState(barraca.imagem_capa_url)
  const [enviandoLogo, setEnviandoLogo] = useState(false)
  const [enviandoCapa, setEnviandoCapa] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  const inputCapaRef = useRef<HTMLInputElement>(null)

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return

    setEnviandoLogo(true)
    setErro(null)

    try {
      const urlAntiga = logoUrl
      const novaUrl = await enviarLogoBarraca(barraca.id, arquivo)
      setLogoUrl(novaUrl)
      if (urlAntiga) apagarLogoBarraca(urlAntiga)
    } catch {
      setErro('Não foi possível enviar o logo. Tente novamente.')
    }

    setEnviandoLogo(false)
  }

  async function aoEscolherCapa(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return

    setEnviandoCapa(true)
    setErro(null)

    try {
      const urlAntiga = capaUrl
      const novaUrl = await enviarCapaBarraca(barraca.id, arquivo)
      setCapaUrl(novaUrl)
      if (urlAntiga) apagarCapaBarraca(urlAntiga)
    } catch {
      setErro('Não foi possível enviar a capa. Tente novamente.')
    }

    setEnviandoCapa(false)
  }

  function removerCapa() {
    if (capaUrl) apagarCapaBarraca(capaUrl)
    setCapaUrl(null)
  }

  async function salvar() {
    if (!nome.trim()) return
    setSalvando(true)
    setErro(null)

    const { error } = await supabase
      .from('barracas')
      .update({ nome: nome.trim(), logo_url: logoUrl, imagem_capa_url: capaUrl })
      .eq('id', barraca.id)

    setSalvando(false)

    if (error) {
      setErro('Não foi possível salvar. Tente novamente.')
      return
    }

    setSalvo(true)
    window.setTimeout(() => setSalvo(false), 3000)
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
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="mt-4"
        />

        {erro && <p className="mt-2 text-sm font-medium text-mesa-error-500">{erro}</p>}

        <Button
          size="md"
          loading={salvando}
          disabled={!nome.trim()}
          onClick={salvar}
          className="mt-4 w-full"
        >
          {salvo ? 'Salvo!' : 'Salvar'}
        </Button>
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
  const [verdeAte, setVerdeAte] = useState(String(barraca.verde_ate))
  const [amareloAte, setAmareloAte] = useState(String(barraca.amarelo_ate))
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const verdeNum = Number(verdeAte)
  const amareloNum = Number(amareloAte)
  const valido =
    Number.isFinite(verdeNum) &&
    Number.isFinite(amareloNum) &&
    verdeNum > 0 &&
    amareloNum > verdeNum

  async function salvar() {
    if (!valido) return
    setSalvando(true)
    setErro(null)

    const { error } = await supabase
      .from('barracas')
      .update({ verde_ate: verdeNum, amarelo_ate: amareloNum })
      .eq('id', barraca.id)

    setSalvando(false)

    if (error) {
      setErro('Não foi possível salvar. Tente novamente.')
      return
    }

    setSalvo(true)
    window.setTimeout(() => setSalvo(false), 3000)
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
                value={verdeAte}
                onChange={(e) => setVerdeAte(e.target.value)}
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
                value={amareloAte}
                onChange={(e) => setAmareloAte(e.target.value)}
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
        {erro && <p className="mt-3 text-sm text-mesa-error-500">{erro}</p>}

        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" onClick={salvar} disabled={!valido} loading={salvando}>
            {salvo ? 'Salvo!' : 'Salvar faixas'}
          </Button>
        </div>
      </Card>
      <p className="mt-2 text-xs text-mesa-text-secondary">
        Definem quando o card muda de cor na Cozinha
      </p>
    </section>
  )
}

function SecaoPagamento({ barraca }: { barraca: Barraca }) {
  const [ativos, setAtivos] = useState<string[]>(
    barraca.metodos_pagamento_ativos ?? ['dinheiro', 'debito', 'credito', 'pix'],
  )
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvoMetodos, setSalvoMetodos] = useState(false)
  const debounceRef = useRef<number | null>(null)
  const salvoTimerRef = useRef<number | null>(null)

  const [textoDebito, setTextoDebito] = useState(() =>
    bpsParaPercentual(barraca.taxa_debito_bps ?? null),
  )
  const [textoCredito, setTextoCredito] = useState(() =>
    bpsParaPercentual(barraca.taxa_credito_bps ?? null),
  )
  const [invalidoDebito, setInvalidoDebito] = useState(false)
  const [invalidoCredito, setInvalidoCredito] = useState(false)
  const [salvoDebito, setSalvoDebito] = useState(false)
  const [salvoCredito, setSalvoCredito] = useState(false)

  const debounceDebitoRef = useRef<number | null>(null)
  const debounceCreditoRef = useRef<number | null>(null)
  const salvoDebitoTimerRef = useRef<number | null>(null)
  const salvoCreditoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
      if (debounceDebitoRef.current !== null) window.clearTimeout(debounceDebitoRef.current)
      if (debounceCreditoRef.current !== null) window.clearTimeout(debounceCreditoRef.current)
      if (salvoDebitoTimerRef.current !== null) window.clearTimeout(salvoDebitoTimerRef.current)
      if (salvoCreditoTimerRef.current !== null) window.clearTimeout(salvoCreditoTimerRef.current)
    }
  }, [])

  // useBarraca mostra a barraca em cache (localStorage) na hora e só troca
  // pela versão de verdade quando a busca de rede volta — sem isso, um
  // metodos_pagamento_ativos desatualizado do cache fica preso na tela até
  // um segundo reload. Só resincroniza se não há edição pendente (debounce
  // em voo), pra não sobrescrever um toque recém-feito pelo dono.
  useEffect(() => {
    if (debounceRef.current === null && barraca.metodos_pagamento_ativos) {
      setAtivos(barraca.metodos_pagamento_ativos)
    }
  }, [barraca.metodos_pagamento_ativos])

  // mesmo problema de cache desatualizado: resincroniza quando o valor de
  // verdade chega, mas nunca durante uma edição em voo (debounce pendente).
  useEffect(() => {
    if (debounceDebitoRef.current === null) {
      setTextoDebito(bpsParaPercentual(barraca.taxa_debito_bps ?? null))
      setInvalidoDebito(false)
    }
  }, [barraca.taxa_debito_bps])

  useEffect(() => {
    if (debounceCreditoRef.current === null) {
      setTextoCredito(bpsParaPercentual(barraca.taxa_credito_bps ?? null))
      setInvalidoCredito(false)
    }
  }, [barraca.taxa_credito_bps])

  function persistir(lista: string[]) {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(async () => {
      const { error } = await supabase
        .from('barracas')
        .update({ metodos_pagamento_ativos: lista })
        .eq('id', barraca.id)

      if (!error) {
        setSalvoMetodos(true)
        if (salvoTimerRef.current !== null) window.clearTimeout(salvoTimerRef.current)
        salvoTimerRef.current = window.setTimeout(() => setSalvoMetodos(false), 1000)
      }
    }, 500)
  }

  function alternar(chave: string) {
    const estaAtivo = ativos.includes(chave)

    if (estaAtivo && ativos.length === 1) {
      setAviso('Você precisa ter ao menos um método de pagamento ativo.')
      return
    }

    setAviso(null)
    const novaLista = estaAtivo ? ativos.filter((m) => m !== chave) : [...ativos, chave]
    setAtivos(novaLista)
    persistir(novaLista)
  }

  function aoMudarDebito(valor: string) {
    setTextoDebito(valor)

    const temCaracterInvalido = /[^\d.,\s-]/.test(valor)
    const bps = percentualParaBps(valor)
    const foraDoIntervalo = bps !== null && (bps < 0 || bps > BPS_MAX)
    const invalido = temCaracterInvalido || foraDoIntervalo
    setInvalidoDebito(invalido)

    if (debounceDebitoRef.current !== null) {
      window.clearTimeout(debounceDebitoRef.current)
      debounceDebitoRef.current = null
    }
    if (invalido) return

    debounceDebitoRef.current = window.setTimeout(async () => {
      debounceDebitoRef.current = null
      const { error } = await supabase
        .from('barracas')
        .update({ taxa_debito_bps: bps })
        .eq('id', barraca.id)

      if (!error) {
        setSalvoDebito(true)
        if (salvoDebitoTimerRef.current !== null) window.clearTimeout(salvoDebitoTimerRef.current)
        salvoDebitoTimerRef.current = window.setTimeout(() => setSalvoDebito(false), 1000)
      }
    }, 500)
  }

  function aoMudarCredito(valor: string) {
    setTextoCredito(valor)

    const temCaracterInvalido = /[^\d.,\s-]/.test(valor)
    const bps = percentualParaBps(valor)
    const foraDoIntervalo = bps !== null && (bps < 0 || bps > BPS_MAX)
    const invalido = temCaracterInvalido || foraDoIntervalo
    setInvalidoCredito(invalido)

    if (debounceCreditoRef.current !== null) {
      window.clearTimeout(debounceCreditoRef.current)
      debounceCreditoRef.current = null
    }
    if (invalido) return

    debounceCreditoRef.current = window.setTimeout(async () => {
      debounceCreditoRef.current = null
      const { error } = await supabase
        .from('barracas')
        .update({ taxa_credito_bps: bps })
        .eq('id', barraca.id)

      if (!error) {
        setSalvoCredito(true)
        if (salvoCreditoTimerRef.current !== null) window.clearTimeout(salvoCreditoTimerRef.current)
        salvoCreditoTimerRef.current = window.setTimeout(() => setSalvoCredito(false), 1000)
      }
    }, 500)
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

        <IndicadorSalvo salvo={salvoMetodos} />

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
              value={textoDebito}
              onChange={(e) => aoMudarDebito(e.target.value)}
              placeholder="0,00"
              aria-label="Taxa de débito"
              error={invalidoDebito ? 'Entre 0 e 50%' : undefined}
              className="mt-1"
            />
            <IndicadorSalvo salvo={salvoDebito} />
          </div>

          <div className="min-w-[140px] flex-1">
            <span className="text-sm text-mesa-text-secondary">Crédito</span>
            <Input
              type="percentage"
              size="sm"
              inputMode="decimal"
              value={textoCredito}
              onChange={(e) => aoMudarCredito(e.target.value)}
              placeholder="0,00"
              aria-label="Taxa de crédito"
              error={invalidoCredito ? 'Entre 0 e 50%' : undefined}
              className="mt-1"
            />
            <IndicadorSalvo salvo={salvoCredito} />
          </div>
        </div>
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
  onSucesso: (ambiente: AmbienteFiscal) => void
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

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_token_fiscal', {
      p_barraca_id: barracaId,
      p_ambiente: ambiente,
      p_token: token.trim(),
    })

    setProcessando(false)

    if (error) {
      setErro('Não foi possível salvar. Tente novamente.')
      return
    }

    fechar()
    onSucesso(ambiente)
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
function SecaoFiscal({ barraca }: { barraca: Barraca }) {
  const [habilitado, setHabilitado] = useState(barraca.fiscal_habilitado)
  const [regime, setRegime] = useState(barraca.fiscal_regime_tributario)
  const [ambiente, setAmbiente] = useState(barraca.fiscal_ambiente)
  const [cnpj, setCnpj] = useState(barraca.cnpj ?? '')
  const [salvoCnpj, setSalvoCnpj] = useState(false)
  const [tokensConfigurados, setTokensConfigurados] = useState({ homologacao: false, producao: false })
  const [sheetTokenAmbiente, setSheetTokenAmbiente] = useState<AmbienteFiscal | null>(null)

  useEffect(() => {
    let cancelado = false

    supabase
      .rpc('token_fiscal_configurado', { p_barraca_id: barraca.id })
      .then(({ data, error }) => {
        if (cancelado || error) return
        const linha = Array.isArray(data) ? data[0] : data
        if (linha) {
          setTokensConfigurados({
            homologacao: Boolean(linha.homologacao),
            producao: Boolean(linha.producao),
          })
        }
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  async function alternarHabilitado(valor: boolean) {
    setHabilitado(valor)
    await supabase.from('barracas').update({ fiscal_habilitado: valor }).eq('id', barraca.id)
  }

  async function salvarCnpj() {
    const limpo = cnpj.replace(/\D/g, '')
    const { error } = await supabase.from('barracas').update({ cnpj: limpo || null }).eq('id', barraca.id)
    if (!error) {
      setSalvoCnpj(true)
      window.setTimeout(() => setSalvoCnpj(false), 1000)
    }
  }

  async function escolherRegime(valor: RegimeTributario) {
    setRegime(valor)
    await supabase.from('barracas').update({ fiscal_regime_tributario: valor }).eq('id', barraca.id)
  }

  async function escolherAmbiente(valor: AmbienteFiscal) {
    setAmbiente(valor)
    await supabase.from('barracas').update({ fiscal_ambiente: valor }).eq('id', barraca.id)
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

        <div className="mt-4 flex items-end gap-2">
          <Input
            label="CNPJ (emitente)"
            value={cnpj}
            onChange={(e) => {
              setCnpj(e.target.value)
              setSalvoCnpj(false)
            }}
            onBlur={salvarCnpj}
            placeholder="00.000.000/0000-00"
            className="max-w-xs"
          />
          <IndicadorSalvo salvo={salvoCnpj} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-base text-mesa-text-primary">Fiscal habilitado</span>
          <Toggle checked={habilitado} onChange={alternarHabilitado} aria-label="Fiscal habilitado" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Regime tributário</p>
          <div className="flex flex-wrap gap-1.5">
            {REGIMES_TRIBUTARIOS.map((r) => (
              <Chip key={r.valor} checked={regime === r.valor} onClick={() => escolherRegime(r.valor)}>
                {r.rotulo}
              </Chip>
            ))}
          </div>
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
                  {tokensConfigurados.homologacao ? 'Configurado' : 'Não configurado'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSheetTokenAmbiente('homologacao')}>
                {tokensConfigurados.homologacao ? 'Trocar' : 'Definir'}
              </Button>
            </div>
            <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
              <div>
                <p className="text-sm text-mesa-text-primary">Produção</p>
                <p className="text-xs text-mesa-text-secondary">
                  {tokensConfigurados.producao ? 'Configurado' : 'Não configurado'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSheetTokenAmbiente('producao')}>
                {tokensConfigurados.producao ? 'Trocar' : 'Definir'}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <BottomSheetTokenFiscal
        barracaId={barraca.id}
        ambiente={sheetTokenAmbiente ?? 'homologacao'}
        open={sheetTokenAmbiente !== null}
        onClose={() => setSheetTokenAmbiente(null)}
        onSucesso={(ambienteSalvo) =>
          setTokensConfigurados((atual) => ({ ...atual, [ambienteSalvo]: true }))
        }
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

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_token_pagamento', {
      p_barraca_id: barracaId,
      p_token: token.trim(),
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
  const [habilitado, setHabilitado] = useState(barraca.pagamento_online_habilitado)
  const [tokenConfigurado, setTokenConfigurado] = useState(false)
  const [mostrarSheetToken, setMostrarSheetToken] = useState(false)

  useEffect(() => {
    let cancelado = false

    supabase
      .rpc('token_pagamento_configurado', { p_barraca_id: barraca.id })
      .then(({ data, error }) => {
        if (cancelado || error) return
        setTokenConfigurado(Boolean(data))
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  async function alternarHabilitado(valor: boolean) {
    setHabilitado(valor)
    await supabase.from('barracas').update({ pagamento_online_habilitado: valor }).eq('id', barraca.id)
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

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Access Token do Mercado Pago</p>
          <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
            <p className="text-xs text-mesa-text-secondary">
              {tokenConfigurado ? 'Configurado' : 'Não configurado'}
            </p>
            <Button variant="outline" size="sm" onClick={() => setMostrarSheetToken(true)}>
              {tokenConfigurado ? 'Trocar' : 'Definir'}
            </Button>
          </div>
        </div>
      </Card>

      <BottomSheetTokenPagamento
        barracaId={barraca.id}
        open={mostrarSheetToken}
        onClose={() => setMostrarSheetToken(false)}
        onSucesso={() => setTokenConfigurado(true)}
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

function Rodape({ barracaId }: { barracaId: string }) {
  const navigate = useNavigate()
  const { usuario, sair } = useAuth()
  const [mostrarModal, setMostrarModal] = useState(false)
  const [sucesso, setSucesso] = useState(false)
  const [confirmandoSaida, setConfirmandoSaida] = useState(false)

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
      setErroFaceId('Não foi possível ativar o Face ID neste aparelho. Tente de novo.')
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
            {faceIdLigado ? 'Desativar Face ID neste aparelho' : 'Ativar Face ID neste aparelho'}
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
