// Regras PURAS da impressão automática da comanda (sem Capacitor/Supabase, pra
// dar pra testar em Node). Decisão do João (Sprint 6): cada aparelho com
// impressora imprime UMA via de cada pedido; com dois aparelhos ligados saem
// DUAS vias. Não existe trava global entre aparelhos: a idempotência é POR
// APARELHO (esta chave) e os dois celulares dividem a MESMA impressora
// Bluetooth (SPP aceita uma conexão por vez), então quando ela está ocupada a
// impressão tenta de novo com espera curta e aleatória antes de desistir.

export const PREFIXO_IMPRESSA = 'mesaagil:comanda-impressa:'
export const PREFIXO_IMPRESSA_POR_ID = 'mesaagil:comanda-impressa-id:'

/** Máximo de tentativas de impressão (a 1ª + 3 retentativas) antes do toast de erro. */
export const MAX_TENTATIVAS_IMPRESSAO = 4

type IdsDoPedido = { pedidoId?: string | null; clientUuid?: string | null }

/**
 * Chaves de idempotência do pedido neste aparelho. Os dois caminhos (a: pedido
 * criado aqui, b: Realtime INSERT) enxergam o mesmo pedido por ids diferentes
 * (a conhece client_uuid + pedidoId, b conhece id + client_uuid), então o pedido
 * é marcado/consultado por TODAS as chaves possíveis. A de client_uuid mantém o
 * formato antigo (aparelho que já tinha marcação continua reconhecendo).
 */
export function chavesDeImpressao({ pedidoId, clientUuid }: IdsDoPedido): string[] {
  const chaves: string[] = []
  if (clientUuid) chaves.push(PREFIXO_IMPRESSA + clientUuid)
  if (pedidoId) chaves.push(PREFIXO_IMPRESSA_POR_ID + pedidoId)
  return chaves
}

/** Subconjunto de `Storage` usado aqui (localStorage, ou um fake nos testes). */
export type ArmazenamentoChaves = Pick<Storage, 'getItem' | 'setItem'>

export function jaImpressoNesteAparelho(armazenamento: ArmazenamentoChaves | null, ids: IdsDoPedido): boolean {
  if (!armazenamento) return false
  try {
    return chavesDeImpressao(ids).some((chave) => armazenamento.getItem(chave) !== null)
  } catch {
    return false
  }
}

export function marcarImpressoNesteAparelho(
  armazenamento: ArmazenamentoChaves | null,
  ids: IdsDoPedido,
  agoraIso: string = new Date().toISOString(),
): void {
  if (!armazenamento) return
  for (const chave of chavesDeImpressao(ids)) {
    try {
      armazenamento.setItem(chave, agoraIso)
    } catch {
      // sem storage: a idempotência em memória (Set no hook) ainda vale na sessão
    }
  }
}

type ErroComCodigo = { code?: string; message?: string }

/** Códigos do plugin que indicam conexão ocupada/instável (vale tentar de novo). */
const CODIGOS_RETENTAVEIS = new Set(['connect_failed', 'write_failed'])
/** Sem código: mensagens típicas de socket Bluetooth ocupado. */
const MENSAGEM_OCUPADA = /busy|ocupad|socket|connect|read failed|broken pipe|timeout|timed out/i

/**
 * Vale tentar de novo? Só erro de conexão/impressora ocupada. Permissão
 * negada, impressora não encontrada, Bluetooth indisponível e dado inválido
 * NÃO melhoram esperando: vão direto pro toast "Toque para reimprimir".
 */
export function erroDeImpressoraOcupada(erro: unknown): boolean {
  const { code, message } = (erro ?? {}) as ErroComCodigo
  if (code) return CODIGOS_RETENTAVEIS.has(code)
  return MENSAGEM_OCUPADA.test(message ?? '')
}

/**
 * Espera antes da próxima tentativa, em ms: base de 1 s + aleatório crescente,
 * limitado a 3 s (curto: o operador está em pé esperando a comanda). O
 * aleatório existe pra dois aparelhos que falharam juntos não tentarem de novo
 * no mesmo instante e colidirem outra vez. `tentativaQueFalhou` começa em 1.
 */
export function esperaEntreTentativasMs(tentativaQueFalhou: number, aleatorio: () => number = Math.random): number {
  const topo = Math.min(3000, 1000 + 1000 * tentativaQueFalhou)
  return Math.round(1000 + aleatorio() * (topo - 1000))
}

/**
 * Executa `acao` com retentativa quando o erro é de impressora ocupada. Devolve
 * quando der certo; depois da última tentativa (ou em erro que não é de
 * ocupada) relança o último erro. Nunca bloqueia nada fora dela: quem chama é
 * uma tarefa em segundo plano.
 */
export async function comRetentativaDeImpressao<T>(
  acao: () => Promise<T>,
  opcoes: {
    maxTentativas?: number
    esperar?: (ms: number) => Promise<void>
    aleatorio?: () => number
    aoTentarDeNovo?: (tentativaQueFalhou: number, erro: unknown, esperaMs: number) => void
  } = {},
): Promise<T> {
  const {
    maxTentativas = MAX_TENTATIVAS_IMPRESSAO,
    esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    aleatorio = Math.random,
    aoTentarDeNovo,
  } = opcoes

  for (let tentativa = 1; ; tentativa++) {
    try {
      return await acao()
    } catch (erro) {
      if (tentativa >= maxTentativas || !erroDeImpressoraOcupada(erro)) throw erro
      const esperaMs = esperaEntreTentativasMs(tentativa, aleatorio)
      aoTentarDeNovo?.(tentativa, erro, esperaMs)
      await esperar(esperaMs)
    }
  }
}
