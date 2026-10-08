// Liga o pedido do cardápio ao perfil do cliente. Flag por barraca: obrigatório só se o dono ligar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { autenticarSessao } from './clienteSessao.ts'

export function decidirPerfil(obrigatorio: boolean, clienteId: string | null): { clienteId: string | null; bloqueado: boolean } {
  return { clienteId, bloqueado: obrigatorio && !clienteId }
}

export async function resolverPerfilDoPedido(
  supabase: SupabaseClient,
  pimenta: string,
  barracaId: string,
  sessaoToken: unknown,
): Promise<{ clienteId: string | null; bloqueado: boolean }> {
  const { data: barraca } = await supabase.from('barracas').select('perfil_cliente_obrigatorio').eq('id', barracaId).maybeSingle()
  const sessao = sessaoToken && pimenta ? await autenticarSessao(supabase, pimenta, barracaId, sessaoToken) : null
  return decidirPerfil(Boolean(barraca?.perfil_cliente_obrigatorio), sessao?.cliente_id ?? null)
}
