import { DESCRICAO_MODO, ICONE_MODO, ROTULO_MODO, TODOS_OS_MODOS } from '../lib/atendimento'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { TipoAtendimento } from '../types/database'

/**
 * Lista de modos de atendimento (Mesa, Balcão, Retirada, Entrega) com um toggle cada. Só apresentação:
 * quem usa decide como salvar e a regra de "ao menos um ativo". Usado por Ajustes (SecaoModosAtendimento)
 * e pelo assistente de configuração inicial, com o mesmo visual.
 */
export function SeletorModos({
  ativos,
  onAlternar,
  prefixoId = 'modo',
}: {
  ativos: TipoAtendimento[]
  onAlternar: (modo: TipoAtendimento) => void
  /** Evita id duplicado quando a lista aparece mais de uma vez na mesma página. */
  prefixoId?: string
}) {
  return (
    <ul className="mt-2 divide-y divide-mesa-border-subtle">
      {TODOS_OS_MODOS.map((modo) => (
        <li key={modo}>
          <label
            htmlFor={`${prefixoId}-${modo}`}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-3"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icone nome={ICONE_MODO[modo]} size={20} />
              <span className="min-w-0">
                <span className="block text-base text-mesa-text-primary">{ROTULO_MODO[modo]}</span>
                <span className="block text-xs text-mesa-text-secondary">{DESCRICAO_MODO[modo]}</span>
              </span>
            </span>
            <Toggle
              id={`${prefixoId}-${modo}`}
              checked={ativos.includes(modo)}
              onChange={() => onAlternar(modo)}
              aria-label={ROTULO_MODO[modo]}
            />
          </label>
        </li>
      ))}
    </ul>
  )
}
