import { useCallback, useEffect, useMemo, useState } from 'react'
import { MSG_SEM_INTERNET, useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { apagarGrupo, carregarCadastro, salvarGrupo, type CadastroDeOpcoes } from '../lib/opcoesDados'
import {
  avisosDoRascunho,
  duplicarRascunho,
  itensBloqueadosPorVariacao,
  itensIndisponiveis,
  MODELOS_DE_GRUPO,
  opcaoVazia,
  rascunhoDoGrupo,
  rascunhoVazio,
  resumoDoGrupo,
  validarRascunho,
  type RascunhoGrupo,
  type RascunhoOpcao,
} from '../lib/opcoesCadastro'
import { filtrarEntradaPreco } from '../lib/preco'
import { bancoSemRecurso } from '../lib/semMigration'
import { ErroSalvar } from './BotaoSalvarCampo'
import { BottomSheet } from './ui/BottomSheet'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Checkbox } from './ui/Checkbox'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { SegmentedControl } from './ui/SegmentedControl'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

type Edicao = { grupoId: string | null; rascunho: RascunhoGrupo }

function mensagemDeCarga(erro: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return MSG_SEM_INTERNET
  return `Não foi possível carregar as opções: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`
}

/**
 * Variações (tamanho, sabor) e adicionais dos itens do cardápio (SAI-010a). Regras da v1: no máximo uma
 * variação por item (escolha única, preço absoluto que substitui o do item); adicionais somam, com
 * limite de escolhas e obrigatório/opcional. Salva por botão, com erro real na tela. Item sem grupo
 * continua simples. A chave "usar no cardápio" é por loja e começa desligada.
 */
