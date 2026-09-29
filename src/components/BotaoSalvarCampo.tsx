import { Button } from './ui/Button'
import { Icone } from './ui/Icone'

/** Erro de save visível (toggles e chips que salvam na hora usam só isso). */
export function ErroSalvar({ erro, className }: { erro: string | null; className?: string }) {
  if (!erro) return null
  return (
    <p role="alert" className={`text-sm font-medium text-mesa-error-500 ${className ?? ''}`}>
      {erro}
    </p>
  )
}

/**
 * Botão "Salvar" explícito de um campo/grupo de Ajustes. Sempre outline: o
 * primário mostarda é da ação principal da tela ("um primário por tela"), e
 * h-11 (44px) cumpre a área de toque mínima. Só habilita com alteração.
 */
export function BotaoSalvarCampo({
  alterado,
  salvando,
  salvo,
  erro,
  onSalvar,
  rotulo = 'Salvar',
  desabilitado = false,
  className,
}: {
  alterado: boolean
  salvando: boolean
  salvo: boolean
  erro: string | null
  onSalvar: () => void
  rotulo?: string
  desabilitado?: boolean
  className?: string
}) {
  const mostrarSalvo = salvo && !alterado && !salvando
  return (
    <div className={className}>
      <Button
        variant="outline"
        size="md"
        loading={salvando}
        disabled={!alterado || desabilitado || salvando}
        icon={mostrarSalvo ? <Icone nome="check" size={16} /> : undefined}
        onClick={onSalvar}
      >
        {mostrarSalvo ? 'Salvo' : rotulo}
      </Button>
      <div aria-live="polite">
        <ErroSalvar erro={erro} className="mt-2" />
      </div>
    </div>
  )
}
