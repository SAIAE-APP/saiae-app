// Liga a fila do banco (ia_apagar_fila) ao envio assinado ao CRM. Usado pelas functions que apagam dados do cliente
// (cliente-sessao, excluir-conta) logo depois do apagamento local, e pelo job periódico (ia-apagar-processar).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { enviarApagarAoCrm, processarFilaApagar, type PedidoApagar } from './iaApagar.ts'

/** Tenta esvaziar a fila agora. Nunca lança e nunca registra dados pessoais; sem URL/segredo configurados não faz nada
 * (os pedidos ficam na fila até alguém configurar, no máximo 14 dias). */
export async function drenarFilaApagarIa(supabase: SupabaseClient, limite = 5, timeoutMs = 4_000): Promise<{ enviados: number; falhas: number }> {
  const url = Deno.env.get('CRM_IA_APAGAR_URL')
  const segredo = Deno.env.get('IA_CONTEXTO_SEGREDO')
  if (!url || !segredo) return { enviados: 0, falhas: 0 }
  const r = await processarFilaApagar({
    limite,
    pegar: async (n) => {
      const { data, error } = await supabase.rpc('ia_apagar_pegar', { p_limite: n })
      if (error) throw new Error('fila')
      return (data ?? []) as PedidoApagar[]
    },
    concluir: async (id) => {
      await supabase.rpc('ia_apagar_concluir', { p_id: id })
    },
    enviar: (p) => enviarApagarAoCrm({ url, segredo, codigoLoja: p.codigo_loja, telefone: p.telefone, timeoutMs }),
  })
  if (r.falhas > 0) console.error('ia-apagar: pedidos de apagamento pendentes, serão reenviados')
  return r
}
