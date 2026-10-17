/** Mensagem curta do erro, sem pilha e sem objeto. O banco ainda corta em 200 e tira e-mail/número longo. */
export function textoDoErro(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : ''
  return (bruto || 'erro sem mensagem').replace(/\s+/g, ' ').trim().slice(0, 200)
}

export const LIMITE_POR_SESSAO = 20
export const REPETIDO_EM_MS = 60_000

/** Quantos já foram e quando cada mensagem saiu pela última vez, para um loop de erro não virar enxurrada. */
export type EstadoLimite = { enviados: number; ultimaVez: Map<string, number> }

export function deveReportar(estado: EstadoLimite, chave: string, agora: number): boolean {
  if (estado.enviados >= LIMITE_POR_SESSAO) return false
  const ultima = estado.ultimaVez.get(chave)
  if (ultima !== undefined && agora - ultima < REPETIDO_EM_MS) return false
  estado.enviados += 1
  estado.ultimaVez.set(chave, agora)
  return true
}
