import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import clsx from 'clsx'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { classesBotaoIcone } from '../lib/estiloBotaoIcone'
import { useTheme } from '../hooks/useTheme'
import { enfileirar } from '../lib/fila'
import { filtrarEntradaPreco, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import { configTaxaEntrega, normalizarTelefone, validarDadosEntrega, type DadosEntrega } from '../lib/entrega'
import { ICONE_MODO, ROTULO_MODO } from '../lib/atendimento'
import { configBairrosDaBarraca, normalizarBairro, taxaDoBairro } from '../lib/bairros'
import { useBairrosEntrega } from '../hooks/useBairrosEntrega'
import type {
  EntregaDiretaPorItem,
  EstadoParaConfirmar,
  EstadoParaEditar,
  EstadoPedidoEnviado,
} from '../lib/carrinho'
import { METODOS_DISPONIVEIS, METODO_NA_ENTREGA, OPCAO_PAGAR_NA_ENTREGA, humanizarMetodo } from '../lib/metodoPagamento'
import { opcaoPagarDepois, podeEnviarAReceber } from '../lib/pagarDepois'
import type { MetodoPagamento } from '../lib/metodoPagamento'
import { BotaoHome } from '../components/ui/BotaoHome'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Checkbox } from '../components/ui/Checkbox'
import { FormularioEntrega } from '../components/FormularioEntrega'
import { Icone } from '../components/ui/Icone'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'
import type { Item } from '../types/database'

const METODOS_PADRAO: MetodoPagamento[] = ['dinheiro', 'debito', 'credito', 'pix']

