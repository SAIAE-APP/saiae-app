// Fechar a comanda aberta da Mesa pela fila de sincronização (operação `fechar_comanda`, payload
// `{ comanda_id, metodo, cobrar_taxa_servico }`). Idempotente no servidor: reenviar com o mesmo método devolve `ok`.
// Espelha src/lib/definirMetodoFila.ts. PURO, testado em tests/fecharComandaFila.test.ts.

export type DesfechoFecharNaFila =
  /** Fechada (agora ou num envio anterior): sai da fila. */
  | 'concluida'
  /** Banco ainda sem a RPC (PGRST202): fica na fila e reenvia, sem travar as outras. */
  | 'adiar'
  /** Reenviar nunca resolve (outro método, sem acesso, sem itens, método inválido): sai da fila e avisa. */
  | 'falha'
  /** Erro de rede/sessão ou resposta estranha: reenvia como as demais operações (para a fila, preserva a ordem). */
  | 'repetir'

const ESTADOS_SEM_SOLUCAO = new Set(['ja_fechada', 'sem_acesso', 'sem_itens', 'metodo_invalido'])

/** Resposta da RPC `fechar_comanda` (ou erro) → o que a fila faz. */
export function desfechoFecharComanda(
  erro: { code?: string; message?: string } | null | undefined,
  resposta: { estado?: string } | null | undefined,
): DesfechoFecharNaFila {
  if (erro) return erro.code === 'PGRST202' ? 'adiar' : 'repetir'
  if (resposta?.estado === 'ok') return 'concluida'
  return resposta?.estado !== undefined && ESTADOS_SEM_SOLUCAO.has(resposta.estado) ? 'falha' : 'repetir'
}
