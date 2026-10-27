// Leitura do resumo de cashback no banco (Ajustes e Relatório). Lança o erro do banco: o chamador usa
// `bancoSemRecurso` para esconder a parte da tela quando a migration ainda não existe.
import { supabase } from './supabase'
import { interpretarResumoCashback, type ResumoCashback } from './cashbackResumo'

export async function carregarResumoCashback(barracaId: string, de: Date, ate: Date): Promise<ResumoCashback | null> {
  const { data, error } = await supabase.rpc('cashback_resumo', {
    p_barraca_id: barracaId,
    p_de: de.toISOString(),
    p_ate: ate.toISOString(),
  })
  if (error) throw error
  return interpretarResumoCashback(data)
}
