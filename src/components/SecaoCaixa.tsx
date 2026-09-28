import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import { calcularTotalPedido } from '../lib/relatorio'
import { hojeISO } from '../lib/datas'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { BottomSheet } from './ui/BottomSheet'
import { Icone } from './ui/Icone'
import type { Barraca, Caixa, MovimentoCaixa, PedidoComItens, TipoMovimentoCaixa } from '../types/database'

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-mesa-border-subtle pt-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-mesa-text-secondary">{titulo}</h3>
      {children}
    </div>
  )
}

function rotuloMovimento(tipo: TipoMovimentoCaixa): string {
  return tipo === 'sangria' ? 'Sangria' : 'Suprimento'
}

/** Formulário de abertura — troco inicial + observação opcional. */
function FormularioAbrirCaixa({
  onAbrir,
}: {
  onAbrir: (valorCentavos: number, observacao: string) => Promise<boolean>
}) {
  const [texto, setTexto] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState(false)

  async function abrir() {
    setSalvando(true)
    setErro(false)
    const ok = await onAbrir(reaisParaCentavos(texto), observacao.trim())
    setSalvando(false)
    if (!ok) setErro(true)
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Input
        label="Valor de abertura (troco inicial)"
        type="currency"
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, ''))}
        placeholder="0,00"
        aria-label="Valor de abertura do caixa"
        className="max-w-xs"
      />
      <Input
        label="Observação (opcional)"
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="Ex.: troco combinado com o dono"
        className="max-w-sm"
      />
      {erro && (
        <p className="text-xs font-medium text-mesa-error-500">Não foi possível abrir o caixa. Tente de novo.</p>
      )}
      <Button size="sm" onClick={abrir} loading={salvando} className="w-fit">
        Abrir caixa
      </Button>
    </div>
  )
}