function LinhaItemConfirmar({
  item,
  quantidade,
  marcado,
  permiteEntregaDireta,
  observacao,
  precoUnitarioCentavos,
  resumoOpcoes,
  onAlternar,
}: {
  item: Item
  quantidade: number
  /** Preço final da unidade (já com variação/adicionais). */
  precoUnitarioCentavos: number
  /** Texto das opções escolhidas ("Grande, Ovo"); vazio em item simples. */
  resumoOpcoes: string
  marcado: boolean
  /** Falso no modo Entrega: o pedido tem que passar pela cozinha. */
  permiteEntregaDireta: boolean
  observacao: string
  onAlternar: () => void
}) {
  const temPreco = precoUnitarioCentavos > 0
  const subtotal = precoUnitarioCentavos * quantidade

  return (
    <div className="flex items-start gap-3 border-b border-dashed border-mesa-border-subtle py-3 last:border-b-0">
      {permiteEntregaDireta && (
        <div className="pt-0.5">
          <Checkbox
            checked={marcado}
            onChange={onAlternar}
            aria-label={`Entregar ${item.nome} direto sem passar na cozinha`}
          />
        </div>
      )}
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
        {resumoOpcoes && <p className="mt-0.5 text-sm text-mesa-text-secondary">{resumoOpcoes}</p>}
        <p className="mt-0.5 text-xs text-mesa-text-secondary">
          {temPreco ? `${formatarPrecoBR(precoUnitarioCentavos)} cada` : 'Sem preço cadastrado'}
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

  const ehEntrega = estado?.tipoAtendimento === 'entrega'
  const metodosAtivos = barraca.metodos_pagamento_ativos ?? METODOS_PADRAO
  // "Pagar na entrega" (o entregador define a forma real pelo link) só existe no
  // modo Entrega e vale mesmo que a barraca não tenha método nenhum ativo.
  const opcoesPagamento: { chave: MetodoPagamento | typeof METODO_NA_ENTREGA; label: string; icone: string }[] = [
    ...METODOS_DISPONIVEIS.filter((m) => metodosAtivos.includes(m.chave)),
    ...(ehEntrega ? [OPCAO_PAGAR_NA_ENTREGA] : []),
    // "Pagar depois" na Retirada (interruptor da barraca): o pedido vai à cozinha e a forma é dada na baixa.
    ...(!ehEntrega && opcaoPagarDepois(barraca, estado?.tipoAtendimento) ? [opcaoPagarDepois(barraca, estado?.tipoAtendimento)!] : []),
  ]

  const [entregaDireta, setEntregaDireta] = useState<EntregaDiretaPorItem>(
    () => estado?.entregaDireta ?? {},
  )
  // Observação geral do pedido mudou de tela: era editada em Lançar Pedido,
  // agora é aqui — mais perto do envio, igual o mockup "+ Adicionar
  // observação à cozinha". Precisa ser state (não só ler de `estado`) pra
  // dar pra editar nessa tela.
  const [observacao, setObservacao] = useState(() => estado?.observacao ?? '')
  const [metodoSelecionado, setMetodoSelecionado] = useState<MetodoPagamento | typeof METODO_NA_ENTREGA | null>(() =>
    opcoesPagamento.length === 1 ? opcoesPagamento[0].chave : null,
  )
  const configTaxa = configTaxaEntrega(barraca)
  const bairrosTaxa = useBairrosEntrega(barraca.id)
  const configBairros = configBairrosDaBarraca(barraca)
  // Com bairros cadastrados a taxa vale mesmo com a taxa padrão desligada.
  const cobraTaxa = ehEntrega && (configTaxa.habilitada || bairrosTaxa.some((b) => b.ativo !== false))
  const [entrega, setEntrega] = useState<DadosEntrega>(
    () => estado?.entrega ?? { nome: '', telefone: '', rua: '', numero: '', bairro: '', referencia: '' },
  )
  // Modos sem formulário de Entrega: nome opcional. Na Entrega o nome é o do
  // formulário (obrigatório lá), então este campo não aparece.
  const [clienteNome, setClienteNome] = useState(() => estado?.clienteNome ?? '')
  const [clienteTelefone, setClienteTelefone] = useState(() => estado?.clienteTelefone ?? '')
  // Valor digitado à mão (taxa editável); null = segue a taxa do bairro.
  const [taxaEditada, setTaxaEditada] = useState<string | null>(null)
  const [mostrarErrosEntrega, setMostrarErrosEntrega] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [confirmandoEntregaDireta, setConfirmandoEntregaDireta] = useState(false)
  const enviandoRef = useRef(false)
  const clientUuidRef = useRef(crypto.randomUUID())

  if (!estado || Object.keys(estado.carrinho).length === 0) {
    return null
  }

  const { carrinho, itens, mesa, viagem, tipoAtendimento } = estado
  const observacaoPorItem = estado.observacaoPorItem ?? {}
  const opcoesPorLinha = estado.opcoesPorLinha ?? {}

  // `itemId` aqui é a CHAVE da linha: o id do item (simples) ou a chave da linha com opções, que
  // aponta para o item em `opcoesPorLinha`. Observação e entrega direta usam a mesma chave.
  const linhas = Object.entries(carrinho)
    .filter(([, quantidade]) => quantidade > 0)
    .map(([itemId, quantidade]) => {
      const comOpcoes = opcoesPorLinha[itemId]
      const item = itens.find((i) => i.id === (comOpcoes?.itemId ?? itemId))
      return {
        item,
        itemId,
        quantidade,
        precoUnitarioCentavos: comOpcoes ? comOpcoes.precoUnitarioCentavos : (item?.preco_centavos ?? 0),
        resumoOpcoes: comOpcoes?.resumo ?? '',
        snapshotOpcoes: comOpcoes?.snapshot ?? [],
      }
    })
    .filter((linha): linha is typeof linha & { item: Item } => Boolean(linha.item))

  const totalCentavos = linhas.reduce(
    (soma, { precoUnitarioCentavos, quantidade }) =>
      soma + (precoUnitarioCentavos > 0 ? precoUnitarioCentavos * quantidade : 0),
    0,
  )

  const errosEntrega = ehEntrega ? validarDadosEntrega(entrega) : {}
  const digitosAviso = normalizarTelefone(clienteTelefone)
  const telefoneAvisoValido = digitosAviso.length >= 8 && digitosAviso.length <= 15
  // Taxa do bairro digitado (mesma regra do servidor). Bairro "bloqueado" não
  // trava o operador: usa a taxa padrão, que ele pode ajustar se for editável.
  const taxaBairro = taxaDoBairro(configBairros, bairrosTaxa, entrega.bairro)
  const taxaSugerida = !cobraTaxa
    ? 0
    : taxaBairro.origem === 'bloqueado'
      ? configBairros.taxaHabilitada
        ? configBairros.taxaPadraoCentavos
        : 0
      : taxaBairro.taxaCentavos
  const taxaTexto = taxaEditada ?? (taxaSugerida / 100).toFixed(2).replace('.', ',')
  const taxaCentavos = !cobraTaxa ? 0 : configTaxa.editavel ? reaisParaCentavos(taxaTexto) : taxaSugerida
  const bairroForaDaLista =
    ehEntrega && entrega.bairro.trim() !== '' && bairrosTaxa.length > 0 && taxaBairro.origem !== 'bairro'
  const totalComTaxa = totalCentavos + taxaCentavos

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
        tipoAtendimento,
        observacao,
        entregaDireta,
        observacaoPorItem,
        opcoesPorLinha,
        entrega: ehEntrega ? entrega : undefined,
        clienteNome,
        clienteTelefone,
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
    // "Pagar na entrega" só vale no modo Entrega (o link do entregador define o método).
    if (metodoSelecionado === METODO_NA_ENTREGA && !podeEnviarAReceber(barraca, tipoAtendimento)) return
    if (ehEntrega && Object.keys(errosEntrega).length > 0) {
      setMostrarErrosEntrega(true)
      return
    }
    enviandoRef.current = true
    setEnviando(true)

    // Pedido de Entrega nunca é "entrega direta no balcão": ele precisa passar
    // pela cozinha (e imprimir comanda). Marcação vinda de antes de trocar o
    // modo é ignorada aqui, não só escondida na tela.
    const forcarTudo = forcarEntregaDiretaEmTudo && !ehEntrega
    const diretaPorItem = ehEntrega ? {} : entregaDireta
    const todosEntregaDireta = forcarTudo || linhas.every(({ itemId }) => diretaPorItem[itemId] ?? false)

    const itensPedido = linhas.map(({ item, itemId, quantidade, precoUnitarioCentavos, snapshotOpcoes }) => ({
      item_id: item.id,
      nome_item: item.nome,
      quantidade,
      preco_centavos_unitario: precoUnitarioCentavos,
      // Só vai a chave quando há opções: payload de item simples fica idêntico ao de antes.
      ...(snapshotOpcoes.length > 0 ? { opcoes: snapshotOpcoes } : {}),
      entrega_direta: forcarTudo ? true : (diretaPorItem[itemId] ?? false),
      observacao: observacaoPorItem[itemId] || null,
    }))

    const operacao = await enfileirar('criar_pedido', {
      p_barraca_id: barraca.id,
      p_mesa: viagem ? null : mesa.trim() || null,
      p_viagem: viagem,
      p_tipo_atendimento: tipoAtendimento,
      p_observacao: observacao.trim() || null,
      p_client_uuid: clientUuidRef.current,
      p_metodo_pagamento: metodoSelecionado,
      p_itens: itensPedido,
      // Só pedido de Entrega leva estes campos: os demais seguem com o mesmo
      // formato de antes (e a criar_pedido sem v6 no banco continua servindo).
      // Nome opcional: só vai no payload quando preenchido (pedido sem nome
      // segue idêntico ao do app antigo). Na Entrega o nome já está em p_entrega.
      ...(!ehEntrega && clienteNome.trim() ? { p_cliente_nome: clienteNome.trim() } : {}),
      // WhatsApp opcional só pra avisar "pronto" (Entrega usa o telefone do formulário).
      // Número inválido é ignorado: nunca bloqueia o envio.
      ...(!ehEntrega && telefoneAvisoValido ? { p_cliente_telefone: normalizarTelefone(clienteTelefone) } : {}),
      ...(ehEntrega
        ? {
            p_entrega: {
              nome: entrega.nome.trim(),
              telefone: normalizarTelefone(entrega.telefone),
              rua: entrega.rua.trim(),
              numero: entrega.numero.trim(),
              bairro: entrega.bairro.trim(),
              referencia: entrega.referencia?.trim() || null,
            },
            p_taxa_entrega_centavos: taxaCentavos,
          }
        : {}),
    })

    navigate(`/${barraca.slug}/lancar`, {
      replace: true,
      state: {
        senhaEnviada: {
          valor: null,
          idFila: operacao.id,
          entregaDireta: todosEntregaDireta,
          entrega: ehEntrega
            ? {
                itens: linhas.map(({ item, quantidade, itemId, resumoOpcoes }) => ({
                  nome: resumoOpcoes ? `${item.nome} (${resumoOpcoes})` : item.nome,
                  quantidade,
                  observacao: observacaoPorItem[itemId] || null,
                })),
                cliente: entrega,
                totalCentavos: totalComTaxa,
                taxaEntregaCentavos: taxaCentavos,
                metodoPagamento: humanizarMetodo(metodoSelecionado),
                observacao: observacao.trim() || null,
              }
            : undefined,
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
          {linhas.map(({ item, itemId, quantidade, precoUnitarioCentavos, resumoOpcoes }) => (
            <LinhaItemConfirmar
              key={itemId}
              item={item}
              quantidade={quantidade}
              precoUnitarioCentavos={precoUnitarioCentavos}
              resumoOpcoes={resumoOpcoes}
              permiteEntregaDireta={!ehEntrega}
              marcado={!ehEntrega && (entregaDireta[itemId] ?? false)}
              observacao={observacaoPorItem[itemId] ?? ''}
              onAlternar={() => alternarEntregaDireta(itemId)}
            />
          ))}
        </Card>

        {!ehEntrega && (
          <Input
            label="Nome do cliente (opcional)"
            type="text"
            autoComplete="off"
            maxLength={60}
            value={clienteNome}
            onChange={(e) => setClienteNome(e.target.value)}
            className="mt-3"
          />
        )}

        {!ehEntrega && (
          <Input
            label="WhatsApp do cliente (opcional)"
            type="text"
            inputMode="tel"
            autoComplete="off"
            value={clienteTelefone}
            onChange={(e) => setClienteTelefone(e.target.value)}
            helpText={
              clienteTelefone.trim() && !telefoneAvisoValido
                ? 'Número incompleto: o pedido segue sem aviso por WhatsApp.'
                : 'Só para avisar quando o pedido ficar pronto.'
            }
            className="mt-3"
          />
        )}

        <Textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="+ Adicionar observação à cozinha (opcional)"
          rows={2}
          aria-label="Observação geral do pedido"
          className="mt-3"
        />

        {(mesa.trim() || tipoAtendimento === 'retirada' || tipoAtendimento === 'entrega') && (
          <Card className="mt-4">
            {tipoAtendimento === 'entrega' ? (
              <LinhaMeta icone={ICONE_MODO.entrega} label="Atendimento" valor={ROTULO_MODO.entrega} />
            ) : tipoAtendimento === 'retirada' ? (
              <LinhaMeta icone={ICONE_MODO.retirada} label="Atendimento" valor={ROTULO_MODO.retirada} />
            ) : mesa.trim() ? (
              <LinhaMeta icone="tag" label="Mesa" valor={mesa.trim()} />
            ) : null}
          </Card>
        )}

        {ehEntrega && (
          <>
            <h2 className="mb-3 mt-6 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
              <Icone nome={ICONE_MODO.entrega} size={14} />
              Dados da entrega
            </h2>
            <Card>
              <FormularioEntrega
                barracaId={barraca.id}
                dados={entrega}
                erros={mostrarErrosEntrega ? errosEntrega : {}}
                onChange={(novos) => {
                  // Trocou de bairro: a taxa volta a seguir o bairro novo.
                  if (normalizarBairro(novos.bairro) !== normalizarBairro(entrega.bairro)) setTaxaEditada(null)
                  setEntrega(novos)
                }}
                sugestoesBairro={bairrosTaxa.map((b) => b.bairro)}
                avisoBairro={
                  bairroForaDaLista
                    ? taxaBairro.origem === 'bloqueado'
                      ? 'Bairro fora da lista de entrega. Confirme com o cliente; a taxa padrão foi aplicada.'
                      : 'Bairro fora da lista: taxa padrão aplicada.'
                    : undefined
                }
              />
            </Card>
          </>
        )}

        {cobraTaxa && (
          <Card className="mt-4">
            {configTaxa.editavel ? (
              <Input
                type="currency"
                label="Taxa de entrega"
                inputMode="decimal"
                value={taxaTexto}
                onChange={(e) => setTaxaEditada(filtrarEntradaPreco(e.target.value))}
              />
            ) : (
              <LinhaMeta icone="two_wheeler" label="Taxa de entrega" valor={formatarPrecoBR(taxaCentavos)} />
            )}
          </Card>
        )}

        <div className="mt-4 rounded-mesa-lg bg-mesa-neutral-100 px-5 py-4 dark:bg-mesa-neutral-800">
          {cobraTaxa && (
            <div className="mb-2 flex items-center justify-between text-sm text-mesa-text-secondary">
              <span>Itens</span>
              <span>{formatarPrecoBR(totalCentavos)}</span>
            </div>
          )}
          {cobraTaxa && (
            <div className="mb-2 flex items-center justify-between text-sm text-mesa-text-secondary">
              <span>Taxa de entrega</span>
              <span>{formatarPrecoBR(taxaCentavos)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-mesa-text-primary">Total</span>
            <span className="font-mesa-display text-2xl font-bold text-mesa-text-primary">
              {formatarPrecoBR(totalComTaxa)}
            </span>
          </div>
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

          {!ehEntrega && (
          <button
            type="button"
            onClick={() => setConfirmandoEntregaDireta(true)}
            disabled={!podeEnviar}
            className="mt-2 flex min-h-11 items-center justify-center gap-1.5 text-center text-xs font-medium text-mesa-text-tertiary outline-none disabled:opacity-40"
          >
            <Icone nome="local_shipping" size={14} />
            Entregar direto no balcão (não vai pra cozinha)
          </button>
          )}
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
