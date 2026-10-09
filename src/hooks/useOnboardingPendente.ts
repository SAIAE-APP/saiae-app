import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { BarracaComPapel } from './useBarracasDoUsuario'
import { barracasComOnboardingPendente } from '../lib/onboardingApi'

/**
 * O usuário precisa passar pelo assistente de configuração? Só com a flag ligada e só para quem NÃO tem barraca
 * ou tem uma barraca própria com o assistente por concluir. Barraca antiga (backfill = concluída) nunca cai
 * aqui, e qualquer erro de leitura vale como "não pendente": o assistente nunca bloqueia por falha.
 */
export function useOnboardingPendente(usuario: User | null, barracas: BarracaComPapel[], habilitado: boolean) {
  const [pendente, setPendente] = useState<boolean | null>(habilitado ? null : false)
  const chave = barracas.map((b) => `${b.barraca_id}:${b.papel}`).join(',')

  useEffect(() => {
    if (!habilitado || !usuario) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendente(false)
      return
    }
    const donas = barracas.filter((b) => b.papel === 'dono').map((b) => b.barraca_id)
    // Sem barraca nenhuma: conta nova. Só funcionário (nenhuma própria): não é com ele.
    if (barracas.length === 0) {
      setPendente(true)
      return
    }
    if (donas.length === 0) {
      setPendente(false)
      return
    }
    let cancelado = false
    setPendente(null)
    barracasComOnboardingPendente(donas).then((lista) => {
      if (!cancelado) setPendente(lista.length > 0)
    })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, usuario?.id, chave])

  return { pendente, carregando: pendente === null }
}
