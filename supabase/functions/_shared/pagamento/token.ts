// Leitura do token do dono por provedor (tabela barracas_pagamento_token).
//
// Tolerante à ordem de deploy: busca as linhas da barraca e escolhe a do provedor
// em código, tratando linha sem a coluna `provedor` (antes da migration) como
// Mercado Pago. Assim a function nova não quebra se subir antes da migration.
import { configDoEnv, lerSegredo, type EnvMinimo } from '../segredoCifrado.ts'
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

/** Segredo de assinatura do webhook do provedor (opcional), ou null se o dono não cadastrou. */
export async function buscarSegredoWebhook(
  supabase: unknown,
  barracaId: string,
  provedor: ProvedorChave,
  env?: EnvMinimo,
): Promise<string | null> {
  const { data, error } = await (supabase as ClienteSupabase)
    .from('barracas_pagamento_token')
    .select('*')
    .eq('barraca_id', barracaId)
  if (error || !data) return null
  const linha = data.find((l) => String(l.provedor ?? PROVEDOR_PADRAO) === provedor)
  if (!linha) return null
  return (await lerSegredo({ texto: linha.segredo_webhook, cifrado: linha.segredo_webhook_cifrado }, { barracaId, campo: 'segredo_webhook' }, configDoEnv(env))).valor
}

export async function buscarTokenDoProvedor(
  supabase: unknown,
  barracaId: string,
  provedor: ProvedorChave,
  env?: EnvMinimo,
): Promise<string | null> {
  const { data, error } = await (supabase as ClienteSupabase)
    .from('barracas_pagamento_token')
    .select('*')
    .eq('barraca_id', barracaId)
  if (error || !data) return null
  const linha = data.find((l) => String(l.provedor ?? PROVEDOR_PADRAO) === provedor)
  if (!linha) return null
  return (await lerSegredo({ texto: linha.access_token, cifrado: linha.access_token_cifrado }, { barracaId, campo: 'access_token' }, configDoEnv(env))).valor
}
