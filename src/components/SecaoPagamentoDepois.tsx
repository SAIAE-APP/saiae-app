import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/**
 * "Pagar depois" (Retirada e Entrega): o pedido vai à cozinha sem a forma de pagamento e o operador dá baixa quando o
 * cliente retira ou recebe (spec 2026-10-08-pagar-depois-e-dividido). Desligado por padrão: desligado, o app é
 * exatamente o de antes. Banco/cache sem a coluna: a seção não aparece.
 */
export function SecaoPagamentoDepois({ barraca }: { barraca: Barraca }) {
  const habilitadoR = useRascunho(barraca.pagamento_depois_habilitado === true)
  const salvar = useSalvarBarraca(barraca)

  if (barraca.pagamento_depois_habilitado === undefined) return null

  async function alternar(valor: boolean) {
    habilitadoR.definir(valor)
    await salvar.salvar({ pagamento_depois_habilitado: valor })
    habilitadoR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="payments" size={14} />
        Pagar depois (Retirada e Entrega)
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Em Retirada e Entrega, o pedido vai para a cozinha sem a forma de pagamento. Ele aparece como "A receber" e, ao
          tocar em Entregue, você escolhe como o cliente pagou. A nota fiscal sai com a forma que você escolheu.
        </p>
        <label
          htmlFor="pagamento-depois-habilitado"
          className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
        >
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Oferecer "Pagar depois"</span>
            <span className="block text-xs text-mesa-text-secondary">Aparece em Confirmar Pedido (Retirada e Entrega)</span>
          </span>
          <Toggle
            id="pagamento-depois-habilitado"
            checked={habilitadoR.valor}
            onChange={alternar}
            aria-label="Oferecer pagar depois em Retirada e Entrega"
          />
        </label>
        <ErroSalvar erro={salvar.erro} className="mt-2" />
      </Card>
    </section>
  )
}
