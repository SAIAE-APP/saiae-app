import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { bpsDePercentual, percentualDeBps } from '../lib/comandaAberta'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

/**
 * Comanda aberta na Mesa e taxa de serviço. Desligado por padrão: desligado, o app é exatamente o de antes. Banco/cache
 * sem a coluna: a seção não aparece. Os toggles salvam na hora; o percentual (0 a 30) salva pelo botão.
 */
export function SecaoComandaAberta({ barraca }: { barraca: Barraca }) {
  const comandaR = useRascunho(barraca.comanda_aberta_habilitada === true)
  const taxaR = useRascunho(barraca.taxa_servico_habilitada === true)
  const percentualR = useRascunho(percentualDeBps(barraca.taxa_servico_bps ?? 1000), (a, b) => bpsDePercentual(a) === bpsDePercentual(b))
  const toggles = useSalvarBarraca(barraca)
  const percentualSalvador = useSalvarBarraca(barraca)

  if (barraca.comanda_aberta_habilitada === undefined) return null

  const bps = bpsDePercentual(percentualR.valor)

  async function alternarComanda(valor: boolean) {
    comandaR.definir(valor)
    await toggles.salvar({ comanda_aberta_habilitada: valor })
    comandaR.descartar()
  }

  async function alternarTaxa(valor: boolean) {
    taxaR.definir(valor)
    await toggles.salvar({ taxa_servico_habilitada: valor })
    taxaR.descartar()
  }

  async function salvarPercentual() {
    if (bps === null) return
    if (await percentualSalvador.salvar({ taxa_servico_bps: bps })) percentualR.descartar()
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="table_restaurant" size={14} />
        Comanda aberta e taxa de serviço
      </h2>
      <Card>
        <label htmlFor="comanda-aberta-habilitada" className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Comanda aberta na Mesa</span>
            <span className="block text-xs text-mesa-text-secondary">
              Lança várias rodadas na mesa e cobra tudo no fim, em Mesas abertas
            </span>
          </span>
          <Toggle id="comanda-aberta-habilitada" checked={comandaR.valor} onChange={alternarComanda} aria-label="Comanda aberta na Mesa" />
        </label>

        <label
          htmlFor="taxa-servico-habilitada"
          className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
        >
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Cobrar taxa de serviço</span>
            <span className="block text-xs text-mesa-text-secondary">
              Aparece à parte no fechamento da comanda; o operador pode desmarcar
            </span>
          </span>
          <Toggle id="taxa-servico-habilitada" checked={taxaR.valor} onChange={alternarTaxa} aria-label="Cobrar taxa de serviço" />
        </label>

        {taxaR.valor && (
          <div className="mt-3 border-t border-mesa-border-subtle pt-3">
            <Input
              label="Percentual da taxa de serviço (0 a 30)"
              inputMode="decimal"
              value={percentualR.valor}
              onChange={(e) => percentualR.definir(e.target.value)}
              error={bps === null ? 'Informe um percentual de 0 a 30, com até 2 casas.' : undefined}
            />
            <BotaoSalvarCampo
              alterado={percentualR.alterado}
              desabilitado={bps === null}
              salvando={percentualSalvador.salvando}
              salvo={percentualSalvador.salvo}
              erro={percentualSalvador.erro}
              onSalvar={salvarPercentual}
              rotulo="Salvar percentual"
              className="mt-3"
            />
          </div>
        )}
        <ErroSalvar erro={toggles.erro} className="mt-2" />
      </Card>
    </section>
  )
}
