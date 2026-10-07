import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { BotaoSalvarCampo } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/**
 * Estoque por item: o dono escolhe o que acontece ao vender acima do saldo.
 * Desligado (padrão): não bloqueia, mas AVISA no Lançar Pedido e destaca o saldo
 * negativo aqui em Ajustes. Ligado: bloqueia ao adicionar/enviar (app e cardápio
 * digital, inclusive Pix). Nunca recusa pedido que já está na fila ou sincronizando.
 */
export function SecaoEstoque({ barraca }: { barraca: Barraca }) {
  const bloqueiaR = useRascunho(Boolean(barraca.estoque_bloqueia))
  const { salvar, salvando, salvo, erro } = useSalvarBarraca(barraca)

  async function aoSalvar() {
    const ok = await salvar({ estoque_bloqueia: bloqueiaR.valor })
    if (ok) bloqueiaR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="receipt_long" size={14} />
        Estoque
      </h2>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base text-mesa-text-primary">Bloquear venda acima do estoque</p>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              {bloqueiaR.valor
                ? 'Ligado: itens com estoque controlado não passam do saldo (no app e no cardápio digital).'
                : 'Desligado: a venda segue além do saldo, o app avisa na hora e o estoque fica negativo.'}
            </p>
          </div>
          <Toggle
            checked={bloqueiaR.valor}
            onChange={(valor) => bloqueiaR.definir(valor)}
            aria-label="Bloquear venda acima do estoque"
          />
        </div>
        <p className="mt-3 text-xs text-mesa-text-tertiary">
          Só vale para itens com “Controlar estoque” ligado. Pedido que já foi enviado ou está na fila nunca é
          recusado por estoque. Dois operadores vendendo quase ao mesmo tempo ainda podem deixar o saldo negativo.
        </p>
        <BotaoSalvarCampo
          alterado={bloqueiaR.alterado}
          salvando={salvando}
          salvo={salvo}
          erro={erro}
          onSalvar={aoSalvar}
          rotulo="Salvar"
          className="mt-3"
        />
      </Card>
    </section>
  )
}
