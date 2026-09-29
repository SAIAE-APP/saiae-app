import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useTheme } from '../hooks/useTheme'
import { enfileirar } from '../lib/fila'
import { formatarPrecoBR } from '../lib/preco'
import type {
  EntregaDiretaPorItem,
  EstadoParaConfirmar,
  EstadoParaEditar,
  EstadoPedidoEnviado,
} from '../lib/carrinho'
import { METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import type { MetodoPagamento } from '../lib/metodoPagamento'
import { BotaoHome } from '../components/ui/BotaoHome'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Checkbox } from '../components/ui/Checkbox'
import { Icone } from '../components/ui/Icone'
import { Textarea } from '../components/ui/Textarea'
import type { Item } from '../types/database'

const METODOS_PADRAO: MetodoPagamento[] = ['dinheiro', 'debito', 'credito', 'pix']

function LinhaItemConfirmar({
  item,
  quantidade,
  marcado,
  observacao,
  onAlternar,
}: {
  item: Item
  quantidade: number
  marcado: boolean
  observacao: string
  onAlternar: () => void
}) {
  const temPreco = item.preco_centavos > 0
  const subtotal = item.preco_centavos * quantidade

  return (
    <div className="flex items-start gap-3 border-b border-dashed border-mesa-border-subtle py-3 last:border-b-0">
      <div className="pt-0.5">
        <Checkbox
          checked={marcado}
          onChange={onAlternar}
          aria-label={`Entregar ${item.nome} direto sem passar na cozinha`}
        />
      </div>
      {item.foto_url && (
        <img
          src={item.foto_url}
          alt=""
          className="size-11 shrink-0 rounded-mesa-sm object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-mesa-text-primary">
          {quantidade}× {item.nome}
        </p>
        <p className="mt-0.5 text-xs text-mesa-text-secondary">
          {temPreco ? `${formatarPrecoBR(item.preco_centavos)} cada` : 'Sem preço cadastrado'}
          {marcado && ' · Entregar direto sem passar na cozinha'}
        </p>
        {observacao && (
          <span className="mt-1 inline-block rounded-mesa-balao bg-mesa-warning-50 px-2 py-0.5 text-[11px] font-medium text-mesa-warning-700">
            {observacao}
          </span>
        )}
      </div>
      <p className="shrink-0 text-base font-semibold text-mesa-text-primary">
        {temPreco ? formatarPrecoBR(subtotal) : '—'}
      </p>
    </div>
  )
}

function LinhaMeta({
  icone,
  label,
  valor,
}: {
  icone: string
  label: string
  valor: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-mesa-border-subtle py-3 last:border-b-0">
      <span className="flex items-center gap-2 text-sm text-mesa-text-secondary">
        <Icone nome={icone} size={16} />
        {label}
      </span>
      <span className="text-sm font-semibold text-mesa-text-primary">{valor}</span>
    </div>
  )
}

export function ConfirmarPedido() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const location = useLocation()
  const { tema, alternarTema } = useTheme()
  const escuro = tema === 'escuro'

  const estado = (location.state as EstadoParaConfirmar | null) ?? null

  // Guarda de rota: sem carrinho no state (entrou direto na URL, atualizou a
  // página, etc.), não tem o que confirmar — volta pro Lançar Pedido sem
  // quebrar. O redirect roda em efeito porque navigate() não é setState.
  useEffect(() => {
    if (!estado || Object.keys(estado.carrinho).length === 0) {
      navigate(`/${barraca.slug}`, { replace: true })
    }
  }, [estado, barraca.slug, navigate])

  const metodosAtivos = barraca.metodos_pagamento_ativos ?? METODOS_PADRAO
  const opcoesPagamento = METODOS_DISPONIVEIS.filter((m) => metodosAtivos.includes(m.chave))

  const [entregaDireta, setEntregaDireta] = useState<EntregaDiretaPorItem>(
    () => estado?.entregaDireta ?? {},
  )
  // Observação geral do pedido mudou de tela: era editada em Lançar Pedido,
  // agora é aqui — mais perto do envio, igual o mockup "+ Adicionar
  // observação à cozinha". Precisa ser state (não só ler de `estado`) pra
  // dar pra editar nessa tela.
  const [observacao, setObservacao] = useState(() => estado?.observacao ?? '')
  const [metodoSelecionado, setMetodoSelecionado] = useState<MetodoPagamento | null>(() =>
    opcoesPagamento.length === 1 ? opcoesPagamento[0].chave : null,
  )
  const [enviando, setEnviando] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [confirmandoEntregaDireta, setConfirmandoEntregaDireta] = useState(false)
  const enviandoRef = useRef(false)
  const clientUuidRef = useRef(crypto.randomUUID())

  if (!estado || Object.keys(estado.carrinho).length === 0) {
    return null
  }

  const { carrinho, itens, mesa, viagem } = estado
  const observacaoPorItem = estado.observacaoPorItem ?? {}

  const linhas = Object.entries(carrinho)
    .filter(([, quantidade]) => quantidade > 0)
    .map(([itemId, quantidade]) => ({
      item: itens.find((i) => i.id === itemId),
      itemId,
      quantidade,
    }))
    .filter((linha): linha is { item: Item; itemId: string; quantidade: number } => Boolean(linha.item))

  const totalCentavos = linhas.reduce(
    (soma, { item, quantidade }) => soma + (item.preco_centavos > 0 ? item.preco_centavos * quantidade : 0),
    0,
  )

  function alternarEntregaDireta(itemId: string) {
    setEntregaDireta((atual) => ({ ...atual, [itemId]: !atual[itemId] }))
  }

  function voltarEEditar() {
    navigate(`/${barraca.slug}/lancar`, {
      replace: true,
      state: {
        carrinho,
        mesa,
        viagem,
        observacao,
        entregaDireta,
        observacaoPorItem,
      } satisfies EstadoParaEditar,
    })
  }

  // Home aqui descarta um carrinho ainda não enviado — diferente de
  // LancarPedido (onde os outros itens da bottom nav já trocam de aba sem
  // avisar mesmo com o carrinho cheio). Essa tela não tem bottom nav, então
  // Home seria o único jeito de sair sem passar por "Voltar e editar" — por
  // isso confirma antes, pra não apagar sem querer o trabalho do operador.
  function irParaInicio() {
    navigate(`/${barraca.slug}`)
  }

  async function enviarPedido(forcarEntregaDiretaEmTudo: boolean) {
    if (enviandoRef.current || !metodoSelecionado) return
    enviandoRef.current = true
    setEnviando(true)

    const todosEntregaDireta =
      forcarEntregaDiretaEmTudo ||
      linhas.every(({ itemId }) => entregaDireta[itemId] ?? false)

    const itensPedido = linhas.map(({ item, itemId, quantidade }) => ({
      item_id: itemId,
      nome_item: item.nome,
      quantidade,
      preco_centavos_unitario: item.preco_centavos,
      entrega_direta: forcarEntregaDiretaEmTudo ? true : (entregaDireta[itemId] ?? false),
      observacao: observacaoPorItem[itemId] || null,
    }))

    const operacao = await enfileirar('criar_pedido', {
      p_barraca_id: barraca.id,
      p_mesa: viagem ? null : mesa.trim() || null,
      p_viagem: viagem,
      p_observacao: observacao.trim() || null,
      p_client_uuid: clientUuidRef.current,
      p_metodo_pagamento: metodoSelecionado,
      p_itens: itensPedido,
    })

    navigate(`/${barraca.slug}/lancar`, {
      replace: true,
      state: {
        senhaEnviada: {
          valor: null,
          idFila: operacao.id,
          entregaDireta: todosEntregaDireta,
        },
      } satisfies EstadoPedidoEnviado,
    })
  }

  const podeEnviar = metodoSelecionado !== null && !enviando

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      <div className="flex items-start justify-between gap-3 px-6 pt-[calc(env(safe-area-inset-top)+20px)]">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <BotaoHome onClick={() => setConfirmandoDescarte(true)} />
            <button
              type="button"
              onClick={voltarEEditar}
              className="inline-flex items-center gap-2 text-mesa-text-primary outline-none"
            >
              <Icone nome="chevron_left" size={28} />
              <h1 className="text-[32px] font-bold leading-[40px]">Confirmar pedido</h1>
            </button>
          </div>
          <p className="mt-1 text-sm text-mesa-text-secondary">
            A senha é gerada só depois de confirmar
          </p>
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

      <div className="flex-1 px-6 pb-10 pt-5 md:grid md:grid-cols-2 md:items-start md:gap-8">
        <div>
        <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
          <Icone nome="receipt_long" size={14} />
          Itens do pedido
          <span className="flex h-5 min-w-5 items-center justify-center rounded-mesa-balao bg-mesa-neutral-100 px-1.5 text-[11px] font-bold normal-case tracking-normal text-mesa-text-secondary dark:bg-mesa-neutral-700">
            {linhas.length}
          </span>
        </h2>
        <Card>
          {linhas.map(({ item, itemId, quantidade }) => (
            <LinhaItemConfirmar
              key={itemId}
              item={item}
              quantidade={quantidade}
              marcado={entregaDireta[itemId] ?? false}
              observacao={observacaoPorItem[itemId] ?? ''}
              onAlternar={() => alternarEntregaDireta(itemId)}
            />
          ))}
        </Card>

        <Textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="+ Adicionar observação à cozinha (opcional)"
          rows={2}
          aria-label="Observação geral do pedido"
          className="mt-3"
        />

        {(mesa.trim() || viagem) && (
          <Card className="mt-4">
            {viagem ? (
              <LinhaMeta icone="takeout_dining" label="Viagem" valor="sim" />
            ) : mesa.trim() ? (
              <LinhaMeta icone="tag" label="Mesa" valor={mesa.trim()} />
            ) : null}
          </Card>
        )}

        <div className="mt-4 flex items-center justify-between rounded-mesa-lg bg-mesa-neutral-100 px-5 py-4 dark:bg-mesa-neutral-800">
          <span className="text-base font-semibold text-mesa-text-primary">Total</span>
          <span className="font-mesa-display text-2xl font-bold text-mesa-text-primary">
            {formatarPrecoBR(totalCentavos)}
          </span>
        </div>
        </div>

        <div>
        <h2 className="mb-3 mt-6 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary md:mt-0">
          <Icone nome="credit_card" size={14} />
          Forma de pagamento
        </h2>
        {opcoesPagamento.length === 0 ? (
          <p className="rounded-mesa-md border-l-[3px] border-mesa-error-500 bg-mesa-error-50 p-3 text-sm font-medium text-mesa-error-700 dark:bg-mesa-error-500/15 dark:text-mesa-error-400">
            Configure ao menos um método de pagamento em Ajustes.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Forma de pagamento">
            {opcoesPagamento.map((metodo) => {
              const selecionado = metodoSelecionado === metodo.chave
              return (
                <button
                  key={metodo.chave}
                  type="button"
                  role="radio"
                  aria-checked={selecionado}
                  onClick={() => setMetodoSelecionado(metodo.chave)}
                  className={clsx(
                    'flex items-center gap-3 rounded-mesa-lg border-2 p-4 text-left outline-none transition-colors',
                    selecionado
                      ? 'border-mesa-neutral-900 bg-mesa-neutral-100 dark:border-mesa-neutral-50 dark:bg-mesa-neutral-800'
                      : 'border-mesa-border-subtle bg-mesa-surface',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-10 shrink-0 items-center justify-center rounded-mesa-md',
                      selecionado
                        ? 'bg-mesa-neutral-900 text-white dark:bg-mesa-neutral-50 dark:text-mesa-neutral-900'
                        : 'bg-mesa-neutral-100 text-mesa-text-secondary dark:bg-mesa-neutral-700',
                    )}
                  >
                    <Icone nome={metodo.icone} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-mesa-text-primary">
                      {metodo.label}
                    </span>
                    {selecionado && (
                      <span className="block text-xs font-medium text-mesa-text-secondary">
                        Selecionado
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          <Button
            variant="confirm"
            size="xl"
            icon={<Icone nome="rocket_launch" size={20} />}
            disabled={!podeEnviar}
            loading={enviando}
            onClick={() => enviarPedido(false)}
            className="w-full"
          >
            Confirmar e enviar
          </Button>
          <button
            type="button"
            onClick={voltarEEditar}
            className="min-h-11 text-center text-sm font-semibold text-mesa-text-secondary"
          >
            Voltar e editar
          </button>

          <button
            type="button"
            onClick={() => setConfirmandoEntregaDireta(true)}
            disabled={!podeEnviar}
            className="mt-2 flex min-h-11 items-center justify-center gap-1.5 text-center text-xs font-medium text-mesa-text-tertiary outline-none disabled:opacity-40"
          >
            <Icone nome="local_shipping" size={14} />
            Entregar direto no balcão (não vai pra cozinha)
          </button>
        </div>
        </div>
      </div>

      <BottomSheet
        open={confirmandoDescarte}
        onClose={() => setConfirmandoDescarte(false)}
        aria-label="Confirmar descarte do pedido"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Descartar pedido em andamento?</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">Os itens selecionados serão perdidos.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="destructive" size="xl" onClick={irParaInicio} className="w-full">
            Descartar
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setConfirmandoDescarte(false)}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={confirmandoEntregaDireta}
        onClose={() => setConfirmandoEntregaDireta(false)}
        aria-label="Confirmar entrega direta"
      >
        <h2 className="text-lg font-semibold text-mesa-text-primary">Isso pula a cozinha</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          O pedido não gera senha de chamada e não aparece na Cozinha — vai direto pro Histórico
          como entregue.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="outline"
            size="xl"
            icon={<Icone nome="local_shipping" size={20} />}
            loading={enviando}
            onClick={() => {
              setConfirmandoEntregaDireta(false)
              enviarPedido(true)
            }}
            className="w-full"
          >
            Entregar direto
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setConfirmandoEntregaDireta(false)}
            className="w-full"
          >
            Cancelar
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
