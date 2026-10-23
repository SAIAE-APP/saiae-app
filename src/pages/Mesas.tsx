import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { useComandasAbertas } from '../hooks/useComandas'
import { comandaAbertaLigada } from '../lib/comandaAberta'
import { minutosEntre } from '../lib/tempoPedido'
import { formatarPrecoBR } from '../lib/preco'
import { FecharComandaSheet } from '../components/FecharComandaSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { Icone } from '../components/ui/Icone'

function tempoAberta(abertaEm: string): string {
  const min = minutosEntre(abertaEm, new Date().toISOString())
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

const rotuloSenha = (n: number | null) => (n == null ? 'sem senha' : `senha ${String(n).padStart(3, '0')}`)

// Rota sempre disponível por URL: comanda de barraca que desligou a opção continua listada e fechável.
export function Mesas() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const { comandas, carregando, erro } = useComandasAbertas(barraca.id)
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)
  const detalhe = comandas.find((c) => c.id === abertaId) ?? null

  return (
    <div className="min-h-dvh bg-mesa-bg-base pb-24">
      <div className="px-6 pt-6">
        <CabecalhoPagina titulo={detalhe ? `Mesa ${detalhe.mesa}` : 'Mesas abertas'} />
      </div>
      <div className="mx-auto max-w-3xl px-6 pt-4">
        {erro && <p className="mb-3 text-sm font-medium text-mesa-error-700">{erro}</p>}

        {detalhe ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-mesa-text-secondary">
              Aberta há {tempoAberta(detalhe.abertaEm)} · total parcial{' '}
              <span className="font-mesa-display font-bold text-mesa-text-primary">
                {formatarPrecoBR(detalhe.subtotalCentavos)}
              </span>
            </p>
            {detalhe.rodadas.length === 0 && (
              <p className="text-sm text-mesa-text-secondary">Nenhuma rodada ativa nesta comanda.</p>
            )}
            {detalhe.rodadas.map((r, i) => (
              <Card key={r.pedidoId}>
                <p className="text-sm font-semibold text-mesa-text-primary">
                  Rodada {i + 1} · {rotuloSenha(r.senha)}
                </p>
                <ul className="mt-2 text-sm text-mesa-text-secondary">
                  {r.itens.map((it, j) => (
                    <li key={j}>
                      {it.quantidade}x {it.nome}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            {comandaAbertaLigada(barraca) && (
              <Button
                variant="outline"
                size="lg"
                className="min-h-11"
                onClick={() =>
                  navigate(`/${barraca.slug}/lancar`, { state: { tipoAtendimento: 'mesa', comandaMesa: detalhe.mesa } })
                }
              >
                Adicionar item à Mesa {detalhe.mesa}
              </Button>
            )}
            <Button size="lg" className="min-h-11" onClick={() => setFechando(true)}>
              Fechar comanda e cobrar
            </Button>
            <Button variant="ghost" size="lg" className="min-h-11" onClick={() => setAbertaId(null)}>
              Voltar às mesas
            </Button>
            {fechando && (
              <FecharComandaSheet
                comanda={detalhe}
                barraca={barraca}
                aoCancelar={() => setFechando(false)}
                aoFechar={() => {
                  setFechando(false)
                  setAbertaId(null)
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!carregando && comandas.length === 0 && (
              <p className="text-sm text-mesa-text-secondary">Nenhuma mesa aberta no momento.</p>
            )}
            {comandas.map((c) => (
              <Card key={c.id} interactive onClick={() => setAbertaId(c.id)} className="flex min-h-11 items-center gap-3">
                <Icone nome="table_restaurant" size={24} />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-mesa-text-primary">Mesa {c.mesa}</p>
                  <p className="text-sm text-mesa-text-secondary">
                    {c.rodadas.length} rodada{c.rodadas.length === 1 ? '' : 's'} · aberta há {tempoAberta(c.abertaEm)}
                  </p>
                </div>
                <span className="font-mesa-display text-lg font-bold text-mesa-text-primary">
                  {formatarPrecoBR(c.subtotalCentavos)}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
