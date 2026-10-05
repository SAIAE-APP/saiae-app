import { useState, type ReactNode } from 'react'
import { useRascunho, useSalvarBarraca } from '../hooks/useSalvarBarraca'
import { DESCRICAO_MODO, ICONE_MODO, ROTULO_MODO, TODOS_OS_MODOS, modosAtivos } from '../lib/atendimento'
import { ErroSalvar } from './BotaoSalvarCampo'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import { Toggle } from './ui/Toggle'
import type { Barraca, TipoAtendimento } from '../types/database'

function RotuloSecao({ icone, children }: { icone?: string; children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
      {icone && <Icone nome={icone} size={14} />}
      {children}
    </h2>
  )
}

/**
 * Modos de atendimento que a barraca usa (Mesa, Balcão, Retirada, Entrega).
 * A tela de Lançar Pedido mostra só os ligados; ao menos um fica sempre ativo.
 * Liga/desliga salva na hora e volta pro valor do banco se falhar (mesmo
 * padrão do toggle de métodos de pagamento).
 */
export function SecaoModosAtendimento({ barraca }: { barraca: Barraca }) {
  const servidor = modosAtivos(barraca)
  const rascunho = useRascunho<TipoAtendimento[]>(servidor, (a, b) => a.join() === b.join())
  const ativos = rascunho.valor
  const [aviso, setAviso] = useState<string | null>(null)
  const salvador = useSalvarBarraca(barraca)

  async function alternar(modo: TipoAtendimento) {
    const estaAtivo = ativos.includes(modo)
    if (estaAtivo && ativos.length === 1) {
      setAviso('Você precisa ter ao menos um tipo de atendimento ativo.')
      return
    }

    setAviso(null)
    const novaLista = TODOS_OS_MODOS.filter((m) => (m === modo ? !estaAtivo : ativos.includes(m)))
    rascunho.definir(novaLista)
    await salvador.salvar({ modos_atendimento: novaLista })
    // sucesso: o cache já tem a lista nova; falha: volta pra lista do banco
    rascunho.descartar()
  }

  return (
    <section>
      <RotuloSecao icone="room_service">Tipos de atendimento</RotuloSecao>
      <Card>
        <p className="text-sm text-mesa-text-secondary">
          Ligue só o que sua barraca usa. A tela de lançar mostra apenas os tipos ativos.
        </p>

        {aviso && (
          <p className="mt-3 rounded-mesa-md border-l-[3px] border-mesa-warning-500 bg-mesa-warning-50 p-3 text-sm font-medium text-mesa-warning-700 dark:bg-mesa-warning-500/15">
            {aviso}
          </p>
        )}

        <ul className="mt-2 divide-y divide-mesa-border-subtle">
          {TODOS_OS_MODOS.map((modo) => (
            <li key={modo}>
              <label
                htmlFor={`modo-${modo}`}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icone nome={ICONE_MODO[modo]} size={20} />
                  <span className="min-w-0">
                    <span className="block text-base text-mesa-text-primary">{ROTULO_MODO[modo]}</span>
                    <span className="block text-xs text-mesa-text-secondary">{DESCRICAO_MODO[modo]}</span>
                  </span>
                </span>
                <Toggle
                  id={`modo-${modo}`}
                  checked={ativos.includes(modo)}
                  onChange={() => alternar(modo)}
                  aria-label={ROTULO_MODO[modo]}
                />
              </label>
            </li>
          ))}
        </ul>

        <ErroSalvar erro={salvador.erro} className="mt-2" />
      </Card>
    </section>
  )
}
