import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

export type TipoOperacao = 'criar_pedido' | 'mudar_status' | 'remover_item' | 'marcar_entregue'

export type OperacaoPendente = {
  id: string
  tipo: TipoOperacao
  payload: Record<string, unknown>
  criadoEm: string
  tentativas: number
}

interface FilaDB extends DBSchema {
  operacoes: {
    key: string
    value: OperacaoPendente
    indexes: { criadoEm: string }
  }
}

const EVENTO_FILA_MUDOU = 'mesaagil:fila-mudou'

let dbPromise: Promise<IDBPDatabase<FilaDB>> | null = null

function obterDB() {
  if (!dbPromise) {
    dbPromise = openDB<FilaDB>('mesaagil-fila', 1, {
      upgrade(db) {
        const store = db.createObjectStore('operacoes', { keyPath: 'id' })
        store.createIndex('criadoEm', 'criadoEm')
      },
    })
  }
  return dbPromise
}

export async function enfileirar(
  tipo: TipoOperacao,
  payload: Record<string, unknown>,
): Promise<OperacaoPendente> {
  const operacao: OperacaoPendente = {
    id: crypto.randomUUID(),
    tipo,
    payload,
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  }

  const db = await obterDB()
  await db.add('operacoes', operacao)
  window.dispatchEvent(new Event(EVENTO_FILA_MUDOU))

  return operacao
}

export async function listarPendentes(): Promise<OperacaoPendente[]> {
  const db = await obterDB()
  return db.getAllFromIndex('operacoes', 'criadoEm')
}

export async function marcarConcluida(id: string): Promise<void> {
  const db = await obterDB()
  await db.delete('operacoes', id)
}

export async function incrementarTentativa(id: string): Promise<void> {
  const db = await obterDB()
  const operacao = await db.get('operacoes', id)
  if (!operacao) return
  operacao.tentativas += 1
  await db.put('operacoes', operacao)
}

export function ouvirMudancaFila(ouvinte: () => void): () => void {
  window.addEventListener(EVENTO_FILA_MUDOU, ouvinte)
  return () => window.removeEventListener(EVENTO_FILA_MUDOU, ouvinte)
}

/**
 * Pub-sub pra avisar a tela que criou o pedido assim que a operação
 * 'criar_pedido' correspondente sincronizar e o servidor atribuir a
 * senha real (LancarPedido mostra um spinner até isso acontecer, nunca
 * um número local/provisório — ver EstadoPedidoEnviado em carrinho.ts).
 *
 * Em rede rápida a fila pode terminar ANTES de LancarPedido montar e
 * registrar o ouvinte (enfileirar → navigate → efeito). Por isso o
 * resultado fica guardado num cache limitado: quem registra depois recebe
 * o resultado pronto na hora em vez de esperar um aviso que já passou.
 */
type ResultadoCriacao = { pedidoId: string; senha: number }
type OuvinteCriacao = (resultado: ResultadoCriacao) => void
const ouvintesCriacao = new Map<string, OuvinteCriacao[]>()
const resultadosProntos = new Map<string, ResultadoCriacao>()
const LIMITE_RESULTADOS_PRONTOS = 50

export function aoConcluirCriacaoPedido(idOperacao: string, ouvinte: OuvinteCriacao): () => void {
  const pronto = resultadosProntos.get(idOperacao)
  if (pronto) {
    let cancelado = false
    queueMicrotask(() => {
      if (!cancelado) ouvinte(pronto)
    })
    return () => {
      cancelado = true
    }
  }

  const lista = ouvintesCriacao.get(idOperacao) ?? []
  lista.push(ouvinte)
  ouvintesCriacao.set(idOperacao, lista)

  return () => {
    const atual = ouvintesCriacao.get(idOperacao)
    if (!atual) return
    const restante = atual.filter((o) => o !== ouvinte)
    if (restante.length > 0) ouvintesCriacao.set(idOperacao, restante)
    else ouvintesCriacao.delete(idOperacao)
  }
}

export function notificarCriacaoPedido(idOperacao: string, resultado: ResultadoCriacao): void {
  resultadosProntos.set(idOperacao, resultado)
  if (resultadosProntos.size > LIMITE_RESULTADOS_PRONTOS) {
    const maisAntigo = resultadosProntos.keys().next().value
    if (maisAntigo !== undefined) resultadosProntos.delete(maisAntigo)
  }

  const lista = ouvintesCriacao.get(idOperacao)
  if (!lista) return
  lista.forEach((ouvinte) => ouvinte(resultado))
  ouvintesCriacao.delete(idOperacao)
}
