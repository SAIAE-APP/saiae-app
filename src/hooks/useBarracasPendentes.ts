import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { BarracaComPapel } from './useBarracasDoUsuario'
import { barracasComOnboardingPendente } from '../lib/onboardingApi'

/**
 * Ids das barracas PRÓPRIAS (dono) com o assistente por concluir, lidos do banco a cada montagem (nunca do cache do
 * navegador: a trava precisa enxergar a conclusão logo depois da tela final). `null` só na primeira leitura (depois mantém o último valor, para não desmontar a tela em atualizações da lista). Falha de leitura
 * (sem rede, migration ausente) vira lista vazia: o assistente nunca bloqueia por erro. Com a flag desligada, vazio.
 */
export function useBarracasPendentes(usuario: User | null, barracas: BarracaComPapel[], habilitado: boolean): string[] | null {
  const [ids, setIds] = useState<string[] | null>(habilitado ? null : [])
  const chave = barracas.map((b) => `${b.barraca_id}:${b.papel}`).join(',')

  useEffect(() => {
    if (!habilitado || !usuario) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIds([])
      return
    }
    const donas = barracas.filter((b) => b.papel === 'dono').map((b) => b.barraca_id)
    if (donas.length === 0) {
      setIds([])
      return
    }
    let cancelado = false
    barracasComOnboardingPendente(donas).then((lista) => {
      if (!cancelado) setIds(lista.map((b) => b.id))
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, usuario?.id, chave])

  return ids
}
