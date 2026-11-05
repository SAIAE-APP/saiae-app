import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useBarracasDoUsuario } from '../hooks/useBarracasDoUsuario'
import { CHAVE_SLUG_MP, retornoOauthMp } from '../lib/estadoMercadoPago'

/** O callback do OAuth do Mercado Pago volta em `/ajustes?mp=ok|erro`, sem o slug da loja.
 * Aqui achamos a loja que iniciou a conexão (guardada antes de sair) e seguimos para os Ajustes dela. */
export function RetornoMercadoPago() {
  const { search } = useLocation()
  const { usuario, carregando: carregandoAuth } = useAuth()
  const { barracas, carregando } = useBarracasDoUsuario(usuario)

  if (carregandoAuth || (usuario && carregando)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesa-bg-base">
        <p className="text-mesa-text-secondary">Carregando...</p>
      </div>
    )
  }

  let guardado: string | null = null
  try {
    guardado = sessionStorage.getItem(CHAVE_SLUG_MP)
  } catch {
    // sessionStorage indisponível: cai na regra de uma loja só
  }
  const slugs = barracas.map((b) => b.barraca.slug)
  const slug = guardado && slugs.includes(guardado) ? guardado : slugs.length === 1 ? slugs[0] : null
  const mp = retornoOauthMp(search)

  if (!slug) return <Navigate to="/selecionar-barraca" replace />
  return <Navigate to={`/${slug}/ajustes${mp ? `?mp=${mp}` : ''}`} replace />
}
