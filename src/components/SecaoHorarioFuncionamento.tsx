import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { HorarioFuncionamento } from '../types/database'

type LinhaHorario = {
  dia_semana: number
  aberto: boolean
  hora_abertura: string
  hora_fechamento: string
}

const DIAS: { valor: number; rotulo: string }[] = [
  { valor: 0, rotulo: 'Domingo' },
  { valor: 1, rotulo: 'Segunda' },
  { valor: 2, rotulo: 'Terça' },
  { valor: 3, rotulo: 'Quarta' },
  { valor: 4, rotulo: 'Quinta' },
  { valor: 5, rotulo: 'Sexta' },
  { valor: 6, rotulo: 'Sábado' },
]

const HORA_ABERTURA_PADRAO = '18:00'
const HORA_FECHAMENTO_PADRAO = '23:00'

const CLASSE_INPUT_HORA =
  'h-10 w-full rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function linhaPadrao(diaSemana: number): LinhaHorario {
  return {
    dia_semana: diaSemana,
    aberto: false,
    hora_abertura: HORA_ABERTURA_PADRAO,
    hora_fechamento: HORA_FECHAMENTO_PADRAO,
  }
}

/** Horário de funcionamento por dia (pedido de produto 2026-09-27,
 * inspirado num print de Configurações de concorrente) — usado no
 * Cardápio Digital público pra mostrar "Aberto agora"/"Fechado". A UI
 * sempre trabalha com as 7 linhas (Domingo–Sábado) via upsert, nunca
 * cria/apaga linha avulsa — dia sem registro no banco só significa
 * "fechado", mesmo espírito de outros toggles simples do app. */
export function SecaoHorarioFuncionamento({ barracaId }: { barracaId: string }) {
  const [horarios, setHorarios] = useState<LinhaHorario[]>(() => DIAS.map((d) => linhaPadrao(d.valor)))
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    supabase
      .from('horarios_funcionamento')
      .select('*')
      .eq('barraca_id', barracaId)
      .then(({ data }) => {
        if (cancelado) return
        const salvos = (data ?? []) as HorarioFuncionamento[]
        setHorarios(
          DIAS.map((d) => {
            const salvo = salvos.find((h) => h.dia_semana === d.valor)
            if (!salvo) return linhaPadrao(d.valor)
            return {
              dia_semana: d.valor,
              aberto: salvo.aberto,
              hora_abertura: salvo.hora_abertura ?? HORA_ABERTURA_PADRAO,
              hora_fechamento: salvo.hora_fechamento ?? HORA_FECHAMENTO_PADRAO,
            }
          }),
        )
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [barracaId])

  async function persistirDia(linha: LinhaHorario) {
    setErro(null)
    const { error } = await supabase.from('horarios_funcionamento').upsert(
      {
        barraca_id: barracaId,
        dia_semana: linha.dia_semana,
        aberto: linha.aberto,
        hora_abertura: linha.aberto ? linha.hora_abertura : null,
        hora_fechamento: linha.aberto ? linha.hora_fechamento : null,
      },
      { onConflict: 'barraca_id,dia_semana' },
    )

    if (error) setErro('Não foi possível salvar um dos dias. Tente novamente.')
  }

  function alterarLinha(diaSemana: number, alteracoes: Partial<LinhaHorario>) {
    setHorarios((atual) => {
      const novaLista = atual.map((h) => (h.dia_semana === diaSemana ? { ...h, ...alteracoes } : h))
      const linha = novaLista.find((h) => h.dia_semana === diaSemana)
      if (linha) persistirDia(linha)
      return novaLista
    })
  }

  return (
    <section>
      <RotuloSecao icone="schedule">Horário de funcionamento</RotuloSecao>
      <Card>
        <p className="mb-3 text-sm text-mesa-text-secondary">
          Usado no cardápio público pra mostrar "Aberto agora" ou "Fechado".
        </p>

        {carregando ? (
          <p className="text-sm text-mesa-text-secondary">Carregando...</p>
        ) : (
          <ul className="flex flex-col gap-3 divide-y divide-mesa-border-subtle">
            {horarios.map((linha, indice) => {
              const dia = DIAS[indice]
              return (
                <li key={dia.valor} className={`flex flex-col gap-2 ${indice > 0 ? 'pt-3' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-mesa-text-primary">{dia.rotulo}</span>
                    <Toggle
                      checked={linha.aberto}
                      onChange={(valor) => alterarLinha(dia.valor, { aberto: valor })}
                      aria-label={`${dia.rotulo} aberto`}
                    />
                  </div>
                  {linha.aberto && (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={linha.hora_abertura}
                        onChange={(e) => alterarLinha(dia.valor, { hora_abertura: e.target.value })}
                        aria-label={`Horário de abertura de ${dia.rotulo}`}
                        className={CLASSE_INPUT_HORA}
                      />
                      <span className="text-sm text-mesa-text-secondary">até</span>
                      <input
                        type="time"
                        value={linha.hora_fechamento}
                        onChange={(e) => alterarLinha(dia.valor, { hora_fechamento: e.target.value })}
                        aria-label={`Horário de fechamento de ${dia.rotulo}`}
                        className={CLASSE_INPUT_HORA}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {erro && <p className="mt-3 text-sm font-medium text-mesa-error-500">{erro}</p>}
      </Card>
    </section>
  )
}
