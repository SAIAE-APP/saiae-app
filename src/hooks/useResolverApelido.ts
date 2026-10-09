import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { moverSessao } from '../lib/clienteSessaoLocal'
import { slugParaRedirecionar, trocarSlugNoCaminho } from '../lib/slugApelidos'
import { supabase } from '../lib/supabase'

/**
 * A página não achou a loja pelo endereço da URL (`ativo`): pode ser um endereço ANTIGO (apelido). Pergunta ao banco o
 * slug atual e, se houver, redireciona para o mesmo caminho com o endereço novo, levando a sessão do cliente junto.
 * Devolve `verificando` (mostrar "carregando", não "não encontrado") e `semApelido` (aí sim, não encontrado).
 * Banco sem a função (migration ainda não aplicada) ou falha de rede = `semApelido`: o comportamento de antes.
 */
export function useResolverApelido(slug: string | undefined, ativo: boolean): { verificando: boolean; semApelido: boolean } {
  const navigate = useNavigate()
  const location = useLocation()
  const [resolvido, setResolvido] = useState<string | null>(null)

  useEffect(() => {
    if (!ativo || !slug || resolvido === slug) return
    let cancelado = false
    supabase
      .rpc('barraca_slug_atual', { p_slug: slug })
      .then(
        ({ data, error }) => {
          if (cancelado) return
          const novo = error ? null : slugParaRedirecionar(slug, data)
          if (novo) {
            moverSessao(slug, novo)
            navigate(trocarSlugNoCaminho(location.pathname, slug, novo) + location.search + location.hash, { replace: true })
            return
          }
          setResolvido(slug)
        },
        () => {
          if (!cancelado) setResolvido(slug)
        },
      )
    return () => {
      cancelado = true
    }
  }, [ativo, slug, resolvido, navigate, location.pathname, location.search, location.hash])

  const semApelido = !ativo || resolvido === slug
  return { verificando: ativo && !semApelido, semApelido }
}
