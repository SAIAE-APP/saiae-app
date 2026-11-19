import { useId, useState } from 'react'
import clsx from 'clsx'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Icone } from './ui/Icone'
import {
  ANUAL_ECONOMIA_PERCENTUAL,
  PLANO_VENDA,
  PRECO_BASE_ANUAL_CENTAVOS,
  PRECO_BASE_MENSAL_CENTAVOS,
  PRECO_FISCAL_MENSAL_CENTAVOS,
  RECURSOS_INCLUIDOS,
  formatarPreco,
  linkAssinar,
  resumoCobranca,
  textoContaBloqueada,
} from '../lib/planos'
import { useFiscalContratacaoAberta } from '../hooks/useFiscalContratacaoAberta'
import { textoTempoRestante } from '../lib/tempoTrial'
import type { AssinaturaBarraca } from '../types/database'

type Ciclo = 'mensal' | 'anual'

/** Conteúdo persuasivo compartilhado pelo popup (PaywallModal, aberto por
 * cima da tela) e pela tela cheia (/:slug/planos, quando o acesso já
 * caiu). Mesma cópia/estrutura da landing page (MA_PLANS), redesenhada
 * com os tokens visuais do próprio app.
 *
 * `layout="page"` só é usado por /:slug/planos e centraliza o card em telas
 * largas. Plano único (Sai aê, 1 ponto de venda); mensal e anual têm os mesmos
 * recursos. Os valores são só exibição: o servidor decide o que cobra. */
export function PaywallConteudo({
  assinatura,
  layout = 'sheet',
}: {
  assinatura: AssinaturaBarraca | null
  layout?: 'sheet' | 'page'
}) {
  const [ciclo, setCiclo] = useState<Ciclo>('mensal')
  const fiscalAberta = useFiscalContratacaoAberta()
  const motivoFiscalId = useId()

  const textoBloqueio = assinatura ? textoContaBloqueada(assinatura) : null
  if (textoBloqueio) {
    // Bloqueada pelo admin: sem planos, sem botão de assinar, sem link de checkout.
    return (
      <div role="status" className={clsx('text-center', layout === 'page' && 'md:mx-auto md:max-w-lg')}>
        <h2 className="text-2xl font-bold leading-[32px] text-mesa-text-primary">Conta bloqueada</h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">{textoBloqueio}</p>
      </div>
    )
  }

  const anual = ciclo === 'anual'
  const resumo = resumoCobranca(ciclo, false)
  const emTrial = assinatura?.status === 'trialing'
  const tempoRestante = emTrial ? textoTempoRestante(assinatura.trial_ends_at) : null

  return (
    <div className="flex flex-col gap-6">
      <div className={clsx('text-center', layout === 'page' && 'md:mx-auto md:max-w-lg')}>
        {emTrial && tempoRestante ? (
          <p className="text-sm font-semibold text-mesa-orange-600">{tempoRestante} · Assinar agora</p>
        ) : (
          <p className="text-sm font-semibold text-mesa-orange-600">Seu teste grátis acabou</p>
        )}
        <h2 className="mt-1 text-2xl font-bold leading-[32px] text-mesa-text-primary">
          Continue sem largar a mão do papel outra vez
        </h2>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Escolha a periodicidade e mantenha caixa, cozinha e chamada de senha funcionando.
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
            {opcao === 'mensal' ? 'Mensal' : `Anual (${ANUAL_ECONOMIA_PERCENTUAL}% de economia)`}
          </button>
        ))}
      </div>

      <div
        className={clsx(
          'rounded-mesa-2xl border border-mesa-orange-500 bg-mesa-surface p-5 shadow-mesa-2',
          layout === 'page' && 'md:mx-auto md:w-full md:max-w-lg',
        )}
      >
        <h3 className="text-base font-bold text-mesa-text-primary">Sai aê</h3>
        <p className="mt-1 text-sm text-mesa-text-secondary">
          Para quem quer largar o papel. A assinatura cobre 1 ponto de venda.
        </p>

        <div className="mt-3 flex items-baseline gap-1">
          <span className="font-mesa-display text-2xl font-bold text-mesa-text-primary">
            {formatarPreco(anual ? PRECO_BASE_ANUAL_CENTAVOS : PRECO_BASE_MENSAL_CENTAVOS)}
          </span>
          <span className="text-sm text-mesa-text-secondary">{anual ? 'por ano' : 'por mês'}</span>
        </div>
        {resumo.economia && (
          <p className="mt-0.5 text-xs font-medium text-mesa-success-700 dark:text-mesa-success-500">{resumo.economia}</p>
        )}

        <ul className="mt-4 flex flex-col gap-2">
          {RECURSOS_INCLUIDOS.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-mesa-text-primary">
              <Icone nome="check" size={16} className="mt-0.5 text-mesa-neutral-900 dark:text-mesa-neutral-50" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-mesa-border-default pt-3">
          <Checkbox
            checked={false}
            onChange={() => {}}
            disabled
            label="Nota fiscal (NFC-e)"
            aria-describedby={motivoFiscalId}
          />
          <p id={motivoFiscalId} className="text-xs text-mesa-text-secondary">
            {fiscalAberta
              ? 'Nota fiscal: contrate depois de ativar a assinatura, em Minha assinatura. Exige CNPJ da barraca.'
              : 'Nota fiscal: em breve.'}
            {' '}Módulo opcional de {formatarPreco(PRECO_FISCAL_MENSAL_CENTAVOS)} por mês por CNPJ, sempre cobrado por mês.
          </p>
        </div>

        <div className="mt-4 rounded-mesa-lg bg-mesa-surface-alt p-3" aria-live="polite">
          <p className="text-xs font-semibold text-mesa-text-secondary">
            Resumo da cobrança: {resumo.total}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {resumo.linhas.map((l) => (
              <li key={l.rotulo} className="flex justify-between gap-3 text-sm text-mesa-text-primary">
                <span>{l.rotulo}</span>
                <span className="text-right font-medium">{l.texto}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          onClick={() => {
            window.location.href = linkAssinar(PLANO_VENDA, ciclo)
          }}
        >
          {anual ? 'Assinar o plano anual' : 'Assinar o plano mensal'}
        </Button>
      </div>

      <p className="text-center text-xs text-mesa-text-tertiary">
        3 dias grátis para testar. Cancele quando quiser: o acesso segue até o fim do período já pago.
      </p>
    </div>
  )
}
