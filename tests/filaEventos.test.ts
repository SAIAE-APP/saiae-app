// Worker de eventos: pedido com vários eventos sai numa execução, em ordem, parando na 1ª falha. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { processarFila, type EventoReservado } from '../supabase/functions/_shared/filaEventos.ts'

type Ev = EventoReservado & { pedido: string; seq: number }

/** Banco falso com a mesma regra da RPC: só reserva evento pendente sem antecessor pendente no pedido;
 * falha deixa o evento pendente (retry futuro, fora de alcance). */
function bancoFalso(eventos: Ev[], falharEm: Set<string> = new Set()) {
  const pendentes = new Map(eventos.map((e) => [e.evento_id, e]))
  const futuro = new Set<string>()
  const enviadosEmOrdem: string[] = []
  return {
    enviadosEmOrdem,
    pendentes,
    dep: {
      reservar: async (limite: number) => {
        const lote = [...pendentes.values()]
          .filter((e) => !futuro.has(e.evento_id))
          .filter((e) => ![...pendentes.values()].some((a) => a.pedido === e.pedido && a.seq < e.seq))
          .slice(0, limite)
        return { erro: null, lote }
      },
      enviar: async (e: Ev) => (falharEm.has(e.evento_id) ? { ok: false, erro: 'CRM respondeu 500' } : { ok: true, erro: '' }),
      concluir: async (e: Ev, r: { ok: boolean }) => {
        if (r.ok) {
          pendentes.delete(e.evento_id)
          enviadosEmOrdem.push(e.evento_id)
        } else {
          futuro.add(e.evento_id)
        }
      },
    },
  }
}
const ev = (pedido: string, seq: number): Ev => ({ evento_id: `${pedido}-${seq}`, pedido, seq })

describe('processarFila', () => {
  test('pedido com 3 eventos sai em UMA execução, em ordem de sequence', async () => {
    const b = bancoFalso([ev('A', 3), ev('A', 1), ev('A', 2)])
    const r = await processarFila(b.dep)
    assert.deepEqual(r, { enviados: 3, falhas: 0, erroReservar: null })
    assert.deepEqual(b.enviadosEmOrdem, ['A-1', 'A-2', 'A-3'])
  })

  test('falha no meio não pula a ordem: os sucessores esperam', async () => {
    const b = bancoFalso([ev('A', 1), ev('A', 2), ev('A', 3)], new Set(['A-2']))
    const r = await processarFila(b.dep)
    assert.deepEqual(b.enviadosEmOrdem, ['A-1'])
    assert.equal(r.enviados, 1)
    assert.equal(r.falhas, 1)
    assert.deepEqual([...b.pendentes.keys()].sort(), ['A-2', 'A-3'])
  })

  test('pedidos diferentes andam juntos; a falha de um não trava o outro', async () => {
    const b = bancoFalso([ev('A', 1), ev('A', 2), ev('B', 1), ev('B', 2)], new Set(['A-1']))
    const r = await processarFila(b.dep)
    assert.deepEqual([...b.enviadosEmOrdem].sort(), ['B-1', 'B-2'])
    assert.equal(r.falhas, 1)
  })

  test('respeita o teto de eventos por execução', async () => {
    const todos = Array.from({ length: 10 }, (_, i) => ev(`P${i}`, 1))
    const b = bancoFalso(todos)
    const r = await processarFila(b.dep, { maxEventos: 4, limitePorRodada: 3 })
    assert.equal(r.enviados + r.falhas, 4)
    assert.equal(b.pendentes.size, 6)
  })

  test('erro ao reservar encerra com o que já foi enviado', async () => {
    let chamadas = 0
    const r = await processarFila({
      reservar: async () => (++chamadas === 1 ? { erro: null, lote: [ev('A', 1)] } : { erro: 'banco fora', lote: [] }),
      enviar: async () => ({ ok: true, erro: '' }),
      concluir: async () => {},
    })
    assert.deepEqual(r, { enviados: 1, falhas: 0, erroReservar: 'banco fora' })
  })

  test('fila vazia: não envia nada', async () => {
    const b = bancoFalso([])
    assert.deepEqual(await processarFila(b.dep), { enviados: 0, falhas: 0, erroReservar: null })
  })
})
