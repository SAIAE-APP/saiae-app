import { Toggle } from './ui/Toggle'

export type LinhaHorarioDia = { aberto: boolean; hora_abertura: string; hora_fechamento: string }

const CLASSE_INPUT_HORA =
  'h-10 w-full rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-sm text-mesa-text-primary outline-none focus:border-mesa-orange-500'

/**
 * Uma linha da lista de horários: nome do dia, toggle aberto/fechado e, aberto, os dois horários.
 * Só apresentação (quem usa salva). Usado por Ajustes (SecaoHorarioFuncionamento) e pelo assistente de
 * configuração inicial. `onIgualAoAnterior` só aparece no assistente ("Igual ao dia anterior"); em Ajustes
 * não é passado e a linha fica exatamente como era.
 */
export function CampoHorarioDia({
  rotulo,
  linha,
  primeiro,
  onAlterar,
  onIgualAoAnterior,
}: {
  rotulo: string
  linha: LinhaHorarioDia
  /** A primeira linha da lista não leva o espaçamento de cima. */
  primeiro: boolean
  onAlterar: (alteracoes: Partial<LinhaHorarioDia>) => void
  onIgualAoAnterior?: () => void
}) {
  return (
    <li className={`flex flex-col gap-2 ${primeiro ? '' : 'pt-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-mesa-text-primary">{rotulo}</span>
        <Toggle checked={linha.aberto} onChange={(valor) => onAlterar({ aberto: valor })} aria-label={`${rotulo} aberto`} />
      </div>
      {linha.aberto && (
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={linha.hora_abertura}
            onChange={(e) => onAlterar({ hora_abertura: e.target.value })}
            aria-label={`Horário de abertura de ${rotulo}`}
            className={CLASSE_INPUT_HORA}
          />
          <span className="text-sm text-mesa-text-secondary">até</span>
          <input
            type="time"
            value={linha.hora_fechamento}
            onChange={(e) => onAlterar({ hora_fechamento: e.target.value })}
            aria-label={`Horário de fechamento de ${rotulo}`}
            className={CLASSE_INPUT_HORA}
          />
        </div>
      )}
      {onIgualAoAnterior && (
        <button
          type="button"
          onClick={onIgualAoAnterior}
          className="flex min-h-11 w-fit items-center text-xs font-medium text-mesa-text-secondary underline"
        >
          Igual ao dia anterior
        </button>
      )}
    </li>
  )
}
