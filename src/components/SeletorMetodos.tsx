import { METODOS_DISPONIVEIS } from '../lib/metodoPagamento'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'

/**
 * Lista de formas de pagamento aceitas (Dinheiro, Débito, Crédito, Pix) com um toggle cada. Só apresentação:
 * quem usa decide como salvar e a regra de "ao menos um ativo". Usado por Ajustes (SecaoPagamento) e pelo
 * assistente de configuração inicial, com o mesmo visual.
 */
export function SeletorMetodos({
  ativos,
  onAlternar,
  prefixoId = 'metodo',
}: {
  ativos: string[]
  onAlternar: (chave: string) => void
  prefixoId?: string
}) {
  return (
    <ul className="divide-y divide-mesa-border-subtle">
      {METODOS_DISPONIVEIS.map((metodo) => (
        <li key={metodo.chave}>
          <label
            htmlFor={`${prefixoId}-${metodo.chave}`}
            className="flex cursor-pointer items-center justify-between gap-3 py-3"
          >
            <span className="inline-flex items-center gap-2 text-base text-mesa-text-primary">
              <Icone nome={metodo.icone} size={16} />
              {metodo.label}
            </span>
            <Toggle
              id={`${prefixoId}-${metodo.chave}`}
              checked={ativos.includes(metodo.chave)}
              onChange={() => onAlternar(metodo.chave)}
              aria-label={metodo.label}
            />
          </label>
        </li>
      ))}
    </ul>
  )
}
