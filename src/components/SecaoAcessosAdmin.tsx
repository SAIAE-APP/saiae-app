import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card } from './ui/Card'
import { Icone } from './ui/Icone'
import type { Barraca } from '../types/database'

type AcessoAdmin = { aberto_em: string; duracao_segundos: number; modo: string; revelacoes: number }

function duracao(segundos: number): string {
  if (segundos < 60) return 'menos de 1 min'
  const min = Math.round(segundos / 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`
}

/** "Acessos do painel Sai aê" (Ajustes › Conta, só dono): quem da equipe do Sai aê abriu esta barraca pelo painel
 * de administração, quando, por quanto tempo e quantas vezes viu dados de cliente completos. A RPC recusa quem não
 * é dono; sem acesso (ou sem nenhum registro) a seção nem aparece. */
export function SecaoAcessosAdmin({ barraca }: { barraca: Barraca }) {
  const [acessos, setAcessos] = useState<AcessoAdmin[]>([])

  useEffect(() => {
    let cancelado = false
    supabase.rpc('acessos_admin_da_barraca', { p_barraca_id: barraca.id }).then(({ data, error }) => {
      if (!cancelado && !error) setAcessos((data ?? []) as AcessoAdmin[])
    })
    return () => {
      cancelado = true
    }
  }, [barraca.id])

  if (acessos.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-1.5 font-mesa-sans text-xs font-semibold uppercase tracking-wider text-mesa-text-secondary">
        <Icone nome="visibility" size={14} />
        Acessos do painel Sai aê
      </h2>
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-mesa-text-secondary">
          Vezes em que a equipe do Sai aê abriu a sua barraca para ajudar, sempre somente leitura.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {acessos.map((a) => (
            <li key={a.aberto_em} className="flex flex-wrap justify-between gap-2">
              <span className="text-mesa-text-primary">{new Date(a.aberto_em).toLocaleString('pt-BR')}</span>
              <span className="text-mesa-text-secondary">
                {duracao(a.duracao_segundos)}
                {a.revelacoes > 0 && ` · ${a.revelacoes} cliente(s) vistos por completo`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
