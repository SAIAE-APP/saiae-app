import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import { modosAtivos } from '../lib/atendimento'
import type { Barraca } from '../types/database'

/**
 * Coluna "Saiu para entrega" no kanban da Cozinha (só pedidos de Entrega). Desligada por padrão: desligada, o kanban é
 * exatamente o de antes. Só aparece com o modo Entrega ligado e com a coluna do banco (migration do Saiu para entrega).
 * Ligue só depois de atualizar o app em TODOS os aparelhos da loja: o app antigo não mostra o pedido em "Saiu".
 */
export function SecaoSaiuEntrega({ barraca }: { barraca: Barraca }) {
  const habilitadoR = useRascunho(barraca.saiu_entrega_habilitado === true)
  const salvar = useSalvarBarraca(barraca)

  if (barraca.saiu_entrega_habilitado === undefined) return null
  if (!modosAtivos(barraca).includes('entrega')) return null

  async function alternar(valor: boolean) {
    habilitadoR.definir(valor)
    await salvar.salvar({ saiu_entrega_habilitado: valor })
    habilitadoR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="local_shipping" size={14} />
        Saiu para entrega
      </h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Adiciona a coluna "Saiu para entrega" na Cozinha, só para pedidos de Entrega: depois de Pronto, você toca em "Saiu
          para entrega" (e pode mandar o link ao entregador) e, quando o cliente recebe, em "Entregue".
        </p>
        <label
          htmlFor="saiu-entrega-habilitado"
          className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
        >
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Usar a coluna "Saiu para entrega"</span>
            <span className="block text-xs text-mesa-text-secondary">
              Ligue só depois de atualizar o app em todos os aparelhos da loja.
            </span>
          </span>
          <Toggle
            id="saiu-entrega-habilitado"
            checked={habilitadoR.valor}
            onChange={alternar}
            aria-label="Usar a coluna Saiu para entrega na Cozinha"
          />
        </label>
        <ErroSalvar erro={salvar.erro} className="mt-2" />
      </Card>
    </section>
  )
}
