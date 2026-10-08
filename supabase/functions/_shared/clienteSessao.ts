// Autentica o token de sessão do cliente final (nunca guardado em claro).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { hashSegredo, precisaAtualizarUso, sessaoValida } from './clienteCodigo.ts'

export async function autenticarSessao(
  supabase: SupabaseClient,
  pimenta: string,
  barracaId: string,
  token: unknown,
): Promise<{ cliente_id: string; sessao_id: string } | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null
  const hash = await hashSegredo(pimenta, 'sessao', token)
  const { data } = await supabase
    .from('cliente_sessoes')
    .select('id, cliente_id, expira_em, revogada_em, ultimo_uso_em')
    .eq('token_hash', hash)
    .eq('barraca_id', barracaId)
    .maybeSingle()
  if (!data || !sessaoValida(data, Date.now())) return null
  if (precisaAtualizarUso(data.ultimo_uso_em, Date.now())) {
    await supabase.from('cliente_sessoes').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', data.id)
  }
  return { cliente_id: data.cliente_id, sessao_id: data.id }
}
