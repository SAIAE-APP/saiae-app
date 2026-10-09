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
import { cobrancaAtiva } from '../lib/cobranca'
import { MSG_SEM_INTERNET, mensagemErroSalvar, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { centavosParaReais, filtrarEntradaPreco, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import { apagarFotoItem, enviarFotoItem } from '../lib/fotoItem'
import { apagarLogoBarraca, enviarLogoBarraca } from '../lib/logoBarraca'
import { apagarCapaBarraca, enviarCapaBarraca } from '../lib/capaBarraca'
import { ativarFaceId, desativarFaceId, faceIdAtivado, faceIdSuportado } from '../lib/faceId'
import { urlPublica } from '../lib/urlPublica'
import { BPS_MAX, bpsParaPercentual, percentualParaBps } from '../lib/taxas'
import { ModalTrocarSenha } from '../components/ModalTrocarSenha'
import { SeletorMetodos } from '../components/SeletorMetodos'
import { GateSenhaAdmin } from '../components/GateSenhaAdmin'
import { SecaoImpressora } from '../components/SecaoImpressora'
import { SecaoBanners } from '../components/SecaoBanners'
import { SecaoHorarioFuncionamento } from '../components/SecaoHorarioFuncionamento'
import { SecaoAjudaSuporte } from '../components/SecaoAjudaSuporte'
import { BotaoSalvarCampo, ErroSalvar } from '../components/BotaoSalvarCampo'
import { SecaoModosAtendimento } from '../components/SecaoModosAtendimento'
import { SecaoTaxaEntrega } from '../components/SecaoTaxaEntrega'
import { SecaoBairrosEntrega } from '../components/SecaoBairrosEntrega'
import { SecaoIntegracaoCrm } from '../components/SecaoIntegracaoCrm'
import { SecaoOpcoes } from '../components/SecaoOpcoes'
import { SecaoClientesEntrega } from '../components/SecaoClientesEntrega'
import { SecaoPagarNaEntrega } from '../components/SecaoPagarNaEntrega'
import { SecaoPagamentoDepois } from '../components/SecaoPagamentoDepois'
import { SecaoEstoque } from '../components/SecaoEstoque'
import { SecaoCupons } from '../components/SecaoCupons'
import { SecaoAtendenteIa } from '../components/SecaoAtendenteIa'
import { mostrarAtendenteIa } from '../lib/visibilidadeIaCrm'
import {
  PROVEDORES_PIX_DISPONIVEIS,
  provedorPixDaBarraca,
  type ChaveProvedorPix,
  type ProvedorPixInfo,
} from '../lib/provedoresPix'
import { PIX_EXPIRACAO_OPCOES_MINUTOS, minutosExpiracaoPix } from '../lib/pixExpiracao'
import { SecaoAvisoPronto } from '../components/SecaoAvisoPronto'
import { EmitenteFiscal } from '../components/EmitenteFiscal'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Chip } from '../components/ui/Chip'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/useToast'
import { Textarea } from '../components/ui/Textarea'
import { Toggle } from '../components/ui/Toggle'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Badge } from '../components/ui/Badge'
import {
  avisoDeEstoque,
  controlaEstoque,
  interpretarAjuste,
  interpretarSaldoInicial,
  mensagemAjusteEstoque,
  rotuloMovimento,
} from '../lib/estoque'
import type { AmbienteFiscal, Barraca, Categoria, Item, MovimentoEstoque, RegimeTributario } from '../types/database'

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

