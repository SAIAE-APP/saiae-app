import type { ModeloDeOpcoes } from '../lib/modelosDeOpcoes'

function regraDoModelo(m: ModeloDeOpcoes): string {
  if (m.tipo === 'variacao') return 'Variação · escolha 1'
  const obrigatorio = m.obrigatorio ? 'obrigatório' : 'opcional'
  const minimo = (m.minimo ?? 1) > 1 ? ` · mínimo ${m.minimo}` : ''
  const maximo = m.maximo !== null ? ` · até ${m.maximo}` : ''
  return `Adicional · ${obrigatorio}${minimo}${maximo}`
}

/** Lista de modelos da biblioteca (um botão por modelo), usada em Ajustes › Opções › "Usar modelo". */
export function ListaDeModelos({
  titulo,
  modelos,
  vazio,
  aoEscolher,
}: {
  titulo: string | null
  modelos: ModeloDeOpcoes[]
  vazio: string | null
  aoEscolher: (m: ModeloDeOpcoes) => void
}) {
  if (modelos.length === 0) return vazio ? <p className="text-sm text-mesa-text-secondary">{vazio}</p> : null
  return (
    <div className="flex flex-col gap-2">
      {titulo && <p className="text-xs font-semibold uppercase tracking-wide text-mesa-text-secondary">{titulo}</p>}
      {modelos.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => aoEscolher(m)}
          className="min-h-[44px] rounded-mesa-lg border border-mesa-border-default p-3 text-left"
        >
          <span className="block text-base font-semibold text-mesa-text-primary">{m.titulo}</span>
          <span className="block text-sm text-mesa-text-secondary">{m.descricao}</span>
          <span className="mt-1 block text-xs text-mesa-text-tertiary">{regraDoModelo(m)}</span>
        </button>
      ))}
    </div>
  )
}
