// Leitura do token do dono por provedor (tabela barracas_pagamento_token).
//
// Tolerante à ordem de deploy: busca as linhas da barraca e escolhe a do provedor
// em código, tratando linha sem a coluna `provedor` (antes da migration) como
// Mercado Pago. Assim a function nova não quebra se subir antes da migration.
import { PROVEDOR_PADRAO, type ProvedorChave } from './tipos.ts'

type ClienteSupabase = {
  from: (tabela: string) => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => PromiseLike<{
        data: Record<string, unknown>[] | null
        error: { message: string } | null
      }>
    }
  }
}

export async function buscarTokenDoProvedor(
  supabase: unknown,
  barracaId: string,
  provedor: ProvedorChave,
): Promise<string | null> {
  const { data, error } = await (supabase as ClienteSupabase)
    .from('barracas_pagamento_token')
    .select('*')
    .eq('barraca_id', barracaId)
  if (error || !data) return null
  const linha = data.find((l) => String(l.provedor ?? PROVEDOR_PADRAO) === provedor)
  const token = linha?.access_token
  return typeof token === 'string' && token ? token : null
}
