import { useEffect, useState } from 'react'
import type { OrdemAdmin } from '../../lib/adminBarracas'
import { Input } from '../ui/Input'

const ORDENS: { valor: OrdemAdmin; rotulo: string }[] = [
  { valor: 'vencimento', rotulo: 'Vencimento mais próximo' },
  { valor: 'nome', rotulo: 'Nome (A a Z)' },
  { valor: 'atividade', rotulo: 'Mais pedidos recentes' },
  { valor: 'nova', rotulo: 'Mais novas' },
]

/** Busca por nome, slug ou e-mail (aviso ao pai após 300 ms sem digitar) e ordenação da lista. */
export function BarraBuscaAdmin({
  aoBuscar,
  ordem,
  aoOrdenar,
}: {
  aoBuscar: (busca: string) => void
  ordem: OrdemAdmin
  aoOrdenar: (ordem: OrdemAdmin) => void
}) {
  const [texto, setTexto] = useState('')

  useEffect(() => {
    const t = setTimeout(() => aoBuscar(texto), 300)
    return () => clearTimeout(t)
  }, [texto, aoBuscar])

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        type="search"
        label="Buscar barraca"
        placeholder="Nome, endereço ou e-mail do dono"
        className="min-w-0 flex-1"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onClear={() => {
          setTexto('')
          aoBuscar('')
        }}
      />
      <div className="flex flex-col sm:w-64">
        <label htmlFor="ordem-admin" className="mb-1.5 text-xs font-semibold text-mesa-neutral-700 dark:text-mesa-neutral-300">
          Ordenar por
        </label>
        <select
          id="ordem-admin"
          value={ordem}
          onChange={(e) => aoOrdenar(e.target.value as OrdemAdmin)}
          className="h-12 rounded-mesa-sm border-[1.5px] border-mesa-border-default bg-mesa-surface px-3 text-mesa-text-primary"
        >
          {ORDENS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
