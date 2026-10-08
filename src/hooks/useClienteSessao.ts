import { useCallback, useState } from 'react'
import { lerSessao, limparSessao, type SessaoCliente } from '../lib/clienteApi'

/** Sessão do cliente final nesta loja (só no aparelho). `entrar` guarda; `sair` limpa localmente. */
export function useClienteSessao(slug: string | undefined) {
  const [sessao, setSessao] = useState<SessaoCliente | null>(() => (slug ? lerSessao(slug) : null))
  const entrar = useCallback((s: SessaoCliente) => setSessao(s), [])
  const sair = useCallback(() => {
    if (slug) limparSessao(slug)
    setSessao(null)
  }, [slug])
  return { sessao, entrar, sair }
}
