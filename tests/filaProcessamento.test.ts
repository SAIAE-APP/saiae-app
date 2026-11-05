// Fila offline: operação recusada de vez pelo servidor não trava as seguintes e nunca é apagada. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { erroPermanente, MAX_RECUSAS, motivoDaFalha, processarOperacoes } from '../src/lib/filaProcessamento.ts'

type Op = { id: string; tipo: string; recusas: number }

/** Fila e lista de falhas em memória, com a mesma regra do IndexedDB (descartar = mover, nunca apagar). */
function bancoFalso(ids: string[], erros: Record<string, unknown>, online = () => true, adiada: (erro: unknown) => boolean = () => false) {
  const fila: Op[] = ids.map((id) => ({ id, tipo: 'criar_pedido', recusas: 0 }))
  const falhas: (Op & { motivo: string })[] = []
  const enviados: string[] = []
  const avisos: string[] = []
  const deps = {
    online,
    executar: async (op: Op) => {
      if (op.id in erros) throw erros[op.id]
      enviados.push(op.id)
    },
    concluir: async (id: string) => void fila.splice(fila.findIndex((o) => o.id === id), 1),
    contarTentativa: async () => {},
    contarRecusa: async (id: string) => ++fila.find((o) => o.id === id)!.recusas,
    descartar: async (op: Op, motivo: string) => {
      falhas.push({ ...op, motivo })
      fila.splice(fila.findIndex((o) => o.id === op.id), 1)
      avisos.push(motivo)
    },
    adiada,
  }
  const rodada = () => processarOperacoes([...fila], deps)
  return { fila, falhas, enviados, avisos, rodada }
}

const fk = { code: '23503', message: 'violates foreign key constraint' }
const rede = new TypeError('Failed to fetch')

describe('erroPermanente', () => {
  test('recusa definitiva do servidor', () => {
    for (const code of ['23503', '23502', '23514', '22P02', 'P0001', '42501']) assert.equal(erroPermanente({ code }), true, code)
  })
  test('rede, 5xx, sessão expirada, client_uuid repetido e banco sem migration repetem', () => {
    assert.equal(erroPermanente(rede), false)
    assert.equal(erroPermanente({ code: '', message: 'Bad Gateway' }), false)
    for (const code of ['PGRST301', '23505', '42P01', '42883', 'PGRST202']) assert.equal(erroPermanente({ code }), false, code)
    assert.equal(erroPermanente({ code: '42703', message: 'column does not exist' }), false)
  })
})

describe('processarOperacoes', () => {
  test('operação envenenada na frente: para a fila até MAX_RECUSAS e então as seguintes passam', async () => {
    const b = bancoFalso(['ruim', 'B', 'C'], { ruim: fk })
    for (let i = 1; i < MAX_RECUSAS; i++) {
      const r = await b.rodada()
      assert.equal(r.falhou, true)
      assert.deepEqual(b.enviados, [], `rodada ${i}: B e C esperam (ordem preservada)`)
    }
    const r = await b.rodada()
    assert.deepEqual(b.enviados, ['B', 'C'])
    assert.equal(r.falhou, false)
    assert.deepEqual(b.fila, [])
  })

  test('operação descartada vai para as falhas com o payload e o motivo, e o operador é avisado', async () => {
    const b = bancoFalso(['ruim'], { ruim: fk })
    for (let i = 0; i < MAX_RECUSAS; i++) await b.rodada()
    assert.equal(b.falhas.length, 1)
    assert.equal(b.falhas[0].id, 'ruim')
    assert.equal(b.falhas[0].tipo, 'criar_pedido')
    assert.match(b.falhas[0].motivo, /não existe mais no cardápio/)
    assert.deepEqual(b.avisos, [b.falhas[0].motivo])
    assert.equal(b.fila.length, 0)
  })

  test('erro de rede continua parando a fila e nunca descarta, por mais que repita', async () => {
    const b = bancoFalso(['A', 'B'], { A: rede })
    for (let i = 0; i < MAX_RECUSAS * 3; i++) assert.equal((await b.rodada()).falhou, true)
    assert.deepEqual(b.enviados, [])
    assert.deepEqual(b.fila.map((o) => o.id), ['A', 'B'])
    assert.equal(b.falhas.length, 0)
  })

  test('sem internet nem tenta', async () => {
    const b = bancoFalso(['A'], {}, () => false)
    assert.equal((await b.rodada()).falhou, true)
    assert.deepEqual(b.enviados, [])
  })

  test('tudo certo: envia na ordem e não pede nova tentativa', async () => {
    const b = bancoFalso(['A', 'B', 'C'], {})
    assert.equal((await b.rodada()).falhou, false)
    assert.deepEqual(b.enviados, ['A', 'B', 'C'])
  })

  test('operação adiada espera sem parar as outras', async () => {
    const adiado = new Error('v6')
    const b = bancoFalso(['A', 'B'], { A: adiado }, () => true, (e) => e === adiado)
    assert.equal((await b.rodada()).falhou, true)
    assert.deepEqual(b.enviados, ['B'])
    assert.deepEqual(b.fila.map((o) => o.id), ['A'])
  })
})

describe('motivoDaFalha', () => {
  test('texto claro por código', () => {
    assert.match(motivoDaFalha({ code: '42501' }), /assinatura vencida ou sem permissão/)
    assert.match(motivoDaFalha({ code: '22P02' }), /inválidos/)
    assert.equal(motivoDaFalha({ code: 'P0001', message: 'item_de_outra_barraca' }), 'item_de_outra_barraca')
  })
})
