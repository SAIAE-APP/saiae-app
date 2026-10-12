import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type AcessoSuporteAtivo = {
  id: string
  expira_em: string
}

/** Acessos de suporte ATIVOS da barraca — só o dono enxerga (RLS de
 * acessos_suporte). Usado pela faixa fixa (`FaixaSuporte` variant "dono")
 * e pela seção de Ajustes. Lista vazia pra quem não é dono: a policy só
 * devolve nada, não erro. */
export function useAcessosSuporteAtivos(barracaId: string) {
  const [acessos, setAcessos] = useState<AcessoSuporteAtivo[]>([])
  const [carregando, setCarregando] = useState(true)

  const buscar = useCallback(async () => {
    const { data, error } = await supabase
      .from('acessos_suporte')
      .select('id, expira_em')
      .eq('barraca_id', barracaId)
      .is('revogado_em', null)
      .gt('expira_em', new Date().toISOString())
      .order('concedido_em', { ascending: false })

    if (!error && data) setAcessos(data as AcessoSuporteAtivo[])
    setCarregando(false)
  }, [barracaId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mesmo padrão de useAssinaturaBarraca.ts: busca inicial, não reação a prop externa.
    buscar()
  }, [buscar])

  async function encerrar(acessoId: string) {
    const { data, error } = await supabase.rpc('suporte_encerrar_acesso', { p_acesso_id: acessoId })
    if (error || (data as { estado: string })?.estado !== 'ok') return false
    setAcessos((atual) => atual.filter((a) => a.id !== acessoId))
    return true
  }

  return { acessos, carregando, encerrar, recarregar: buscar }
}
