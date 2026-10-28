import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

export type TipoOperacao =
  | 'criar_pedido'
  | 'mudar_status'
  | 'remover_item'
  | 'marcar_entregue'
  | 'definir_metodo'
  | 'fechar_comanda'
  | 'salvar_cliente'
  | 'registrar_contato'

export type OperacaoPendente = {
  id: string
  tipo: TipoOperacao
  payload: Record<string, unknown>
  criadoEm: string
  tentativas: number
  /** Recusas definitivas do servidor (ver filaProcessamento.ts); ausente = 0. */
  recusas?: number
}

/** Operação que o servidor recusou de vez: sai da fila mas fica guardada, com o payload, para reenviar. */
export type OperacaoFalha = OperacaoPendente & { motivo: string; descartadaEm: string }

interface FilaDB extends DBSchema {
  operacoes: {
    key: string
    value: OperacaoPendente
    indexes: { criadoEm: string }
  }
  falhas: {
    key: string
    value: OperacaoFalha
  }
}

const EVENTO_FILA_MUDOU = 'mesaagil:fila-mudou'

/** O cadastro do cliente de um pedido de Entrega não foi salvo de primeira (o reenvio já está na fila). */
export const EVENTO_CLIENTE_NAO_SALVO = 'mesaagil:cliente-nao-salvo'

/** Uma operação saiu da fila porque o servidor a recusou de vez (detail: DetalheOperacaoDescartada). */
export const EVENTO_OPERACAO_DESCARTADA = 'mesaagil:operacao-descartada'
export type DetalheOperacaoDescartada = { id: string; tipo: TipoOperacao; motivo: string }

let dbPromise: Promise<IDBPDatabase<FilaDB>> | null = null

function obterDB() {
  if (!dbPromise) {
    dbPromise = openDB<FilaDB>('mesaagil-fila', 2, {
      upgrade(db, versaoAntiga) {
        if (versaoAntiga < 1) {
          const store = db.createObjectStore('operacoes', { keyPath: 'id' })
          store.createIndex('criadoEm', 'criadoEm')
        }
        if (versaoAntiga < 2) db.createObjectStore('falhas', { keyPath: 'id' })
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

/** Soma uma recusa definitiva do servidor e devolve o total. */
export async function incrementarRecusa(id: string): Promise<number> {
  const db = await obterDB()
  const operacao = await db.get('operacoes', id)
  if (!operacao) return 0
  operacao.recusas = (operacao.recusas ?? 0) + 1
  await db.put('operacoes', operacao)
  return operacao.recusas
}

/** Tira da fila e guarda em `falhas` na MESMA transação: a operação nunca fica sem casa. Avisa o operador. */
export async function descartarParaFalhas(op: OperacaoPendente, motivo: string): Promise<void> {
  const db = await obterDB()
  const tx = db.transaction(['operacoes', 'falhas'], 'readwrite')
  await Promise.all([
    tx.objectStore('falhas').put({ ...op, motivo, descartadaEm: new Date().toISOString() }),
    tx.objectStore('operacoes').delete(op.id),
    tx.done,
  ])
  window.dispatchEvent(
    new CustomEvent<DetalheOperacaoDescartada>(EVENTO_OPERACAO_DESCARTADA, { detail: { id: op.id, tipo: op.tipo, motivo } }),
  )
}

export async function listarFalhas(): Promise<OperacaoFalha[]> {
  const db = await obterDB()
  return db.getAll('falhas')
}

/** Devolve a operação para a fila (ordem original pelo criadoEm), com as contagens zeradas. */
export async function reenviarFalha(id: string): Promise<void> {
  const db = await obterDB()
  const tx = db.transaction(['operacoes', 'falhas'], 'readwrite')
  const falha = await tx.objectStore('falhas').get(id)
  if (falha) {
    const { motivo: _motivo, descartadaEm: _quando, ...operacao } = falha
    void _motivo
    void _quando
    await Promise.all([
      tx.objectStore('operacoes').put({ ...operacao, tentativas: 0, recusas: 0 }),
      tx.objectStore('falhas').delete(id),
    ])
  }
  await tx.done
  window.dispatchEvent(new Event(EVENTO_FILA_MUDOU))
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

/**
 * Broadcast de TODO pedido criado neste aparelho (com o payload original e a
 * senha real do servidor) — usado pela impressão automática da comanda, que
 * precisa da senha e dos itens e não pode depender de tela montada.
 */
export type PedidoCriadoLocal = {
  idOperacao: string
  pedidoId: string
  senha: number
  payload: Record<string, unknown>
  /** Quando o operador enviou o pedido (op.criadoEm), não quando a fila sincronizou. */
  enviadoEm: string
}
const ouvintesPedidoCriado = new Set<(pedido: PedidoCriadoLocal) => void>()

export function aoCriarPedidoLocal(ouvinte: (pedido: PedidoCriadoLocal) => void): () => void {
  ouvintesPedidoCriado.add(ouvinte)
  return () => {
    ouvintesPedidoCriado.delete(ouvinte)
  }
}

export function emitirPedidoCriadoLocal(pedido: PedidoCriadoLocal): void {
  ouvintesPedidoCriado.forEach((ouvinte) => ouvinte(pedido))
}
