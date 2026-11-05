import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mensagemErroAcao } from '../lib/adminBarracas'

/** Ações do superadmin sobre uma conta/barraca. Cada uma lança o erro (já em português) e também o guarda em `erro`. */
export function useAdminAcoes() {
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const executar = useCallback(async (funcao: string, args: Record<string, unknown>) => {
    setOcupado(true)
    setErro(null)
    let falha: Error | null = null
    try {
      const { error } = await supabase.rpc(funcao, args)
      if (error) falha = new Error(mensagemErroAcao(error), { cause: error })
    } catch (e) {
      falha = new Error(mensagemErroAcao(null), { cause: e })
    }
    setOcupado(false)
    if (falha) {
      setErro(falha.message)
      throw falha
    }
  }, [])

  return {
    bloquear: (usuarioId: string, motivo?: string) =>
      executar('admin_bloquear_conta', { p_usuario_id: usuarioId, p_motivo: motivo?.trim() || null }),
    desbloquear: (usuarioId: string) => executar('admin_desbloquear_conta', { p_usuario_id: usuarioId }),
    definirPlano: (usuarioId: string, plano: 'essencial' | 'pro') =>
      executar('admin_definir_plano', { p_usuario_id: usuarioId, p_plano: plano }),
    estender: (usuarioId: string, dias: number) =>
      executar('admin_estender_vencimento', { p_usuario_id: usuarioId, p_dias: dias }),
    arquivar: (barracaId: string, nomeConfirmado: string) =>
      executar('admin_arquivar_barraca', { p_barraca_id: barracaId, p_nome_confirmado: nomeConfirmado }),
    restaurar: (barracaId: string) => executar('admin_restaurar_barraca', { p_barraca_id: barracaId }),
    erro,
    ocupado,
  }
}
