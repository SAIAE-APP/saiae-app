import { useId, type ReactNode } from 'react'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'

/** Confirmação de ação do superadmin: alertdialog com foco preso (BottomSheet), Esc fecha e devolve o foco. */
export function DialogoConfirmarAdmin({
  titulo,
  efeito,
  children,
  rotuloConfirmar,
  confirmarHabilitado = true,
  destrutivo = false,
  ocupado,
  erro,
  onConfirmar,
  onFechar,
}: {
  titulo: string
  efeito: string
  children?: ReactNode
  rotuloConfirmar: string
  confirmarHabilitado?: boolean
  destrutivo?: boolean
  ocupado: boolean
  erro: string | null
  onConfirmar: () => void
  onFechar: () => void
}) {
  const idTitulo = useId()
  const idEfeito = useId()
  return (
    <BottomSheet
      open
      onClose={ocupado ? () => {} : onFechar}
      role="alertdialog"
      aria-labelledby={idTitulo}
      aria-describedby={idEfeito}
      className="mx-auto max-w-lg"
    >
      <h2 id={idTitulo} className="text-xl font-bold text-mesa-text-primary">
        {titulo}
      </h2>
      <p id={idEfeito} className="mt-2 text-sm text-mesa-text-secondary">
        {efeito}
      </p>
      {children && <div className="mt-4 flex flex-col gap-3">{children}</div>}
      {erro && (
        <p role="alert" className="mt-3 text-sm font-medium text-mesa-error-500">
          {erro}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <Button variant="outline" size="lg" className="flex-1" disabled={ocupado} onClick={onFechar}>
          Voltar
        </Button>
        <Button
          variant={destrutivo ? 'destructive' : 'confirm'}
          size="lg"
          className="flex-1"
          disabled={!confirmarHabilitado}
          loading={ocupado}
          onClick={onConfirmar}
        >
          {rotuloConfirmar}
        </Button>
      </div>
    </BottomSheet>
  )
}
