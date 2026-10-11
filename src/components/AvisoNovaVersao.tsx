import { useState } from 'react'
import { useNovaVersao } from '../hooks/useNovaVersao'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

/** Faixa discreta no topo: "Nova versão disponível". Não bloqueia nada e nunca recarrega sozinha. */
export function AvisoNovaVersao() {
  const { disponivel, atualizar } = useNovaVersao()
  const [dispensado, setDispensado] = useState(false)
  if (!disponivel || dispensado) return null

  return (
    <div
      role="status"
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-50 mx-auto flex max-w-md items-center gap-2 rounded-mesa-xl border border-mesa-border-default bg-mesa-surface p-3 shadow-lg"
    >
      <Icone nome="download" size={20} className="shrink-0 text-mesa-text-secondary" />
      <p className="min-w-0 flex-1 text-sm font-medium text-mesa-text-primary">Nova versão disponível</p>
      <Button size="md" onClick={atualizar}>
        Atualizar
      </Button>
      <Button size="md" variant="ghost" onClick={() => setDispensado(true)}>
        Depois
      </Button>
    </div>
  )
}