function ListaMovimentos({ movimentos }: { movimentos: MovimentoCaixa[] }) {
  if (movimentos.length === 0) {
    return <p className="mt-2 text-sm text-mesa-text-secondary">Nenhuma sangria ou suprimento ainda.</p>
  }

  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {movimentos.map((movimento) => (
        <li key={movimento.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-mesa-text-primary">
            {rotuloMovimento(movimento.tipo)}
            {movimento.motivo && <span className="text-mesa-text-secondary"> — {movimento.motivo}</span>}
          </span>
          <span
            className={
              movimento.tipo === 'sangria'
                ? 'font-medium text-mesa-error-500'
                : 'font-medium text-mesa-success-700 dark:text-mesa-success-500'
            }
          >
            {movimento.tipo === 'sangria' ? '−' : '+'}
            {formatarPrecoBR(movimento.valor_centavos)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** BottomSheet compartilhado por sangria/suprimento e por fechar caixa —
 * pede um valor em reais + um texto livre (motivo ou observação). */
function SheetValorEMotivo({
  aberto,
  titulo,
  rotuloValor,
  rotuloTexto,
  rotuloBotao,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean
  titulo: string
  rotuloValor: string
  rotuloTexto: string
  rotuloBotao: string
  onFechar: () => void
  onConfirmar: (valorCentavos: number, texto: string) => Promise<boolean>
}) {
  const [valor, setValor] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState(false)

  async function confirmar() {
    setEnviando(true)
    setErro(false)
    const ok = await onConfirmar(reaisParaCentavos(valor), texto.trim())
    setEnviando(false)
    if (!ok) {
      setErro(true)
      return
    }
    setValor('')
    setTexto('')
  }

  return (
    <BottomSheet open={aberto} onClose={onFechar} aria-label={titulo}>
      <h2 className="text-lg font-semibold text-mesa-text-primary">{titulo}</h2>
      <div className="mt-4 flex flex-col gap-3">
        <Input
          label={rotuloValor}
          type="currency"
          inputMode="decimal"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0,00"
        />
        <Input label={rotuloTexto} value={texto} onChange={(e) => setTexto(e.target.value)} />
        {erro && <p className="text-sm font-medium text-mesa-error-500">Não foi possível salvar. Tente de novo.</p>}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Button size="xl" loading={enviando} onClick={confirmar} className="w-full">
          {rotuloBotao}
        </Button>
        <Button variant="ghost" size="md" onClick={onFechar} className="w-full">
          Cancelar
        </Button>
      </div>
    </BottomSheet>
  )
}

function ResumoFechamento({ caixa }: { caixa: Caixa }) {
  if (caixa.diferenca_centavos === null) return null

  const sobrou = caixa.diferenca_centavos > 0
  const faltou = caixa.diferenca_centavos < 0

  return (
    <div className="mt-3 rounded-mesa-2xl border border-mesa-border-subtle bg-mesa-neutral-50 p-4 dark:bg-mesa-neutral-900/60">
      <p className="text-sm text-mesa-text-secondary">
        Esperado {formatarPrecoBR(caixa.valor_esperado_centavos ?? 0)} · Contado{' '}
        {formatarPrecoBR(caixa.valor_fechamento_centavos ?? 0)}
      </p>
      <p
        className={
          sobrou
            ? 'mt-1 text-lg font-bold text-mesa-success-700 dark:text-mesa-success-500'
            : faltou
              ? 'mt-1 text-lg font-bold text-mesa-error-500'
              : 'mt-1 text-lg font-bold text-mesa-text-primary'
        }
      >
        {sobrou && `Sobrou ${formatarPrecoBR(caixa.diferenca_centavos)}`}
        {faltou && `Faltou ${formatarPrecoBR(Math.abs(caixa.diferenca_centavos))}`}
        {!sobrou && !faltou && 'Bateu certinho'}
      </p>
    </div>
  )
}

/** Caixa (abrir/fechar + sangria/suprimento) — decisão de 2026-09-26 no
 * roadmap (CLAUDE.md): fundação necessária pra Faturamento e Fiscal
 * baterem. Pode haver várias sessões por dia — sempre trabalha com a mais
 * recente (`aberto_em` desc); depois de fechada, o formulário de abrir
 * volta a aparecer. */
export function SecaoCaixa({ barraca }: { barraca: Barraca }) {
  const [caixa, setCaixa] = useState<Caixa | null>(null)
  const [movimentos, setMovimentos] = useState<MovimentoCaixa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [sheetMovimento, setSheetMovimento] = useState<TipoMovimentoCaixa | null>(null)
  const [sheetFechar, setSheetFechar] = useState(false)

  useEffect(() => {
    let cancelado = false

    supabase
      .from('caixas')
      .select('*')
      .eq('barraca_id', barraca.id)
      .eq('data', hojeISO())
      .order('aberto_em', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelado || error) {
          setCarregando(false)
          return
        }
        setCaixa((data?.[0] as Caixa) ?? null)
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id])

  useEffect(() => {
    if (!caixa || caixa.status !== 'aberto') return
    let cancelado = false

    supabase
      .from('movimentos_caixa')
      .select('*')
      .eq('caixa_id', caixa.id)
      .order('criado_em')
      .then(({ data, error }) => {
        if (cancelado || error) return
        setMovimentos((data ?? []) as MovimentoCaixa[])
      })

    return () => {
      cancelado = true
    }
  }, [caixa])

  async function abrirCaixa(valorCentavos: number, observacao: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('caixas')
      .insert({
        barraca_id: barraca.id,
        data: hojeISO(),
        valor_abertura_centavos: valorCentavos,
        observacao_abertura: observacao || null,
      })
      .select()
      .single()

    if (error || !data) return false
    setCaixa(data as Caixa)
    return true
  }

  async function lancarMovimento(valorCentavos: number, motivo: string): Promise<boolean> {
    if (!caixa || !sheetMovimento || valorCentavos <= 0) return false

    const { data, error } = await supabase
      .from('movimentos_caixa')
      .insert({
        barraca_id: barraca.id,
        caixa_id: caixa.id,
        tipo: sheetMovimento,
        valor_centavos: valorCentavos,
        motivo: motivo || null,
      })
      .select()
      .single()

    if (error || !data) return false
    setMovimentos((atual) => [...atual, data as MovimentoCaixa])
    setSheetMovimento(null)
    return true
  }

  async function fecharCaixa(valorContadoCentavos: number, observacao: string): Promise<boolean> {
    if (!caixa) return false

    // O dinheiro entra na hora que o pedido é confirmado e vai pra cozinha,
    // não na entrega (confirmado com o dono do produto 2026-09-28) — conta
    // todo pedido em dinheiro que não foi cancelado (a_fazer, pronto ou
    // entregue), não só 'entregue'. calcularTotalPedido já desconta itens
    // removidos individualmente (cancelamento parcial) mesmo com o pedido
    // ainda ativo.
    const { data: pedidos, error: erroPedidos } = await supabase
      .from('pedidos')
      .select('*, itens_do_pedido(*)')
      .eq('barraca_id', barraca.id)
      .neq('status', 'cancelado')
      .eq('metodo_pagamento', 'dinheiro')
      .gte('criado_em', caixa.aberto_em)

    if (erroPedidos) return false

    const totalDinheiro = ((pedidos ?? []) as PedidoComItens[]).reduce(
      (soma, pedido) => soma + calcularTotalPedido(pedido),
      0,
    )
    const totalSuprimento = movimentos
      .filter((m) => m.tipo === 'suprimento')
      .reduce((soma, m) => soma + m.valor_centavos, 0)
    const totalSangria = movimentos
      .filter((m) => m.tipo === 'sangria')
      .reduce((soma, m) => soma + m.valor_centavos, 0)

    const valorEsperado = caixa.valor_abertura_centavos + totalDinheiro + totalSuprimento - totalSangria
    const diferenca = valorContadoCentavos - valorEsperado

    const { data, error } = await supabase
      .from('caixas')
      .update({
        status: 'fechado',
        valor_fechamento_centavos: valorContadoCentavos,
        valor_esperado_centavos: valorEsperado,
        diferenca_centavos: diferenca,
        observacao_fechamento: observacao || null,
        fechado_em: new Date().toISOString(),
      })
      .eq('id', caixa.id)
      .select()
      .single()

    if (error || !data) return false
    setCaixa(data as Caixa)
    setSheetFechar(false)
    return true
  }

  if (carregando) return null

  const caixaAberto = caixa?.status === 'aberto'

  return (
    <Secao titulo="Caixa">
      {!caixa && <FormularioAbrirCaixa onAbrir={abrirCaixa} />}

      {caixa && !caixaAberto && (
        <div className="mt-3">
          <ResumoFechamento caixa={caixa} />
          <div className="mt-3">
            <FormularioAbrirCaixa onAbrir={abrirCaixa} />
          </div>
        </div>
      )}

      {caixa && caixaAberto && (
        <div className="mt-3">
          <p className="text-sm text-mesa-text-secondary">
            Aberto com {formatarPrecoBR(caixa.valor_abertura_centavos)}
            {caixa.observacao_abertura && ` — ${caixa.observacao_abertura}`}
          </p>

          <ListaMovimentos movimentos={movimentos} />

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="remove" size={16} />}
              onClick={() => setSheetMovimento('sangria')}
            >
              Sangria
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Icone nome="add" size={16} />}
              onClick={() => setSheetMovimento('suprimento')}
            >
              Suprimento
            </Button>
            <Button size="sm" onClick={() => setSheetFechar(true)} className="ml-auto">
              Fechar caixa
            </Button>
          </div>
        </div>
      )}

      <SheetValorEMotivo
        aberto={sheetMovimento !== null}
        titulo={sheetMovimento === 'sangria' ? 'Sangria' : 'Suprimento'}
        rotuloValor="Valor"
        rotuloTexto="Motivo (opcional)"
        rotuloBotao="Lançar"
        onFechar={() => setSheetMovimento(null)}
        onConfirmar={lancarMovimento}
      />

      <SheetValorEMotivo
        aberto={sheetFechar}
        titulo="Fechar caixa"
        rotuloValor="Valor contado na gaveta"
        rotuloTexto="Observação (opcional)"
        rotuloBotao="Fechar caixa"
        onFechar={() => setSheetFechar(false)}
        onConfirmar={fecharCaixa}
      />
    </Secao>
  )
}
