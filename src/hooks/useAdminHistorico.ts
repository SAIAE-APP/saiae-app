import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminAcaoLog } from '../lib/adminBarracas'

/** Últimas ações do superadmin (`admin_listar_acoes`). `recarregar` refaz a consulta. */
export function useAdminHistorico(ativo: boolean) {
  const [estado, setEstado] = useState<{ linhas: AdminAcaoLog[]; erro: string | null } | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    if (!ativo) return
    let cancelado = false
    supabase.rpc('admin_listar_acoes', { p_limite: 50, p_offset: 0 }).then(({ data, error }) => {
      if (cancelado) return
      setEstado(
        error
          ? { linhas: [], erro: 'Não foi possível carregar o histórico de ações.' }
          : { linhas: (data ?? []) as AdminAcaoLog[], erro: null },
      )
    })
    return () => {
      cancelado = true
    }
  }, [ativo, versao])

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  return { linhas: estado?.linhas ?? [], erro: estado?.erro ?? null, recarregar }
}
