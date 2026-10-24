// Envoltórios tipados das RPCs do superadmin para módulos pagos. Retornam o `estado` do servidor.
import { supabase } from './supabase'
import type { Modulo } from './modulos'

export type EstadoModulo = 'inativo' | 'teste' | 'ativo' | 'suspenso' | 'cancelado'
export type Origem = 'cortesia' | 'pago'

export interface LinhaModulo {
  modulo: Modulo
  estado: EstadoModulo
  origem: Origem | null
  teste_ate: string | null
  pago_ate: string | null
  ativado_em: string | null
  termo_versao: string | null
  termo_aceito_em: string | null
  ativacao_cobrada_em: string | null
  vigente: boolean
}

const FALHA = 'invalido_rede'

async function chamar(fn: string, args: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc(fn, args)
  const estado = (data as { estado?: string } | null)?.estado
  return error || typeof estado !== 'string' ? FALHA : estado
}

export async function listarModulos(barracaId: string): Promise<LinhaModulo[] | null> {
  const { data, error } = await supabase.rpc('admin_modulos_listar', { p_barraca_id: barracaId })
  return error ? null : (data as LinhaModulo[])
}

export function definirModulo(a: {
  barracaId: string; modulo: Modulo; estado: Exclude<EstadoModulo, 'inativo'>; origem: Origem
  testeAte?: string | null; pagoAte?: string | null; termoVersao?: string | null
}): Promise<string> {
  return chamar('admin_modulo_definir', {
    p_barraca_id: a.barracaId, p_modulo: a.modulo, p_estado: a.estado, p_origem: a.origem,
    p_teste_ate: a.testeAte ?? null, p_pago_ate: a.pagoAte ?? null, p_termo_versao: a.termoVersao?.trim() || null,
  })
}

export const registrarTaxaAtivacao = (barracaId: string) =>
  chamar('admin_modulo_ativacao_cobrada', { p_barraca_id: barracaId })

export function ativarPacoteWhatsapp(a: {
  barracaId: string; origem: Origem; testeAte?: string | null; pagoAte?: string | null; termoVersao?: string | null
}): Promise<string> {
  return chamar('admin_pacote_whatsapp', {
    p_barraca_id: a.barracaId, p_origem: a.origem, p_teste_ate: a.testeAte ?? null,
    p_pago_ate: a.pagoAte ?? null, p_termo_versao: a.termoVersao?.trim() || null,
  })
}
