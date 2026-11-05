// Laço da fila offline (useSincronizacao) sem React nem IndexedDB: dependências injetadas, testado em
// tests/filaProcessamento.test.ts. Regra: erro de rede/timeout/5xx PARA a fila (preserva a ordem); erro que o servidor
// recusa de forma definitiva também para, mas só até MAX_RECUSAS tentativas — depois a operação sai da fila PARA a lista
// de falhas (nunca é apagada) e as próximas seguem.
import { bancoSemRecurso } from './semMigration.ts'

/** Recusas definitivas do servidor toleradas antes de a operação sair da fila (com o backoff de 30 s, ~3 min). */
export const MAX_RECUSAS = 10

// Códigos que o servidor devolve quando o DADO é o problema e repetir não adianta:
//  22xxx  dado inválido (uuid/número malformado em p_itens...)
//  23xxx  integridade: 23502 not null, 23503 item apagado do cardápio (FK), 23514 check — menos 23505 (client_uuid
//         repetido numa corrida: o reenvio acha o pedido e conclui, então tentar de novo resolve)
//  P0001  raise exception do banco
//  42501  RLS/permissão: assinatura vencida, sem acesso à barraca, trigger item_de_outra_barraca
// Ficam FORA (continuam repetindo): rede sem código, 5xx, PGRST301 (sessão expirada) e banco sem a migration (42P01/42883/PGRST202).
const CODIGO_RECUSA = /^(22|23|P0001$|42501$)/

/** O servidor recusou de forma definitiva (vale para qualquer operação da fila). */
export function erroPermanente(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null | undefined)?.code
  if (typeof codigo !== 'string' || codigo === '23505') return false
  if (bancoSemRecurso(erro)) return false
  return CODIGO_RECUSA.test(codigo)
}

/** Texto para o operador: o que o servidor recusou, sem jargão. */
export function motivoDaFalha(erro: unknown): string {
  const codigo = (erro as { code?: unknown } | null | undefined)?.code
  if (codigo === '23503') return 'um item do pedido não existe mais no cardápio'
  if (codigo === '42501') return 'o servidor recusou (assinatura vencida ou sem permissão)'
  if (typeof codigo === 'string' && /^(22|23)/.test(codigo)) return 'os dados do pedido estão inválidos'
  const mensagem = (erro as { message?: unknown } | null | undefined)?.message
  return typeof mensagem === 'string' && mensagem ? mensagem : 'o servidor recusou'
}

export type OperacaoDaFila = { id: string; tipo: string }

export type DepsProcessamento<T extends OperacaoDaFila> = {
  online: () => boolean
  executar: (op: T) => Promise<void>
  concluir: (id: string) => Promise<void>
  contarTentativa: (id: string) => Promise<void>
  /** Soma uma recusa definitiva e devolve o total (persistido). */
  contarRecusa: (id: string) => Promise<number>
  /** Guarda a operação na lista de falhas (com o payload) e a tira da fila — atômico — e avisa o operador. */
  descartar: (op: T, motivo: string) => Promise<void>
  /** Operação adiada só espera; as outras seguem. */
  adiada: (erro: unknown) => boolean
  aoFalhar?: (op: T, erro: unknown) => void
}

/** Processa em ordem. `falhou` = sobrou algo para reenviar (o chamador agenda o backoff). */
export async function processarOperacoes<T extends OperacaoDaFila>(
  lista: T[],
  deps: DepsProcessamento<T>,
): Promise<{ falhou: boolean }> {
  let falhou = false

  for (const op of lista) {
    if (!deps.online()) {
      falhou = true
      break
    }

    try {
      await deps.executar(op)
      await deps.concluir(op.id)
    } catch (erro) {
      deps.aoFalhar?.(op, erro)
      await deps.contarTentativa(op.id)
      if (deps.adiada(erro)) {
        falhou = true
        continue
      }
      if (erroPermanente(erro) && (await deps.contarRecusa(op.id)) >= MAX_RECUSAS) {
        await deps.descartar(op, motivoDaFalha(erro))
        continue
      }
      falhou = true
      break
    }
  }

  return { falhou }
}
