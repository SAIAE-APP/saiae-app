import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { calcularChecklist, destinoDoItemChecklist, mostrarChecklist, type Progresso } from '../lib/onboardingConfig'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'

type Resposta = Progresso & { checklist_oculto_ate?: string | null }

/**
 * "Falta pouco para vender": % concluída (todos os itens com o mesmo peso) e atalhos para o que falta.
 * Some em 100% e fica oculto por 7 dias se o dono pedir. Qualquer falha (migration ausente, sem rede) esconde o
 * cartão em silêncio: o Hub nunca quebra por causa dele. Só para o dono da barraca.
 */
export function CartaoChecklistOnboarding({ barracaId, slug }: { barracaId: string; slug: string }) {
  const navigate = useNavigate()
  const [resposta, setResposta] = useState<Resposta | null>(null)
  const [aberto, setAberto] = useState(false)
  const [ocultando, setOcultando] = useState(false)
  const [agora] = useState(() => Date.now())

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('onboarding_progresso', { p_barraca_id: barracaId })
      .then(({ data, error }) => {
        if (!cancelado && !error && data && typeof data === 'object') setResposta(data as Resposta)
      })
      .then(undefined, () => {})
    return () => {
      cancelado = true
    }
  }, [barracaId])

  if (!resposta) return null
  const { itens, feitos, total, porcentagem } = calcularChecklist(resposta)
  if (!mostrarChecklist(porcentagem, resposta.checklist_oculto_ate, agora)) return null
  const pendentes = itens.filter((i) => !i.feito)

  async function ocultar() {
    setOcultando(true)
    const { error } = await supabase.rpc('onboarding_ocultar_checklist', { p_barraca_id: barracaId })
    setOcultando(false)
    if (!error) setResposta((r) => (r ? { ...r, checklist_oculto_ate: new Date(Date.now() + 7 * 86400_000).toISOString() } : r))
  }

  return (
    <div className="px-6 pt-4">
      <Card>
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-base font-semibold text-mesa-text-primary">Falta pouco para vender</span>
            <span className="block text-xs text-mesa-text-secondary">
              {feitos} de {total} passos · {porcentagem}% concluído
            </span>
          </span>
          <Icone nome={aberto ? 'expand_less' : 'expand_more'} size={22} />
        </button>
        <div
          className="mt-2 h-2 overflow-hidden rounded-mesa-full bg-mesa-neutral-100 dark:bg-mesa-neutral-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentagem}
          aria-label={`${porcentagem}% concluído`}
        >
          <div className="h-full rounded-mesa-full bg-mesa-orange-500" style={{ width: `${porcentagem}%` }} />
        </div>

        {aberto && (
          <>
            <ul className="mt-3 divide-y divide-mesa-border-subtle">
              {pendentes.map((i) => (
                <li key={i.chave}>
                  <button
                    type="button"
                    onClick={() => navigate(`/${slug}/ajustes${destinoDoItemChecklist(i.chave) === 'cardapio' ? '/cardapio' : ''}`)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm text-mesa-text-primary"
                  >
                    {i.rotulo}
                    <Icone nome="arrow_forward" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={ocultar}
              disabled={ocultando}
              className="mt-2 flex min-h-11 items-center text-xs font-medium text-mesa-text-secondary underline"
            >
              Ocultar por 7 dias
            </button>
          </>
        )}
      </Card>
    </div>
  )
}
