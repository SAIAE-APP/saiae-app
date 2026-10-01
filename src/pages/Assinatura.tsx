import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useBarracaAtual } from '../layouts/contextoBarraca'
import { supabase } from '../lib/supabase'
import { PLANOS } from '../lib/planos'
import { Button } from '../components/ui/Button'
import { Icone } from '../components/ui/Icone'
import type { Assinatura as TipoAssinatura } from '../types/database'

const NOME_STATUS: Record<string, string> = {
  trialing: 'Teste grátis',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelada (ativa até o fim do período)',
  expired: 'Expirada',
}

function formatarData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** "Minha assinatura" — só o dono acessa (link em Ajustes). Estados de
 * texto puro; nenhuma ação aqui muda a assinatura no banco — quem muda é
 * sempre o webhook da Stripe (fonte da verdade fica no servidor). */
export function Assinatura() {
  const barraca = useBarracaAtual()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const processando = params.get('status') === 'processando'

  const [assinatura, setAssinatura] = useState<TipoAssinatura | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    let cancelado = false
    let intervalo: ReturnType<typeof setInterval> | undefined

    async function buscar() {
      const { data } = await supabase.rpc('minha_assinatura').single()
      if (cancelado) return
      setAssinatura((data as TipoAssinatura) ?? null)
      setCarregando(false)
    }

    buscar()

    // Enquanto processando=true (voltou do checkout), confirma a cada
    // poucos segundos até o webhook aplicar a compra — o acesso nunca é
    // liberado só pelo redirecionamento do checkout.
    if (processando) {
      intervalo = setInterval(buscar, 3000)
    }

    return () => {
      cancelado = true
      if (intervalo) clearInterval(intervalo)
    }
  }, [processando])

  const plano = assinatura?.plan ? PLANOS[assinatura.plan] : null
  const aindaProcessando = processando && assinatura?.status !== 'active'

  return (
    <div className="flex min-h-dvh flex-col gap-6 p-6 md:mx-auto md:max-w-2xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/${barraca.slug}/ajustes`)}
          className="flex size-11 items-center justify-center rounded-mesa-full text-mesa-text-secondary hover:bg-[var(--mesa-state-hover-bg)]"
          aria-label="Voltar"
        >
          <Icone nome="arrow_back" size={20} />
        </button>
        <h1 className="text-xl font-bold text-mesa-text-primary">Minha assinatura</h1>
      </div>

      {carregando ? (
        <p className="text-mesa-text-secondary">Carregando...</p>
      ) : aindaProcessando ? (
        <div className="flex flex-col items-center gap-3 rounded-mesa-2xl border border-mesa-border-default bg-mesa-surface p-6 text-center">
          <Icone nome="schedule" size={32} className="animate-pulse text-mesa-orange-500" />
          <p className="font-medium text-mesa-text-primary">Confirmando seu pagamento...</p>
          <p className="text-sm text-mesa-text-secondary">
            Isso costuma levar só alguns segundos. Não feche esta tela.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-mesa-2xl border border-mesa-border-default bg-mesa-surface p-5">
            <div className="flex items-center gap-2">
              <Icone
                nome="check_circle"
                size={20}
                className={
                  assinatura?.status === 'active' || assinatura?.status === 'trialing'
                    ? 'text-mesa-success-700 dark:text-mesa-success-500'
                    : 'text-mesa-error-500'
                }
              />
              <span className="font-semibold text-mesa-text-primary">
                {NOME_STATUS[assinatura?.status ?? ''] ?? 'Sem assinatura'}
              </span>
            </div>

            {plano && (
              <p className="mt-2 text-sm text-mesa-text-secondary">
                Plano <strong>{plano.nome}</strong>
                {assinatura?.cycle && ` · ${assinatura.cycle === 'anual' ? 'Anual' : 'Mensal'}`}
              </p>
            )}

            {assinatura?.status === 'trialing' && (
              <p className="mt-1 text-sm text-mesa-text-secondary">
                Teste grátis até {formatarData(assinatura.trial_ends_at)}
              </p>
            )}
            {assinatura?.status === 'active' && (
              <p className="mt-1 text-sm text-mesa-text-secondary">
                Próxima cobrança em {formatarData(assinatura.current_period_end)}
              </p>
            )}
            {assinatura?.status === 'canceled' && (
              <p className="mt-1 text-sm text-mesa-text-secondary">
                Acesso liberado até {formatarData(assinatura.current_period_end)}
              </p>
            )}
          </div>

          <div className="rounded-mesa-2xl border border-mesa-border-default bg-mesa-surface p-5">
            <h2 className="text-base font-semibold text-mesa-text-primary">Trocar ou cancelar</h2>
            <p className="mt-1 text-sm text-mesa-text-secondary">
              Trocar de plano ou cancelar ainda é um processo manual: fale com o suporte que a gente
              resolve pra você.
            </p>
            <Button
              variant="outline"
              size="lg"
              icon={<Icone nome="chat" size={20} />}
              className="mt-4 w-full"
              onClick={() => window.open('https://wa.me/', '_blank', 'noopener')}
            >
              Falar no WhatsApp
            </Button>
          </div>

          {assinatura?.status !== 'active' && (
            <Button variant="primary" size="lg" onClick={() => navigate(`/${barraca.slug}/planos`)}>
              Ver planos
            </Button>
          )}
        </>
      )}
    </div>
  )
}
