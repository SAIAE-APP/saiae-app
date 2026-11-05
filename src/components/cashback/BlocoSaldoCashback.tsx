import { useEffect, useState } from 'react'
import { chamarSessao } from '../../lib/clienteApi'
import { interpretarCashback, type DadosCashback } from '../../lib/cashbackApi'
import { rotuloLancamento, textoValidade } from '../../lib/cashbackTexto'
import { formatarPrecoBR } from '../../lib/preco'
import { Card } from '../ui/Card'

/**
 * Saldo de cashback em "Meu perfil": saldo, validade e os últimos lançamentos (o servidor devolve no máximo 20, sem pedido
 * nem outro dado). Some quando a loja não usa cashback e não há saldo. Falha de rede mostra um aviso e não quebra a página.
 * `aoCarregar` entrega o resultado ao pai (a confirmação de "Apagar meus dados" avisa o valor que seria perdido).
 */
export function BlocoSaldoCashback({
  slug,
  aoCarregar,
}: {
  slug: string
  aoCarregar?: (dados: DadosCashback | null) => void
}) {
  const [estado, setEstado] = useState<{ dados: DadosCashback | null; falhou: boolean } | null>(null)

  useEffect(() => {
    let cancelado = false
    void chamarSessao(slug, 'cashback').then((r) => {
      if (cancelado) return
      const dados = r.ok ? interpretarCashback(r.dados) : null
      setEstado({ dados, falhou: dados === null })
      aoCarregar?.(dados)
    })
    return () => {
      cancelado = true
    }
    // `aoCarregar` é um setter estável do pai; refazer a leitura a cada render seria desperdício
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  if (!estado) return null
  if (estado.falhou) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Meu cashback</h2>
        <Card>
          <p role="status" className="text-sm text-mesa-text-secondary">
            Não foi possível carregar o saldo.
          </p>
        </Card>
      </section>
    )
  }
  const dados = estado.dados
  if (!dados || (!dados.habilitado && dados.saldoCentavos === 0)) return null

  const vence = dados.venceEm ? textoValidade(dados.venceEm) : ''

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">Meu cashback</h2>
      <Card>
        <p className="text-sm text-mesa-text-secondary">Saldo nesta loja</p>
        <p className="font-mesa-display text-2xl font-bold text-mesa-text-primary">{formatarPrecoBR(dados.saldoCentavos)}</p>
        {dados.saldoCentavos > 0 && vence && <p className="text-sm text-mesa-text-secondary">Vence em {vence}</p>}
        {dados.lancamentos.length > 0 && (
          <ul className="mt-3 divide-y divide-mesa-border-subtle">
            {dados.lancamentos.map((l, i) => (
              <li key={`${l.criadoEm}-${i}`} className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm">
                <span className="text-mesa-text-primary">
                  {rotuloLancamento(l.tipo)}
                  <span className="ml-2 text-xs text-mesa-text-secondary">{textoValidade(l.criadoEm)}</span>
                </span>
                <span className="font-mesa-display font-semibold text-mesa-text-primary">
                  {l.valorCentavos < 0 ? '−' : '+'}
                  {formatarPrecoBR(Math.abs(l.valorCentavos))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
