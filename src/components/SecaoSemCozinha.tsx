import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/**
 * Barraca sem cozinha: com o interruptor desligado, o pedido já nasce entregue (nunca fica em "A fazer"), e o app
 * esconde Cozinha e Chamada. Só aparece depois da migration `20261108100000` (coluna ausente = seção escondida).
 */
export function SecaoSemCozinha({ barraca }: { barraca: Barraca }) {
  const usaR = useRascunho(barraca.usa_cozinha !== false)
  const salvar = useSalvarBarraca(barraca)

  if (barraca.usa_cozinha === undefined) return null

  async function alternar(valor: boolean) {
    usaR.definir(valor)
    await salvar.salvar({ usa_cozinha: valor })
    usaR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="skillet" size={14} />
        Cozinha
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Desligue se a sua operação não tem cozinha: o pedido sai direto para o Histórico e as telas Cozinha e Chamada
          somem do app.
        </p>
        <label
          htmlFor="usa-cozinha"
          className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
        >
          <span className="min-w-0 text-base text-mesa-text-primary">Minha barraca usa cozinha</span>
          <Toggle id="usa-cozinha" checked={usaR.valor} onChange={alternar} aria-label="Minha barraca usa cozinha" />
        </label>
        <ErroSalvar erro={salvar.erro} className="mt-2" />
      </Card>
    </section>
  )
}
