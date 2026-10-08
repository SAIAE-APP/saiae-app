import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { decidirPerfil, PERFIL_INDISPONIVEL, type PerfilConfig } from '../lib/perfilDisponivel'

/** Perfil do cliente nesta loja: `carregando` até a RPC responder; sem a RPC no banco = indisponível. */
export function usePerfilConfig(slug: string | undefined): PerfilConfig & { carregando: boolean } {
  const [estado, setEstado] = useState<{ slug: string | undefined; config: PerfilConfig } | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelado = false
    void supabase.rpc('perfil_cliente_config', { p_slug: slug }).then((resposta) => {
      if (!cancelado) setEstado({ slug, config: decidirPerfil(resposta) })
    })
    return () => {
      cancelado = true
    }
  }, [slug])

  const pronto = estado !== null && estado.slug === slug
  return { ...(pronto ? estado.config : PERFIL_INDISPONIVEL), carregando: !pronto }
}
