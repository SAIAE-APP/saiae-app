import { useState } from 'react'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { textoDesconto } from '../lib/cupomApi'
import type { CupomAplicado } from '../hooks/useCupom'

/** "Tem cupom?" no resumo do pedido do cardápio digital. O desconto mostrado vem do servidor. */
export function CampoCupom({
  aplicado,
  validando,
  erro,
  aviso,
  onAplicar,
  onRemover,
}: {
  aplicado: CupomAplicado | null
  validando: boolean
  erro: string | null
  aviso: string | null
  onAplicar: (codigo: string) => void
  onRemover: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [codigo, setCodigo] = useState('')

  if (aplicado) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-mesa-md bg-mesa-success-50 px-3 py-2 dark:bg-mesa-success-500/15">
        <p className="min-w-0 truncate text-sm font-medium text-mesa-success-700 dark:text-mesa-success-500">
          Cupom {aplicado.codigo}: {textoDesconto(aplicado.descontoCentavos)}
        </p>
        <button type="button" onClick={onRemover} className="min-h-11 shrink-0 px-2 text-sm font-medium text-mesa-text-secondary underline">
          Remover
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {aviso && (
        <p role="status" className="text-sm text-mesa-text-secondary">
          {aviso}
        </p>
      )}
      {!aberto ? (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-mesa-text-primary underline underline-offset-2"
        >
          <Icone nome="add" size={16} />
          Tem cupom?
        </button>
      ) : (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!validando) onAplicar(codigo)
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              label="Código do cupom"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              maxLength={20}
              autoCapitalize="characters"
              autoComplete="off"
              error={erro ?? undefined}
            />
          </div>
          <Button type="submit" variant="outline" size="lg" className="mt-[22px] shrink-0" loading={validando} disabled={validando || codigo.trim().length < 3}>
            Aplicar
          </Button>
        </form>
      )}
    </div>
  )
}
