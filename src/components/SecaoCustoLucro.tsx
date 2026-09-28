import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { centavosParaReais, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import type { IntervaloData } from '../lib/relatorio'
import { SecaoRelatorio } from './SecaoRelatorio'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import type { Barraca, CustoDiario } from '../types/database'

function textoPrecoInicial(centavos: number): string {
  return centavos > 0 ? centavosParaReais(centavos).toFixed(2).replace('.', ',') : ''
}

function diasNoIntervalo(intervalo: IntervaloData): number {
  const [anoI, mesI, diaI] = intervalo.inicio.split('-').map(Number)
  const [anoF, mesF, diaF] = intervalo.fim.split('-').map(Number)
  return (
    Math.round(
      (new Date(anoF, mesF - 1, diaF).getTime() - new Date(anoI, mesI - 1, diaI).getTime()) / 86400000,
    ) + 1
  )
}

/** Campo de custo do dia (editável) — só faz sentido pra período de um dia
 * só, então recebe `key={intervalo.inicio}` do chamador pra remontar (e
 * resincronizar o texto inicial) toda vez que o dia muda. Salvar é
 * explícito (botão), não automático — é um valor em dinheiro, o dono
 * precisa de confirmação clara de que salvou, igual "Salvar faixas" em
 * Ajustes. Pra editar depois, é só digitar de novo e salvar de novo. */
function CampoCustoDoDia({
  valorInicial,
  onSalvar,
}: {
  valorInicial: number
  onSalvar: (centavos: number) => Promise<boolean>
}) {
  const [texto, setTexto] = useState(() => textoPrecoInicial(valorInicial))
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState(false)

  function aoMudar(valor: string) {
    setTexto(valor.replace(/[^\d.,]/g, ''))
    setSalvo(false)
    setErro(false)
  }

  async function salvar() {
    setSalvando(true)
    setErro(false)

    const ok = await onSalvar(reaisParaCentavos(texto))

    setSalvando(false)

    if (!ok) {
      setErro(true)
      return
    }

    setSalvo(true)
  }

  return (
    <div className="mt-2">
      <div className="flex items-end gap-2">
        <Input
          label="Custo do dia (gás, ingredientes...)"
          type="currency"
          size="sm"
          inputMode="decimal"
          value={texto}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder="0,00"
          aria-label="Custo do dia"
          className="w-36"
        />
        <Button size="sm" onClick={salvar} loading={salvando}>
          {salvo ? 'Salvo!' : 'Salvar'}
        </Button>
      </div>
      {erro && (
        <p className="mt-1.5 text-xs font-medium text-mesa-error-500">
          Não foi possível salvar. Tente de novo.
        </p>
      )}
    </div>
  )
}

/** Custo é um número único lançado à mão por dia — não é controle de
 * estoque, só o suficiente pra comparar contra a receita e mostrar lucro
 * líquido. Editável quando o período é um dia só; em períodos maiores só
 * soma o que já foi lançado dia a dia (lançar retroativo pra vários dias de
 * uma vez fica pra outra hora). */
export function SecaoCustoLucro({
  barraca,
  intervalo,
  receitaLiquidaCentavos,
}: {
  barraca: Barraca
  intervalo: IntervaloData
  receitaLiquidaCentavos: number
}) {
  const [custos, setCustos] = useState<CustoDiario[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)

    supabase
      .from('custos_diarios')
      .select('*')
      .eq('barraca_id', barraca.id)
      .gte('data', intervalo.inicio)
      .lte('data', intervalo.fim)
      .then(({ data, error }) => {
        if (cancelado) return
        if (!error) setCustos((data ?? []) as CustoDiario[])
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barraca.id, intervalo.inicio, intervalo.fim])

  if (carregando) return null

  const periodoDeUmDiaSo = intervalo.inicio === intervalo.fim
  const custoTotalCentavos = custos.reduce((soma, c) => soma + c.valor_centavos, 0)
  const diasComRegistro = custos.filter((c) => c.valor_centavos > 0).length
  const lucroLiquidoCentavos = receitaLiquidaCentavos - custoTotalCentavos

  async function salvarCustoDoDia(centavos: number): Promise<boolean> {
    const { data, error } = await supabase
      .from('custos_diarios')
      .upsert(
        { barraca_id: barraca.id, data: intervalo.inicio, valor_centavos: centavos },
        { onConflict: 'barraca_id,data' },
      )
      .select()
      .single()

    if (error || !data) return false

    setCustos([data as CustoDiario])
    return true
  }

  return (
    <SecaoRelatorio titulo="Custo e lucro" icone="paid">
      {periodoDeUmDiaSo ? (
        <CampoCustoDoDia key={intervalo.inicio} valorInicial={custoTotalCentavos} onSalvar={salvarCustoDoDia} />
      ) : (
        <p className="text-sm text-mesa-text-secondary">
          Custo registrado no período: {formatarPrecoBR(custoTotalCentavos)} ({diasComRegistro} de{' '}
          {diasNoIntervalo(intervalo)} dia{diasNoIntervalo(intervalo) === 1 ? '' : 's'} lançados)
        </p>
      )}

      {custoTotalCentavos > 0 && (
        <p className="mt-2">
          <span
            className={`font-mesa-display text-2xl font-black ${
              lucroLiquidoCentavos >= 0 ? 'text-mesa-success-700 dark:text-mesa-success-500' : 'text-mesa-error-500'
            }`}
          >
            {formatarPrecoBR(lucroLiquidoCentavos)}
          </span>{' '}
          <span className="text-sm font-medium text-mesa-text-secondary">lucro líquido</span>
        </p>
      )}
    </SecaoRelatorio>
  )
}