function CampoToggle({
  rotulo,
  descricao,
  checked,
  onChange,
}: {
  rotulo: string
  descricao?: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-mesa-text-primary">{rotulo}</p>
        {descricao && <p className="text-xs text-mesa-text-secondary">{descricao}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={rotulo} />
    </div>
  )
}

/**
 * Formulário único de criar/editar item do cardápio. Nada salva sozinho:
 * tudo grava de uma vez pelo botão Salvar (regra de Ajustes), com erro real,
 * aviso offline e checagem de RLS (update que não afeta linha = erro).
 */
function BottomSheetItem({
  item,
  barracaId,
  categorias,
  proximaOrdem,
  onClose,
  onSalvo,
  onApagar,
}: {
  item: Item | 'novo' | null
  barracaId: string
  categorias: Categoria[]
  proximaOrdem: number
  onClose: () => void
  onSalvo: (item: Item) => void
  onApagar: (item: Item) => void
}) {
  const existente = item && item !== 'novo' ? item : null
  const [nome, setNome] = useState(() => existente?.nome ?? '')
  const [preco, setPreco] = useState(() => (existente ? textoPrecoInicial(existente.preco_centavos) : ''))
  const [categoriaId, setCategoriaId] = useState<string | null>(() => existente?.categoria_id ?? null)
  const [descricao, setDescricao] = useState(() => existente?.descricao ?? '')
  const [ativo, setAtivo] = useState(() => existente?.ativo ?? true)
  const [esgotado, setEsgotado] = useState(() => existente?.esgotado ?? false)
  const [popular, setPopular] = useState(() => existente?.popular ?? false)
  const [ncm, setNcm] = useState(() => existente?.ncm ?? '')
  const [cfop, setCfop] = useState(() => existente?.cfop ?? '')
  const [unidade, setUnidade] = useState(() => existente?.unidade_comercial ?? '')
  const [fotoUrl, setFotoUrl] = useState<string | null>(() => existente?.foto_url ?? null)
  const [fotoPendente, setFotoPendente] = useState<File | null>(null)
  const [previaPendente, setPreviaPendente] = useState<string | null>(null)
  const [enviandoFoto, setEnviandoFoto] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)
  // Estoque (Sprint 6): ligar/desligar o controle, saldo inicial e ajuste (+ repõe, - baixa).
  const jaControla = existente ? controlaEstoque(existente) : false
  const [controla, setControla] = useState(jaControla)
  const [saldoInicial, setSaldoInicial] = useState('')
  const [ajusteTexto, setAjusteTexto] = useState('')
  const [movimentos, setMovimentos] = useState<MovimentoEstoque[] | null>(null)
  const existenteId = existente?.id ?? null

  useEffect(() => {
    return () => {
      if (previaPendente) URL.revokeObjectURL(previaPendente)
    }
  }, [previaPendente])

  // Últimas movimentações do item (só com o controle ligado): barato e ajuda a conferir.
  useEffect(() => {
    if (!existenteId || !jaControla) return
    let cancelado = false
    supabase
      .from('movimentos_estoque')
      .select('*')
      .eq('item_id', existenteId)
      .order('criado_em', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (!cancelado && !error) setMovimentos((data ?? []) as MovimentoEstoque[])
      })
    return () => {
      cancelado = true
    }
  }, [existenteId, jaControla])

  if (!item) return null

  const ligandoControle = controla && !jaControla
  const desligandoControle = !controla && jaControla
  const ajusteValor = jaControla && controla ? interpretarAjuste(ajusteTexto) : null
  const ajusteInvalido = jaControla && controla && ajusteTexto.trim() !== '' && ajusteValor === null

  const alterado = existente
    ? nome.trim() !== existente.nome ||
      reaisParaCentavos(preco) !== existente.preco_centavos ||
      categoriaId !== (existente.categoria_id ?? null) ||
      descricao.trim() !== (existente.descricao ?? '') ||
      ativo !== existente.ativo ||
      esgotado !== existente.esgotado ||
      popular !== existente.popular ||
      ncm.trim() !== (existente.ncm ?? '') ||
      cfop.trim() !== (existente.cfop ?? '') ||
      unidade.trim() !== (existente.unidade_comercial ?? '') ||
      fotoUrl !== (existente.foto_url ?? null) ||
      controla !== jaControla ||
      ajusteValor !== null
    : true
  const podeSalvar =
    nome.trim().length > 0 &&
    alterado &&
    !salvando &&
    !enviandoFoto &&
    !(ligandoControle && saldoInicial.trim() !== '' && interpretarSaldoInicial(saldoInicial) === null) &&
    !ajusteInvalido

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    setErro(null)

    // Item novo ainda não tem id: guarda o arquivo e sobe depois de criar.
    if (!existente) {
      setFotoPendente(arquivo)
      setPreviaPendente(URL.createObjectURL(arquivo))
      return
    }

    setEnviandoFoto(true)
    try {
      const urlAntiga = fotoUrl
      const novaUrl = await enviarFotoItem(barracaId, existente.id, arquivo)
      setFotoUrl(novaUrl)
      // Só apaga do Storage a foto enviada nesta edição; a original só sai depois do Salvar.
      if (urlAntiga && urlAntiga !== existente.foto_url) apagarFotoItem(urlAntiga)
    } catch {
      setErro('Não foi possível enviar a foto. Tente novamente.')
    }
    setEnviandoFoto(false)
  }

  function removerFoto() {
    setErro(null)
    if (fotoPendente) {
      setFotoPendente(null)
      setPreviaPendente(null)
      return
    }
    setFotoUrl(null)
  }

  async function salvar() {
    if (!podeSalvar) return
    if (navigator.onLine === false) {
      setErro(MSG_SEM_INTERNET)
      return
    }

    setSalvando(true)
    setErro(null)

    const campos: Record<string, unknown> = {
      nome: nome.trim(),
      preco_centavos: reaisParaCentavos(preco),
      categoria_id: categoriaId,
      descricao: descricao.trim() || null,
      ativo,
      esgotado,
      popular,
      ncm: ncm.trim() || null,
      cfop: cfop.trim() || null,
      unidade_comercial: unidade.trim() || null,
      foto_url: fotoUrl,
    }
    // O dono mexeu no "Esgotado" à mão: deixa de ser esgotado automático (o sistema
    // não o desmarca sozinho quando o saldo voltar).
    if (existente && esgotado !== existente.esgotado) campos.estoque_esgotado_auto = false
    // Desligou o controle: o saldo some e o esgotado que era automático também.
    if (desligandoControle && existente) {
      campos.estoque_qtd = null
      campos.estoque_esgotado_auto = false
      if (existente.estoque_esgotado_auto && esgotado === existente.esgotado) campos.esgotado = false
    }

    let salvoItem: Item | null = null
    let mensagem: string | null = null
    try {
      if (existente) {
        const { data, error } = await supabase
          .from('itens')
          .update(campos)
          .eq('id', existente.id)
          .select()
        if (error) mensagem = mensagemErroSalvar(error)
        else if (!data || data.length === 0)
          mensagem = 'Não foi possível salvar: sem permissão para alterar este item.'
        else salvoItem = data[0] as Item
      } else {
        const { data, error } = await supabase
          .from('itens')
          .insert({ ...campos, barraca_id: barracaId, ordem: proximaOrdem })
          .select()
          .single()
        if (error) mensagem = mensagemErroSalvar(error)
        else salvoItem = data as Item
      }
    } catch (e) {
      mensagem = mensagemErroSalvar(e instanceof Error ? e : null)
    }

    if (!salvoItem) {
      setSalvando(false)
      setErro(mensagem ?? 'Não foi possível salvar. Tente novamente.')
      return
    }

    if (fotoPendente) {
      try {
        const url = await enviarFotoItem(barracaId, salvoItem.id, fotoPendente)
        const { error } = await supabase.from('itens').update({ foto_url: url }).eq('id', salvoItem.id)
        if (!error) salvoItem = { ...salvoItem, foto_url: url }
      } catch {
        // Item já foi criado; só a foto falhou — o dono tenta de novo editando.
      }
    }

    // Foto antiga só é apagada do Storage depois que o banco confirmou.
    if (existente?.foto_url && existente.foto_url !== fotoUrl) apagarFotoItem(existente.foto_url)

    // Estoque: ligar o controle (saldo inicial) ou ajustar o saldo. É um segundo passo
    // (RPC atômica no banco); se falhar o item já está salvo e o erro fica na tela.
    let erroEstoque: string | null = null
    if (ligandoControle || ajusteValor !== null) {
      try {
        if (ligandoControle && (interpretarSaldoInicial(saldoInicial) ?? 0) === 0) {
          // Saldo 0 não é um "ajuste": liga o controle já zerado (e esgotado pelo sistema).
          const { error } = await supabase
            .from('itens')
            .update({ estoque_qtd: 0, esgotado: true, estoque_esgotado_auto: !salvoItem.esgotado })
            .eq('id', salvoItem.id)
          if (error) erroEstoque = mensagemErroSalvar(error)
        } else {
          const delta = ligandoControle ? (interpretarSaldoInicial(saldoInicial) as number) : (ajusteValor as number)
          const { data, error } = await supabase.rpc('ajustar_estoque', {
            p_item_id: salvoItem.id,
            p_delta: delta,
            p_motivo: ligandoControle ? 'Saldo inicial' : 'Ajuste manual',
          })
          const estado = (data as { estado?: string } | null)?.estado
          if (error) erroEstoque = mensagemErroSalvar(error)
          else if (estado !== 'ok') erroEstoque = mensagemAjusteEstoque(estado)
        }
        if (!erroEstoque) {
          const { data: atualizado } = await supabase.from('itens').select('*').eq('id', salvoItem.id).single()
          if (atualizado) salvoItem = atualizado as Item
        }
      } catch (e) {
        erroEstoque = mensagemErroSalvar(e instanceof Error ? e : null)
      }
    }

    setSalvando(false)
    onSalvo(salvoItem)
    if (erroEstoque) {
      setErro(`O item foi salvo, mas o estoque não foi atualizado. ${erroEstoque}`)
      return
    }
    onClose()
  }

  const previa = previaPendente ?? fotoUrl

  return (
    <BottomSheet
      open
      onClose={onClose}
      aria-label={existente ? `Editar ${existente.nome}` : 'Novo item'}
      className="md:mx-auto md:max-w-lg"
    >
      <h2 className="text-lg font-semibold text-mesa-text-primary">
        {existente ? 'Editar item' : 'Novo item'}
      </h2>

      <div className="mt-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
            {previa ? (
              <img src={previa} alt="" className="size-full object-cover" />
            ) : (
              <Icone nome="image" size={24} />
            )}
          </span>
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              size="md"
              icon={<Icone nome="photo_camera" size={16} />}
              loading={enviandoFoto}
              onClick={() => inputArquivoRef.current?.click()}
            >
              {previa ? 'Trocar foto' : 'Adicionar foto'}
            </Button>
            {previa && (
              <Button variant="textDanger" size="sm" onClick={removerFoto}>
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

        <Input
          autoFocus={!existente}
          label="Nome do item"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Yakisoba"
          className="w-full"
        />

        <Input
          type="currency"
          label="Preço"
          inputMode="decimal"
          value={preco}
          onChange={(e) => setPreco(filtrarEntradaPreco(e.target.value))}
          placeholder="0,00"
          className="w-full"
        />

        <div>
          <p className="mb-1.5 text-xs font-semibold text-mesa-neutral-700 dark:text-mesa-neutral-300">
            Categoria
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip checked={categoriaId === null} onClick={() => setCategoriaId(null)}>
              Sem categoria
            </Chip>
            {categorias.map((c) => (
              <Chip key={c.id} checked={categoriaId === c.id} onClick={() => setCategoriaId(c.id)}>
                {c.nome}
              </Chip>
            ))}
          </div>
          {categorias.length === 0 && (
            <p className="mt-2 text-xs text-mesa-text-secondary">
              Nenhuma categoria ainda. Crie em "Categorias", no topo do cardápio.
            </p>
          )}
        </div>

        <Textarea
          label="Descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ingredientes, tamanho, o que vem no prato..."
          rows={3}
        />

        <div className="divide-y divide-mesa-border-subtle">
          <CampoToggle
            rotulo="Ativo"
            descricao="Aparece no Lançar Pedido e no cardápio digital"
            checked={ativo}
            onChange={() => setAtivo((v) => !v)}
          />
          <CampoToggle
            rotulo="Esgotado"
            descricao="Não deixa adicionar ao pedido"
            checked={esgotado}
            onChange={() => setEsgotado((v) => !v)}
          />
          <CampoToggle
            rotulo="Popular"
            descricao="Destaca em Populares no cardápio digital"
            checked={popular}
            onChange={() => setPopular((v) => !v)}
          />
        </div>

        <div className="rounded-mesa-md border border-mesa-border-default px-3 py-1">
          <CampoToggle
            rotulo="Controlar estoque"
            descricao="Baixa sozinho a cada venda, devolve ao cancelar e marca Esgotado quando zerar"
            checked={controla}
            onChange={() => setControla((v) => !v)}
          />
          {ligandoControle && (
            <div className="pb-3 pt-1">
              <Input
                label="Quantidade em estoque agora"
                inputMode="numeric"
                value={saldoInicial}
                onChange={(e) => setSaldoInicial(e.target.value)}
                placeholder="0"
                className="w-full"
              />
              <p className="mt-1 text-xs text-mesa-text-secondary">
                Pode vender além do saldo: o estoque fica negativo e o app avisa.
              </p>
            </div>
          )}
          {jaControla && controla && existente && (
            <div className="pb-3 pt-1">
              <p className="text-sm text-mesa-text-primary">
                Saldo atual: <span className="font-mesa-display font-bold">{existente.estoque_qtd}</span>
              </p>
              {avisoDeEstoque(existente) && (
                <p
                  className={clsx(
                    'mt-1 text-xs font-semibold',
                    avisoDeEstoque(existente)?.destaque === 'erro'
                      ? 'text-mesa-error-500'
                      : 'text-mesa-warning-700 dark:text-mesa-warning-500',
                  )}
                >
                  {avisoDeEstoque(existente)?.texto}
                </p>
              )}
              <Input
                label="Repor ou ajustar (10 repõe, -2 baixa)"
                inputMode="text"
                value={ajusteTexto}
                onChange={(e) => setAjusteTexto(e.target.value)}
                placeholder="Ex.: 10"
                error={ajusteInvalido ? 'Use um número inteiro, como 10 ou -2.' : undefined}
                className="mt-3 w-full"
              />
              {movimentos && movimentos.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-mesa-text-secondary">Últimas movimentações</p>
                  <ul className="flex flex-col gap-1">
                    {movimentos.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-xs text-mesa-text-secondary">
                        <span className="min-w-0 truncate">
                          {rotuloMovimento(m.motivo)}
                          {m.observacao ? ` · ${m.observacao}` : ''} ·{' '}
                          {new Date(m.criado_em).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="shrink-0 font-mesa-display font-semibold text-mesa-text-primary">
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                          {m.saldo_apos !== null ? ` → ${m.saldo_apos}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <details className="group rounded-mesa-md border border-mesa-border-default">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-sm font-medium text-mesa-text-primary">
            Dados fiscais (opcional)
            <Icone nome="expand_more" size={18} className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-3 gap-2 px-3 pb-3">
            <Input
              label="NCM"
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="21069090"
              className="min-w-0"
            />
            <Input
              label="CFOP"
              value={cfop}
              onChange={(e) => setCfop(e.target.value)}
              placeholder="5101"
              className="min-w-0"
            />
            <Input
              label="Unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              placeholder="un"
              className="min-w-0"
            />
          </div>
        </details>

        {erro && (
          <p role="alert" className="text-sm font-medium text-mesa-error-500">
            {erro}
          </p>
        )}

        {existente && (
          <Button
            variant="textDanger"
            size="md"
            icon={<Icone nome="delete" size={16} />}
            onClick={() => onApagar(existente)}
            className="self-start"
          >
            Apagar item
          </Button>
        )}
      </div>

      <div className="sticky -bottom-6 -mx-6 mt-4 grid grid-cols-2 gap-3 border-t border-mesa-border-subtle bg-mesa-surface px-6 pb-6 pt-3">
        <Button variant="ghost" size="lg" onClick={onClose}>
          Cancelar
        </Button>
        <Button size="lg" loading={salvando} disabled={!podeSalvar} onClick={salvar}>
          {existente ? 'Salvar' : 'Adicionar'}
        </Button>
      </div>
    </BottomSheet>
  )
}

function SecaoCardapio({ barracaId }: { barracaId: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [itemForm, setItemForm] = useState<Item | 'novo' | null>(null)
  const [reordenando, setReordenando] = useState(false)

  const [itemParaExcluir, setItemParaExcluir] = useState<Item | null>(null)
  const [nomeExclusao, setNomeExclusao] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const { mostrarToast } = useToast()
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false)
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

  function aoSalvarItem(salvo: Item) {
    setItens((atual) =>
      atual.some((i) => i.id === salvo.id)
        ? atual.map((i) => (i.id === salvo.id ? salvo : i))
        : [...atual, salvo],
    )
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
      {/* Mobile: título em cima e os dois botões dividindo a largura
          embaixo (lado a lado com o título eles vazavam da tela em 375px). */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <RotuloSecao icone="restaurant">Cardápio</RotuloSecao>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="md"
            icon={<Icone nome="category" size={16} />}
            onClick={() => setGerenciandoCategorias(true)}
            className="flex-1 sm:flex-none"
          >
            Categorias
          </Button>
          <Button
            size="md"
            icon={<Icone nome="add" size={16} />}
            onClick={() => setItemForm('novo')}
            className="flex-1 sm:flex-none"
          >
            Novo item
          </Button>
        </div>
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
                  className="flex items-center gap-1"
                >
                  {reordenando && (
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
                  )}
                  <button
                    type="button"
                    onClick={() => setItemForm(item)}
                    aria-label={`Editar ${item.nome}`}
                    className={clsx(
                      'flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left outline-none focus-visible:[box-shadow:var(--mesa-focus-ring-primary)]',
                      !item.ativo && 'opacity-60',
                    )}
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-mesa-md bg-mesa-neutral-100 text-mesa-text-tertiary dark:bg-mesa-neutral-700">
                      {item.foto_url ? (
                        <img src={item.foto_url} alt="" className="size-full object-cover" />
                      ) : (
                        <Icone nome="image" size={20} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-mesa-text-primary">
                        {item.nome}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mesa-text-secondary">
                        <span className="truncate">{nomeCategoria(item.categoria_id)}</span>
                        {item.popular && (
                          <Badge variant="highlight" className="px-2 py-0.5">
                            Popular
                          </Badge>
                        )}
                        {item.esgotado && (
                          <Badge variant="danger" className="px-2 py-0.5">
                            Esgotado
                          </Badge>
                        )}
                        {!item.ativo && (
                          <Badge variant="neutral" className="px-2 py-0.5">
                            Inativo
                          </Badge>
                        )}
                        {controlaEstoque(item) && (
                          <Badge
                            variant={
                              avisoDeEstoque(item)?.destaque === 'erro'
                                ? 'danger'
                                : avisoDeEstoque(item)
                                  ? 'warning'
                                  : 'neutral'
                            }
                            className="px-2 py-0.5"
                          >
                            {avisoDeEstoque(item)?.nivel === 'negativo'
                              ? `Estoque negativo (${item.estoque_qtd}): vendido além do saldo`
                              : `Estoque: ${item.estoque_qtd}`}
                          </Badge>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 font-mesa-display text-base font-semibold text-mesa-text-primary">
                      {formatarPrecoBR(item.preco_centavos)}
                    </span>
                  </button>
                  {reordenando && (
                    <div className="flex shrink-0">
                      <button
                        type="button"
                        onClick={() => moverItem(item.id, -1)}
                        disabled={indice === 0}
                        aria-label={`Mover ${item.nome} para cima`}
                        className="flex size-11 items-center justify-center text-sm text-mesa-text-secondary disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moverItem(item.id, 1)}
                        disabled={indice === itens.length - 1}
                        aria-label={`Mover ${item.nome} para baixo`}
                        className="flex size-11 items-center justify-center text-sm text-mesa-text-secondary disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {itens.length > 1 && (
              <Button
                variant="ghost"
                size="md"
                icon={<Icone nome="swap_vert" size={16} />}
                onClick={() => setReordenando((v) => !v)}
                className="mt-2 w-full"
              >
                {reordenando ? 'Concluir ordem' : 'Reordenar'}
              </Button>
            )}
          </>
        )}
      </Card>

      <BottomSheetItem
        key={itemForm === 'novo' ? 'novo' : (itemForm?.id ?? 'fechado')}
        item={itemForm}
        barracaId={barracaId}
        categorias={categorias}
        proximaOrdem={itens.length > 0 ? Math.max(...itens.map((i) => i.ordem)) + 1 : 1}
        onClose={() => setItemForm(null)}
        onSalvo={aoSalvarItem}
        onApagar={(item) => {
          setItemForm(null)
          pedirExclusao(item)
        }}
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

        <SeletorMetodos ativos={ativos} onAlternar={alternar} />

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

        <EmitenteFiscal barraca={barraca} />

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
  provedor,
  open,
  onClose,
  onSucesso,
}: {
  barracaId: string
  provedor: ProvedorPixInfo
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
      setErro(`Cole o ${provedor.rotuloToken} gerado no painel do ${provedor.nome}`)
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
      p_provedor: provedor.chave,
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
    <BottomSheet open={open} onClose={fechar} aria-label={`${provedor.rotuloToken} do ${provedor.nome}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">
        {provedor.rotuloToken} do {provedor.nome}
      </h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        {provedor.ondeAcharToken} Fica guardado só pra uso do sistema, não é mostrado de novo depois de
        salvo.
      </p>

      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <Input
          label={provedor.rotuloToken}
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

/** Segredo de assinatura do webhook (opcional). Com ele cadastrado, notificação de
 * pagamento com assinatura inválida é rejeitada. Fica guardado só no servidor. */
function BottomSheetSegredoWebhook({
  barracaId,
  provedor,
  open,
  onClose,
  onSucesso,
}: {
  barracaId: string
  provedor: ProvedorPixInfo
  open: boolean
  onClose: () => void
  onSucesso: () => void
}) {
  const [segredo, setSegredo] = useState('')
  const [processando, setProcessando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function fechar() {
    setSegredo('')
    setErro(null)
    onClose()
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (processando) return

    if (!segredo.trim()) {
      setErro('Cole a assinatura secreta gerada no painel do ' + provedor.nome)
      return
    }
    if (navigator.onLine === false) {
      setErro(MSG_SEM_INTERNET)
      return
    }

    setProcessando(true)
    setErro(null)

    const { error } = await supabase.rpc('definir_segredo_webhook_pagamento', {
      p_barraca_id: barracaId,
      p_segredo: segredo.trim(),
      p_provedor: provedor.chave,
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
    <BottomSheet open={open} onClose={fechar} aria-label={`Assinatura do webhook do ${provedor.nome}`}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">Assinatura do webhook do {provedor.nome}</h2>
      <p className="mt-1 text-sm text-mesa-text-secondary">
        Opcional. Se você ativou a assinatura das notificações no painel do {provedor.nome} (Webhooks → assinatura
        secreta), cole aqui. Notificações com assinatura inválida passam a ser rejeitadas. Se não cadastrar, o
        pagamento continua sendo confirmado direto no {provedor.nome}, como hoje.
      </p>

      <form onSubmit={salvar} className="mt-4 flex flex-col gap-4">
        <Input
          label="Assinatura secreta"
          type="password"
          autoComplete="off"
          autoFocus
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
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
  // Validade do QR do Pix (35..60 min; ausente = 35, o comportamento de sempre).
  const expiracaoR = useRascunho(minutosExpiracaoPix(barraca.pix_expiracao_minutos))
  const salvarExpiracao = useSalvarBarraca(barraca)
  // Provedor do Pix. Hoje só o Mercado Pago está publicado; o seletor aparece sozinho
  // quando houver mais de um disponível (próximas stories).
  const provedorR = useRascunho(provedorPixDaBarraca(barraca.pagamento_provedor).chave)
  const provedor = provedorPixDaBarraca(provedorR.valor)
  const salvarProvedor = useSalvarBarraca(barraca)
  const [tokenConfigurado, setTokenConfigurado] = useState<boolean | null>(null)
  const [erroToken, setErroToken] = useState<string | null>(null)
  const [recargaToken, setRecargaToken] = useState(0)
  const [mostrarSheetToken, setMostrarSheetToken] = useState(false)
  // Segredo de assinatura do webhook (opcional): só o servidor guarda; aqui só "configurado?".
  const [segredoConfigurado, setSegredoConfigurado] = useState<boolean | null>(null)
  const [recargaSegredo, setRecargaSegredo] = useState(0)
  const [mostrarSheetSegredo, setMostrarSheetSegredo] = useState(false)

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('segredo_webhook_configurado', { p_barraca_id: barraca.id, p_provedor: provedor.chave })
      .then(({ data, error }) => {
        if (cancelado) return
        setSegredoConfigurado(error ? null : Boolean(data))
      })
    return () => {
      cancelado = true
    }
  }, [barraca.id, provedor.chave, recargaSegredo])

  // Mesmo princípio do Fiscal: "configurado" é o que o banco responde.
  useEffect(() => {
    let cancelado = false

    supabase
      .rpc('token_pagamento_configurado', { p_barraca_id: barraca.id, p_provedor: provedor.chave })
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
  }, [barraca.id, provedor.chave, recargaToken])

  async function trocarProvedor(chave: string) {
    provedorR.definir(chave as ChaveProvedorPix)
    setTokenConfigurado(null)
    await salvarProvedor.salvar({ pagamento_provedor: chave })
    provedorR.descartar()
  }

  async function trocarExpiracao(minutos: number) {
    expiracaoR.definir(minutos)
    await salvarExpiracao.salvar({ pix_expiracao_minutos: minutos })
    expiracaoR.descartar()
  }

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
          {provedor.descricaoConta} — o dinheiro do Pix cai direto na sua conta, o Sai aê nunca guarda
          nem repassa esse valor. Só depois do pagamento confirmado o pedido feito no cardápio digital
          cai na Cozinha.
        </p>

        {PROVEDORES_PIX_DISPONIVEIS.length > 1 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-mesa-text-primary">Provedor do Pix</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Provedor do Pix">
              {PROVEDORES_PIX_DISPONIVEIS.map((p) => (
                <Chip
                  key={p.chave}
                  checked={provedor.chave === p.chave}
                  onClick={() => void trocarProvedor(p.chave)}
                >
                  {p.nome}
                </Chip>
              ))}
            </div>
            <ErroSalvar erro={salvarProvedor.erro} className="mt-2" />
          </div>
        )}

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
          <p className="mb-1 text-sm font-medium text-mesa-text-primary">Validade do QR Code do Pix</p>
          <p className="mb-2 text-xs text-mesa-text-secondary">
            Depois desse prazo o cliente precisa gerar um novo Pix. O mínimo é 35 minutos (regra do Mercado Pago).
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Validade do QR Code do Pix">
            {PIX_EXPIRACAO_OPCOES_MINUTOS.map((minutos) => (
              <Chip
                key={minutos}
                checked={expiracaoR.valor === minutos}
                onClick={() => void trocarExpiracao(minutos)}
              >
                {minutos} min
              </Chip>
            ))}
          </div>
          <ErroSalvar erro={salvarExpiracao.erro} className="mt-2" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">
            {provedor.rotuloToken} do {provedor.nome}
          </p>
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

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Assinatura do webhook (opcional)</p>
          <div className="flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-mesa-md border border-mesa-border-subtle p-3">
            <p className="text-xs text-mesa-text-secondary">
              {segredoConfigurado === null ? 'Não verificado' : segredoConfigurado ? 'Configurada' : 'Não configurada'}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!tokenConfigurado}
              onClick={() => setMostrarSheetSegredo(true)}
            >
              {segredoConfigurado ? 'Trocar' : 'Definir'}
            </Button>
          </div>
          {!tokenConfigurado && (
            <p className="mt-1 text-xs text-mesa-text-secondary">Defina o token antes.</p>
          )}
        </div>
      </Card>

      <BottomSheetSegredoWebhook
        barracaId={barraca.id}
        provedor={provedor}
        open={mostrarSheetSegredo}
        onClose={() => setMostrarSheetSegredo(false)}
        onSucesso={() => setRecargaSegredo((n) => n + 1)}
      />

      <BottomSheetTokenPagamento
        barracaId={barraca.id}
        provedor={provedor}
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

  const rotuloStatus = !cobrancaAtiva(assinatura)
    ? 'Cobrança desativada por enquanto'
    : assinatura.status === 'trialing'
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
            <SecaoOpcoes barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoBanners barracaId={barraca.id} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoHorarioFuncionamento barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoModosAtendimento barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoTaxaEntrega barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoBairrosEntrega barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoClientesEntrega barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoEstoque barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoPagarNaEntrega barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoPagamentoDepois barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoCupons barraca={barraca} />
          </SecaoDaCategoria>
          {/* Escondida para cliente novo (decisão 2026-10-09); quem já tem a IA ligada vê, e VITE_MOSTRAR_ATENDENTE_IA=1 reabre. */}
          {mostrarAtendenteIa(barraca, import.meta.env.VITE_MOSTRAR_ATENDENTE_IA) && (
            <SecaoDaCategoria categoria="cardapio" atual={categoria}>
              <SecaoAtendenteIa barraca={barraca} />
            </SecaoDaCategoria>
          )}
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoAvisoPronto barraca={barraca} />
          </SecaoDaCategoria>
          <SecaoDaCategoria categoria="cardapio" atual={categoria}>
            <SecaoIntegracaoCrm barraca={barraca} />
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
