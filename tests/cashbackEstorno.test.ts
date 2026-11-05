// Estorno total reverte o cashback (best-effort, depois que o dinheiro voltou). Dependências falsas, no estilo do
// teste de estorno em supabase/functions/_shared/pagamento/pagamento.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { estornarPedido, type DepsEstorno } from '../supabase/functions/_shared/pagamento/estorno.ts'

const pago = { id: 'p1', status: 'aprovado', mercadopago_order_id: '777', provedor: 'mercadopago', taxa_plataforma_centavos: 99, estornado_em: null }

function montar(o: {
  pendentes?: Record<string, unknown>[]
  resultado?: { ok: true } | { ok: false; motivo: 'saldo_insuficiente' | 'outro' }
  apos?: (id: string) => Promise<void>
  semApos?: boolean
}) {
  const chamadas: string[] = []
  const provedor = {
    chave: 'mercadopago' as const,
    nome: 'Mercado Pago',
    estornar: async () => o.resultado ?? { ok: true as const },
  }
  const deps = {
    barracaDoPedido: async () => 'b1',
    ehDono: async () => true,
    pendentesDoPedido: async () => o.pendentes ?? [pago],
    vendedor: async () => ({ ok: true, token: 'OAUTH', publicKey: null }) as never,
    colado: async () => 'COLADO',
    provedor: (chave: unknown) => (chave === 'mercadopago' ? (provedor as never) : null),
    marcarEstornado: async () => true,
    ...(o.semApos ? {} : { aposEstorno: async (id: string) => { chamadas.push(id); await o.apos?.(id) } }),
  } as DepsEstorno
  return { deps, chamadas }
}

describe('aposEstorno (reverte o cashback)', () => {
  test('estorno ok chama aposEstorno uma vez com o pedidoId', async () => {
    const { deps, chamadas } = montar({})
    assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true } })
    assert.deepEqual(chamadas, ['ped1'])
  })

  test('repetição (ja_estornado) também chama: reprocesso seguro, a RPC é idempotente', async () => {
    const { deps, chamadas } = montar({ pendentes: [{ ...pago, estornado_em: '2026-10-26T12:00:00Z' }] })
    assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true, codigo: 'ja_estornado' } })
    assert.deepEqual(chamadas, ['ped1'])
  })

  test('aposEstorno que lança não altera { ok: true }', async () => {
    const silencio = console.error
    console.error = () => {}
    try {
      const { deps } = montar({ apos: async () => { throw new Error('boom') } })
      assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true } })
    } finally {
      console.error = silencio
    }
  })

  test('sem aposEstorno nas dependências o estorno é o de sempre', async () => {
    const { deps } = montar({ semApos: true })
    assert.deepEqual(await estornarPedido('ped1', deps), { status: 200, corpo: { ok: true } })
  })

  test('recusa do provedor NÃO chama aposEstorno', async () => {
    for (const resultado of [{ ok: false as const, motivo: 'saldo_insuficiente' as const }, { ok: false as const, motivo: 'outro' as const }]) {
      const { deps, chamadas } = montar({ resultado })
      assert.equal((await estornarPedido('ped1', deps)).status, 409)
      assert.deepEqual(chamadas, [])
    }
  })

  test('pedido não pago online não chama', async () => {
    const { deps, chamadas } = montar({ pendentes: [{ ...pago, status: 'pendente' }] })
    assert.equal((await estornarPedido('ped1', deps)).status, 422)
    assert.deepEqual(chamadas, [])
  })
})

describe('estornar-pagamento liga aposEstorno à RPC', () => {
  const index = readFileSync(new URL('../supabase/functions/estornar-pagamento/index.ts', import.meta.url), 'utf8')
  test('chama cashback_estornar_pedido e só registra erro em log', () => {
    assert.match(index, /aposEstorno/)
    assert.match(index, /rpc\('cashback_estornar_pedido', \{ p_pedido_id: id \}\)/)
    assert.match(index, /console\.error\('estornar-pagamento: cashback não revertido'/)
  })
})