export function SecaoOpcoes({ barraca }: { barraca: Barraca }) {
  const [cadastro, setCadastro] = useState<CadastroDeOpcoes | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  // Banco sem as tabelas de opções (app no ar antes da migration): a seção some, sem erro.
  const [semBanco, setSemBanco] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [paraApagar, setParaApagar] = useState<string | null>(null)
  const [apagando, setApagando] = useState(false)
  const [escolhendoModelo, setEscolhendoModelo] = useState(false)

  const habilitadoR = useRascunho(Boolean(barraca.opcoes_habilitado))
  const flag = useSalvarBarraca(barraca)

  useEffect(() => {
    let cancelado = false
    carregarCadastro(barraca.id)
      .then((c) => {
        if (cancelado) return
        setCadastro(c)
        setErroCarga(null)
      })
      .catch((e) => {
        if (cancelado) return
        if (bancoSemRecurso(e)) setSemBanco(true)
        else setErroCarga(mensagemDeCarga(e))
      })
    return () => {
      cancelado = true
    }
  }, [barraca.id, recarga])

  const recarregar = useCallback(() => setRecarga((n) => n + 1), [])

  const indisponiveis = useMemo(
    () => (cadastro ? itensIndisponiveis(cadastro.grupos, cadastro.opcoes, cadastro.ligacoes) : new Map<string, string>()),
    [cadastro],
  )

  async function alternarFlag(valor: boolean) {
    habilitadoR.definir(valor)
    await flag.salvar({ opcoes_habilitado: valor })
    habilitadoR.descartar() // volta ao valor do servidor (em erro, o aviso fica visível abaixo)
  }

  function abrir(grupoId: string | null, rascunho: RascunhoGrupo) {
    setErroSalvar(null)
    setEdicao({ grupoId, rascunho })
  }

  async function aoSalvar() {
    if (!edicao || !cadastro) return
    const erros = validarRascunho(edicao.rascunho)
    if (erros.length > 0) {
      setErroSalvar(erros.join(' '))
      return
    }
    setSalvando(true)
    setErroSalvar(null)
    try {
      const ordemNova = cadastro.grupos.reduce((m, g) => Math.max(m, g.ordem), -1) + 1
      const atuais = edicao.grupoId ? cadastro.ligacoes.filter((l) => l.grupo_id === edicao.grupoId).map((l) => l.item_id) : []
      await salvarGrupo(barraca.id, edicao.grupoId, edicao.rascunho, { ordemNova, ligacoesAtuais: atuais })
      setEdicao(null)
      recarregar()
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarApagar() {
    if (!paraApagar) return
    setApagando(true)
    try {
      await apagarGrupo(barraca.id, paraApagar)
      setParaApagar(null)
      setEdicao(null)
      recarregar()
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : 'Não foi possível apagar.')
      setParaApagar(null)
    } finally {
      setApagando(false)
    }
  }

  const r = edicao?.rascunho
  const avisos = r ? avisosDoRascunho(r) : []
  const bloqueados = useMemo(
    () =>
      r && cadastro && r.tipo === 'variacao'
        ? itensBloqueadosPorVariacao(edicao?.grupoId ?? null, cadastro.grupos, cadastro.ligacoes)
        : new Set<string>(),
    [r, cadastro, edicao?.grupoId],
  )

  function atualizar(parcial: Partial<RascunhoGrupo>) {
    setEdicao((e) => (e ? { ...e, rascunho: { ...e.rascunho, ...parcial } } : e))
  }
  function atualizarOpcao(indice: number, parcial: Partial<RascunhoOpcao>) {
    setEdicao((e) =>
      e ? { ...e, rascunho: { ...e.rascunho, opcoes: e.rascunho.opcoes.map((o, i) => (i === indice ? { ...o, ...parcial } : o)) } } : e,
    )
  }
  function alternarItem(itemId: string, marcado: boolean) {
    setEdicao((e) => {
      if (!e) return e
      const ids = marcado ? [...e.rascunho.itemIds, itemId] : e.rascunho.itemIds.filter((id) => id !== itemId)
      return { ...e, rascunho: { ...e.rascunho, itemIds: ids } }
    })
  }

  if (semBanco) return null

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="checklist" size={14} />
        Variações e adicionais
      </h2>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-mesa-text-primary">Usar no cardápio digital</p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {habilitadoR.valor
                ? 'Ligado: itens com grupos pedem as escolhas ao cliente (tamanho, extras).'
                : 'Desligado: todos os itens são vendidos com um preço só, como sempre.'}
            </p>
            {!habilitadoR.valor && (
              <p className="mt-1 text-xs text-mesa-text-tertiary">
                Antes de ligar, cadastre os grupos abaixo e confira que os aparelhos da barraca estão atualizados.
              </p>
            )}
          </div>
          <Toggle
            checked={habilitadoR.valor}
            onChange={(v) => void alternarFlag(v)}
            disabled={flag.salvando}
            aria-label="Usar variações e adicionais no cardápio digital"
          />
        </div>
        <ErroSalvar erro={flag.erro} className="mt-2" />

        {erroCarga && <ErroSalvar erro={erroCarga} className="mt-3" />}
        {!cadastro && !erroCarga && <p className="mt-4 text-sm text-mesa-text-secondary">Carregando…</p>}

        {cadastro && (
          <>
            {indisponiveis.size > 0 && (
              <p role="status" className="mt-4 rounded-mesa-md bg-mesa-orange-500/15 p-3 text-sm text-mesa-text-primary">
                {indisponiveis.size === 1 ? '1 item está indisponível' : `${indisponiveis.size} itens estão indisponíveis`} no
                cardápio porque um grupo obrigatório ficou sem opção disponível:{' '}
                {[...new Set(indisponiveis.values())].map((n) => `"${n}"`).join(', ')}.
              </p>
            )}

            <ul className="mt-4 divide-y divide-mesa-border-subtle">
              {cadastro.grupos.map((g) => {
                const qtdItens = cadastro.ligacoes.filter((l) => l.grupo_id === g.id).length
                const qtdOpcoes = cadastro.opcoes.filter((o) => o.grupo_id === g.id && o.ativo).length
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => abrir(g.id, rascunhoDoGrupo(g, cadastro.opcoes, cadastro.ligacoes))}
                      className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold text-mesa-text-primary">
                          {g.nome}
                          {!g.ativo && <span className="ml-2 text-xs font-normal text-mesa-text-tertiary">(inativo)</span>}
                        </span>
                        <span className="block text-xs text-mesa-text-secondary">
                          {resumoDoGrupo(g)} · {qtdOpcoes} {qtdOpcoes === 1 ? 'opção' : 'opções'} · {qtdItens}{' '}
                          {qtdItens === 1 ? 'item' : 'itens'}
                        </span>
                      </span>
                      <Icone nome="chevron_right" size={20} className="shrink-0 text-mesa-text-tertiary" />
                    </button>
                  </li>
                )
              })}
              {cadastro.grupos.length === 0 && (
                <li className="py-3 text-sm text-mesa-text-secondary">
                  Nenhum grupo ainda. Comece por um modelo pronto ou crie o seu.
                </li>
              )}
            </ul>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="md" icon={<Icone nome="add" size={16} />} onClick={() => abrir(null, rascunhoVazio('adicional'))}>
                Novo grupo
              </Button>
              <Button variant="ghost" size="md" onClick={() => setEscolhendoModelo(true)}>
                Modelos prontos
              </Button>
            </div>
          </>
        )}
      </Card>

      <BottomSheet open={escolhendoModelo} onClose={() => setEscolhendoModelo(false)} aria-label="Modelos prontos">
        <h3 className="text-lg font-semibold text-mesa-text-primary">Modelos prontos</h3>
        <p className="mt-1 text-sm text-mesa-text-secondary">O modelo abre preenchido; você ajusta os nomes e informa os preços antes de salvar.</p>
        <div className="mt-4 flex flex-col gap-2">
          {MODELOS_DE_GRUPO.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setEscolhendoModelo(false)
                abrir(null, m.criar())
              }}
              className="rounded-mesa-lg border border-mesa-border-default p-3 text-left"
            >
              <span className="block text-base font-semibold text-mesa-text-primary">{m.titulo}</span>
              <span className="block text-sm text-mesa-text-secondary">{m.descricao}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet open={edicao !== null} onClose={() => !salvando && setEdicao(null)} aria-label="Grupo de opções">
        {edicao && r && cadastro && (
          <div className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto">
            <h3 className="text-lg font-semibold text-mesa-text-primary">{edicao.grupoId ? 'Editar grupo' : 'Novo grupo'}</h3>

            <Input label="Nome do grupo" value={r.nome} maxLength={60} onChange={(e) => atualizar({ nome: e.target.value })} placeholder="Ex.: Tamanho, Adicionais" />

            {edicao.grupoId === null ? (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-mesa-text-secondary">Tipo</p>
                <SegmentedControl
                  aria-label="Tipo do grupo"
                  items={[{ label: 'Adicional' }, { label: 'Variação' }]}
                  activeIndex={r.tipo === 'adicional' ? 0 : 1}
                  onChange={(i) => {
                    const tipo = i === 0 ? 'adicional' : 'variacao'
                    atualizar({ tipo, obrigatorio: tipo === 'variacao', itemIds: tipo === 'variacao' ? r.itemIds.filter((id) => !itensBloqueadosPorVariacao(null, cadastro.grupos, cadastro.ligacoes).has(id)) : r.itemIds })
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-mesa-text-secondary">
                {r.tipo === 'variacao' ? 'Variação' : 'Adicional'} (o tipo não muda depois de criado).
              </p>
            )}

            {r.tipo === 'variacao' ? (
              <p className="text-sm text-mesa-text-secondary">
                O cliente escolhe <strong>uma</strong> opção, sempre. O preço de cada opção <strong>substitui</strong> o preço do item.
                Cada item pode ter só uma variação.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-mesa-text-primary">Obrigatório escolher</span>
                  <Toggle checked={r.obrigatorio} onChange={(v) => atualizar({ obrigatorio: v })} aria-label="Obrigatório escolher" />
                </div>
                <Input
                  label="Limite de escolhas"
                  inputMode="numeric"
                  value={r.maximoTexto}
                  onChange={(e) => atualizar({ maximoTexto: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                  placeholder="Vazio = sem limite"
                  helpText="De 1 a 20. O preço de cada adicional soma ao do item."
                />
              </div>
            )}

            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-mesa-text-primary">Opções</p>
              {r.opcoes.map((o, i) => (
                <div key={o.id ?? `nova-${i}`} className="rounded-mesa-lg border border-mesa-border-subtle p-3">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <Input label="Nome" value={o.nome} maxLength={60} onChange={(e) => atualizarOpcao(i, { nome: e.target.value })} />
                    </div>
                    <div className="w-28 shrink-0">
                      <Input
                        type="currency"
                        label={r.tipo === 'variacao' ? 'Preço' : 'Acréscimo'}
                        inputMode="decimal"
                        value={o.precoTexto}
                        onChange={(e) => atualizarOpcao(i, { precoTexto: filtrarEntradaPreco(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <label className="flex items-center gap-2 text-sm text-mesa-text-secondary">
                      <Toggle checked={o.esgotado} onChange={(v) => atualizarOpcao(i, { esgotado: v })} aria-label={`${o.nome || 'Opção'} acabou`} />
                      Acabou
                    </label>
                    {o.id !== null && (
                      <label className="flex items-center gap-2 text-sm text-mesa-text-secondary">
                        <Toggle checked={o.ativo} onChange={(v) => atualizarOpcao(i, { ativo: v })} aria-label={`${o.nome || 'Opção'} ativa`} />
                        Ativa
                      </label>
                    )}
                    {o.id === null && (
                      <button
                        type="button"
                        className="ml-auto min-h-11 px-2 text-sm text-mesa-error-500"
                        onClick={() => setEdicao((e) => (e ? { ...e, rascunho: { ...e.rascunho, opcoes: e.rascunho.opcoes.filter((_, k) => k !== i) } } : e))}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="md" icon={<Icone nome="add" size={16} />} onClick={() => atualizar({ opcoes: [...r.opcoes, opcaoVazia()] })}>
                Adicionar opção
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-mesa-text-primary">Itens que usam este grupo</p>
              {cadastro.itens.length === 0 && <p className="text-sm text-mesa-text-secondary">Cadastre itens no cardápio primeiro.</p>}
              {cadastro.itens.map((item) => {
                const marcado = r.itemIds.includes(item.id)
                const bloqueado = bloqueados.has(item.id) && !marcado
                return (
                  <div key={item.id}>
                    <Checkbox
                      checked={marcado}
                      disabled={bloqueado}
                      onChange={(v) => alternarItem(item.id, v)}
                      label={`${item.nome}${item.ativo ? '' : ' (inativo)'}${bloqueado ? ' — já tem outra variação' : ''}`}
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-mesa-text-primary">Grupo ativo</span>
              <Toggle checked={r.ativo} onChange={(v) => atualizar({ ativo: v })} aria-label="Grupo ativo" />
            </div>

            {avisos.map((a) => (
              <p key={a} role="status" className="text-sm text-mesa-text-secondary">
                ⚠ {a}
              </p>
            ))}
            <ErroSalvar erro={erroSalvar} />

            <div className="flex flex-col gap-2">
              <Button variant="primary" size="xl" className="w-full" loading={salvando} disabled={salvando} onClick={() => void aoSalvar()}>
                Salvar grupo
              </Button>
              {edicao.grupoId && (
                <div className="flex gap-2">
                  <Button variant="outline" size="md" className="flex-1" onClick={() => abrir(null, duplicarRascunho(r))} disabled={salvando}>
                    Duplicar
                  </Button>
                  <Button variant="textDanger" size="md" className="flex-1" onClick={() => setParaApagar(edicao.grupoId)} disabled={salvando}>
                    Apagar
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={paraApagar !== null} onClose={() => !apagando && setParaApagar(null)} aria-label="Apagar grupo">
        <h3 className="text-lg font-semibold text-mesa-text-primary">Apagar este grupo?</h3>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          As opções e a ligação com os itens também são apagadas. Pedidos já feitos não mudam. Para só esconder, desative o grupo.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="destructive" size="xl" className="w-full" loading={apagando} onClick={() => void confirmarApagar()}>
            Apagar grupo
          </Button>
          <Button variant="ghost" size="md" className="w-full" onClick={() => setParaApagar(null)} disabled={apagando}>
            Manter
          </Button>
        </div>
      </BottomSheet>
    </section>
  )
}
