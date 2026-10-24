// Módulos pagos: a fonte da verdade da vigência é a RPC `modulo_ativo` (banco). Fecha por padrão: qualquer erro = false.
export const MODULOS = ['whatsapp_avisos', 'whatsapp_disparos', 'whatsapp_bot', 'fiscal'] as const
export type Modulo = (typeof MODULOS)[number]

export async function moduloAtivo(
  db: { rpc: (fn: string, args: object) => PromiseLike<{ data: unknown; error: unknown }> },
  barracaId: string,
  modulo: Modulo,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('modulo_ativo', { p_barraca_id: barracaId, p_modulo: modulo })
    return !error && data === true
  } catch {
    return false
  }
}
