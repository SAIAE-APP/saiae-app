import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { FUSOS_BARRACA, fusoDaBarraca } from '../lib/horarioFuncionamento'
import { ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Chip } from './ui/Chip'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import { CampoHorarioDia } from './CampoHorarioDia'
import type { Barraca, HorarioFuncionamento } from '../types/database'

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
export function SecaoHorarioFuncionamento({ barraca }: { barraca: Barraca }) {
  const barracaId = barraca.id
  const bloquearR = useRascunho(Boolean(barraca.bloquear_fora_do_horario))
  const salvarBloquear = useSalvarBarraca(barraca)
  const fusoR = useRascunho(fusoDaBarraca(barraca.fuso))
  const salvarFuso = useSalvarBarraca(barraca)

  async function alternarBloqueio(valor: boolean) {
    bloquearR.definir(valor)
    await salvarBloquear.salvar({ bloquear_fora_do_horario: valor })
    bloquearR.descartar()
  }

  async function trocarFuso(fuso: string) {
    fusoR.definir(fuso)
    await salvarFuso.salvar({ fuso })
    fusoR.descartar()
  }

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
                <CampoHorarioDia
                  key={dia.valor}
                  rotulo={dia.rotulo}
                  linha={linha}
                  primeiro={indice === 0}
                  onAlterar={(alteracoes) =>
                    alterarLinha(
                      dia.valor,
                      alteracoes as Partial<LinhaHorario>,
                    )
                  }
                />
              )
            })}
          </ul>
        )}

        {erro && <p className="mt-3 text-sm font-medium text-mesa-error-500">{erro}</p>}

        <div className="mt-4 border-t border-mesa-border-subtle pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-mesa-text-primary">
              Não aceitar pedidos do cardápio fora do horário
            </span>
            <Toggle
              checked={bloquearR.valor}
              onChange={alternarBloqueio}
              aria-label="Não aceitar pedidos do cardápio fora do horário"
            />
          </div>
          <p className="mt-1 text-xs text-mesa-text-secondary">
            Desligado, o cardápio só mostra "Aberto" ou "Fechado" e continua recebendo pedidos. Ligado, pedidos novos
            fora do horário são recusados. Pedido já pago nunca é recusado.
          </p>
          <ErroSalvar erro={salvarBloquear.erro} className="mt-2" />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-mesa-text-primary">Fuso horário da barraca</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fuso horário da barraca">
            {FUSOS_BARRACA.map((f) => (
              <Chip key={f.valor} checked={fusoR.valor === f.valor} onClick={() => void trocarFuso(f.valor)}>
                {f.rotulo}
              </Chip>
            ))}
          </div>
          <ErroSalvar erro={salvarFuso.erro} className="mt-2" />
        </div>
      </Card>
    </section>
  )
}
