import { useState, type ReactNode } from 'react'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { configTaxaEntrega } from '../lib/entrega'
import { centavosParaReais, filtrarEntradaPreco, formatarPrecoBR, reaisParaCentavos } from '../lib/preco'
import { BotaoSalvarCampo, ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Input } from './ui/Input'
import { Toggle } from './ui/Toggle'
import type { Barraca } from '../types/database'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

function reaisParaTexto(centavos: number): string {
  return centavosParaReais(centavos).toFixed(2).replace('.', ',')
}

/**
 * Taxa de entrega cobrada do cliente final. Liga/desliga e "editar no pedido"
 * salvam na hora (e voltam pro valor do banco se falhar); o valor padrão salva
 * pelo botão "Salvar valor", como os outros campos de Ajustes.
 */
export function SecaoTaxaEntrega({ barraca }: { barraca: Barraca }) {
  const config = configTaxaEntrega(barraca)
  const habilitadaR = useRascunho(config.habilitada)
  const editavelR = useRascunho(config.editavel)
  const valorR = useRascunho(
    reaisParaTexto(config.centavos),
    (a, b) => reaisParaCentavos(a) === reaisParaCentavos(b),
  )
  const [aviso, setAviso] = useState<string | null>(null)
  const toggles = useSalvarBarraca(barraca)
  const valorSalvador = useSalvarBarraca(barraca)

  async function alternarHabilitada(valor: boolean) {
    habilitadaR.definir(valor)
    await toggles.salvar({ taxa_entrega_habilitada: valor })
    // sucesso: o cache já traz o valor novo; falha: volta pro que está no banco
    habilitadaR.descartar()
  }

  async function alternarEditavel(valor: boolean) {
    editavelR.definir(valor)
    await toggles.salvar({ taxa_entrega_editavel: valor })
    editavelR.descartar()
  }

  async function salvarValor() {
    if (!valorR.valor.trim()) {
      setAviso('Informe o valor da taxa (use 0 para entrega grátis).')
      return
    }
    setAviso(null)
    const ok = await valorSalvador.salvar({ taxa_entrega_centavos: reaisParaCentavos(valorR.valor) })
    if (ok) valorR.descartar()
  }

  return (
    <section>
      <RotuloSecao icone="two_wheeler">Taxa de entrega</RotuloSecao>
      <Card>
        <label
          htmlFor="taxa-entrega-habilitada"
          className="flex min-h-11 cursor-pointer items-center justify-between gap-3"
        >
          <span className="min-w-0">
            <span className="block text-base text-mesa-text-primary">Cobrar taxa de entrega</span>
            <span className="block text-xs text-mesa-text-secondary">
              Entra no total do pedido de Entrega, em linha separada
            </span>
          </span>
          <Toggle
            id="taxa-entrega-habilitada"
            checked={habilitadaR.valor}
            onChange={alternarHabilitada}
            aria-label="Cobrar taxa de entrega"
          />
        </label>

        {habilitadaR.valor && (
          <>
            <div className="mt-3 border-t border-mesa-border-subtle pt-3">
              <Input
                type="currency"
                label="Valor padrão da taxa"
                inputMode="decimal"
                value={valorR.valor}
                onChange={(e) => valorR.definir(filtrarEntradaPreco(e.target.value))}
                helpText={`Valor salvo: ${formatarPrecoBR(config.centavos)}`}
              />
              {aviso && <p className="mt-2 text-sm font-medium text-mesa-warning-700">{aviso}</p>}
              <BotaoSalvarCampo
                alterado={valorR.alterado}
                salvando={valorSalvador.salvando}
                salvo={valorSalvador.salvo}
                erro={valorSalvador.erro}
                onSalvar={salvarValor}
                rotulo="Salvar valor"
                className="mt-3"
              />
            </div>

            <label
              htmlFor="taxa-entrega-editavel"
              className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-mesa-border-subtle pt-3"
            >
              <span className="min-w-0">
                <span className="block text-base text-mesa-text-primary">Editar valor no pedido</span>
                <span className="block text-xs text-mesa-text-secondary">
                  O caixa pode mudar a taxa em cada entrega
                </span>
              </span>
              <Toggle
                id="taxa-entrega-editavel"
                checked={editavelR.valor}
                onChange={alternarEditavel}
                aria-label="Editar valor da taxa no pedido"
              />
            </label>
          </>
        )}

        <ErroSalvar erro={toggles.erro} className="mt-2" />
      </Card>
    </section>
  )
}
