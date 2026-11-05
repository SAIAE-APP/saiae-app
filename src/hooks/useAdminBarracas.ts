import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminAlertas, AdminBarraca, AdminResumo, AdminSaude, FiltroAdminBarracas } from '../lib/adminBarracas'

export const TAMANHO_PAGINA_ADMIN = 50

/** `null` em `ehSuperadmin` = ainda perguntando. A checagem daqui só decide o que a tela
 * mostra; quem barra de verdade é `admin_listar_barracas` no banco. */
export function useSouSuperadmin() {
  const [ehSuperadmin, setEhSuperadmin] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase.rpc('sou_superadmin').then(({ data, error }) => {
      if (!cancelado) setEhSuperadmin(!error && data === true)
    })
    return () => {
      cancelado = true
    }
  }, [])

  return ehSuperadmin
}

export function useAdminBarracas(filtro: FiltroAdminBarracas | null, plano: 'essencial' | 'pro' | null, pagina: number) {
  const chave = `${filtro}|${plano}|${pagina}`
  // `chave` guarda para quais filtros o resultado vale; diferente da atual = ainda carregando.
  const [resultado, setResultado] = useState<{ chave: string; linhas: AdminBarraca[]; erro: string | null } | null>(null)

  useEffect(() => {
    let cancelado = false
    supabase
      .rpc('admin_listar_barracas', {
        p_filtro: filtro,
        p_plano: plano,
        p_limite: TAMANHO_PAGINA_ADMIN,
        p_offset: pagina * TAMANHO_PAGINA_ADMIN,
      })
      .then(({ data, error }) => {
        if (cancelado) return
        setResultado({
          chave,
          linhas: error ? [] : ((data ?? []) as AdminBarraca[]),
          erro: error ? 'Não foi possível carregar as barracas.' : null,
        })
      })
    return () => {
      cancelado = true
    }
  }, [chave, filtro, plano, pagina])

  const atual = resultado?.chave === chave ? resultado : null
  const linhas = atual?.linhas ?? resultado?.linhas ?? []
  return { linhas, total: Number(linhas[0]?.total ?? 0), carregando: atual === null, erro: atual?.erro ?? null }
}

export function useAdminResumo(habilitado: boolean) {
  const [estado, setEstado] = useState<{ resumo: AdminResumo | null; erro: boolean } | null>(null)

  useEffect(() => {
    if (!habilitado) return
    let cancelado = false
    supabase.rpc('admin_resumo_ativas').then(({ data, error }) => {
      if (!cancelado) setEstado({ resumo: error ? null : (data as AdminResumo), erro: !!error })
    })
    return () => {
      cancelado = true
    }
  }, [habilitado])

  return { resumo: estado?.resumo ?? null, erro: estado?.erro ?? false, carregando: habilitado && estado === null }
}

/** Uma chamada de painel (alertas, saúde): resultado ou erro, sem refazer a cada render. */
function useChamadaAdmin<T>(funcao: 'admin_alertas' | 'admin_saude_barracas', habilitado: boolean) {
  const [estado, setEstado] = useState<{ dados: T | null; erro: boolean } | null>(null)

  useEffect(() => {
    if (!habilitado) return
    let cancelado = false
    supabase.rpc(funcao).then(({ data, error }) => {
      if (!cancelado) setEstado({ dados: error ? null : (data as T), erro: !!error })
    })
    return () => {
      cancelado = true
    }
  }, [funcao, habilitado])

  return { dados: estado?.dados ?? null, erro: estado?.erro ?? false }
}

export const useAdminAlertas = (habilitado: boolean) => useChamadaAdmin<AdminAlertas>('admin_alertas', habilitado)
export const useAdminSaude = (habilitado: boolean) => useChamadaAdmin<AdminSaude[]>('admin_saude_barracas', habilitado)
