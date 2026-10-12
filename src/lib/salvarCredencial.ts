// Salva token FocusNFe / token do Pix / segredo do webhook pela edge function `salvar-credencial`, que cifra antes de
// gravar (plano 2026-10-12-criptografar-tokens-em-repouso). O valor só trafega até a função e nunca é lido de volta.
import { supabase } from './supabase'
import { mensagemDoErroFuncao } from './erroFuncao'

export type PedidoCredencial =
  | { tipo: 'fiscal'; barracaId: string; ambiente: 'homologacao' | 'producao'; valor: string }
  | { tipo: 'pagamento' | 'segredo_webhook'; barracaId: string; provedor: string; valor: string }

/** Devolve a mensagem de erro para mostrar ao usuário, ou null se salvou. */
export async function salvarCredencial(pedido: PedidoCredencial): Promise<string | null> {
  const { barracaId, valor, ...resto } = pedido
  const { data, error } = await supabase.functions.invoke('salvar-credencial', {
    body: { barraca_id: barracaId, valor, ...resto },
  })
  if (error) return mensagemDoErroFuncao(error, 'Não foi possível salvar agora. Tente novamente em instantes.')
  if ((data as { ok?: boolean } | null)?.ok !== true) return 'Não foi possível salvar agora. Tente novamente em instantes.'
  return null
}
