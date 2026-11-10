import { Checkbox } from '../ui/Checkbox'

/** Taxa de serviço Sai aê: o cliente escolhe pagar ou não; já vem marcada. O servidor recalcula o total. */
export function TaxaServicoOpcional({
  aceita,
  onChange,
  valorFormatado,
}: {
  aceita: boolean
  onChange: (aceita: boolean) => void
  valorFormatado: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-mesa-text-secondary">
      <Checkbox checked={aceita} onChange={onChange} label="Taxa de serviço Sai aê (opcional)" />
      <span className={aceita ? undefined : 'line-through'}>{valorFormatado}</span>
    </div>
  )
}
