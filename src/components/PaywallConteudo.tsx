import { useState } from 'react'
import clsx from 'clsx'
import { Button } from './ui/Button'
import { Icone } from './ui/Icone'
import { PLANOS, formatarPreco, linkAssinar } from '../lib/planos'
import { textoTempoRestante } from '../lib/tempoTrial'
import type { AssinaturaBarraca } from '../types/database'

type Ciclo = 'mensal' | 'anual'

/** Conteúdo persuasivo compartilhado pelo popup (PaywallModal, aberto por
 * cima da tela) e pela tela cheia (/:slug/planos, quando o acesso já
 * caiu). Mesma cópia/estrutura da landing page (MA_PLANS), redesenhada
 * com os tokens visuais do próprio app. */
export function PaywallConteudo({ assinatura }: { assinatura: AssinaturaBarraca | null }) {
  const [ciclo, setCiclo] = useState<Ciclo>('mensal')

  const emTrial = assinatura?.status === 'trialing'
  const tempoRestante = emTrial ? textoTempoRestante(assinatura.trial_ends_at) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        {emTrial && tempoRestante ? (
          <p className="text-sm font-semibold text-mesa-orange-600">{tempoRestante} · Assinar agora</p>
        ) : (
          <p className="text-sm font-semibold text-mesa-orange-600">Seu teste grátis acabou</p>
        )}
        <h2 className="mt-1 text-2xl font-bold leading-[32px] text-mesa-text-primary">
          Continue sem largar a mão do papel outra vez
        </h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Escolha um plano e mantenha caixa, cozinha e chamada de senha funcionando.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Ciclo de cobrança"
        className="mx-auto flex w-full max-w-[280px] rounded-mesa-full border border-mesa-border-default bg-mesa-surface-alt p-1"
      >
        {(['mensal', 'anual'] as Ciclo[]).map((opcao) => (
          <button
            key={opcao}
            type="button"
            role="radio"
            aria-checked={ciclo === opcao}
            onClick={() => setCiclo(opcao)}
            className={clsx(
              'flex-1 rounded-mesa-full px-4 py-2 text-sm font-medium transition-colors',
              ciclo === opcao
                ? 'bg-mesa-orange-500 text-mesa-neutral-900'
                : 'text-mesa-text-secondary hover:text-mesa-text-primary',
            )}
          >
            {opcao === 'mensal' ? 'Mensal' : (
              <span>
                Anual <span className="opacity-80">até 20% OFF</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {Object.values(PLANOS).map((info) => {
          const preco = ciclo === 'anual' ? info.anual.mes : info.mensal
          const destaque = info.plano === 'pro'

          return (
            <div
              key={info.plano}
              className={clsx(
                'rounded-mesa-2xl border p-5',
                destaque
                  ? 'border-mesa-orange-500 bg-mesa-surface shadow-mesa-2 [box-shadow:0_0_0_1px_var(--color-mesa-orange-500)]'
                  : 'border-mesa-border-default bg-mesa-surface shadow-mesa-1',
              )}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-mesa-text-primary">{info.nome}</h3>
                {info.selo && (
                  <span className="inline-flex items-center gap-1 rounded-mesa-balao bg-mesa-orange-50 px-2.5 py-1 text-xs font-semibold text-mesa-orange-700">
                    <Icone nome="star" size={12} preenchido /> Mais completo
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-mesa-text-secondary">{info.descricao}</p>

              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-mesa-display text-2xl font-bold text-mesa-text-primary">{formatarPreco(preco)}</span>
                <span className="text-sm text-mesa-text-secondary">/mês</span>
              </div>
              {ciclo === 'anual' && (
                <p className="mt-0.5 text-xs font-medium text-mesa-success-700 dark:text-mesa-success-500">
                  {formatarPreco(info.anual.total)}/ano · economia de {formatarPreco(info.anual.economia)} (
                  {info.anual.off})
                </p>
              )}

              <ul className="mt-4 flex flex-col gap-2">
                {info.itens.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-mesa-text-primary">
                    <Icone nome="check" size={16} className="mt-0.5 text-mesa-neutral-900 dark:text-mesa-neutral-50" />
                    {item}
                  </li>
                ))}
              </ul>

              <Button
                variant={destaque ? 'primary' : 'outlineAmber'}
                size="lg"
                className="mt-5 w-full"
                onClick={() => {
                  window.location.href = linkAssinar(info.plano, ciclo)
                }}
              >
                {info.cta}
              </Button>
            </div>
          )
        })}
      </div>

      <p className="text-center text-xs text-mesa-text-tertiary">
        7 dias grátis para testar. Sem fidelidade no mensal. Cancele quando quiser.
      </p>
    </div>
  )
}
