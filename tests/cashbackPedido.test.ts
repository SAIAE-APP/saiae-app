// Cashback no pedido do cardápio: avaliar, reservar e liberar saldo (supabase falso registrando as chamadas rpc). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { avaliarCashbackDoPedido, liberarCashbackAbandonado, reservarCashbackDoPedido } from '../supabase/functions/_shared/cashbackPedido.ts'

type Chamada = { nome: string; args: Record<string, unknown> }

function falso(resposta: { data?: unknown; error?: unknown } | (() => never)) {
  const chamadas: Chamada[] = []
  const supabase = {
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.push({ nome, args })
      if (typeof resposta === 'function') return resposta()
      return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null })
    },
  }
  return { supabase: supabase as never, chamadas }
}

const BASE = { barracaId: 'b1', clienteId: 'c1', itensCentavos: 4000, temCupom: false }

describe('avaliarCashbackDoPedido', () => {
  test('usar ausente ou diferente de true não chama o banco', async () => {
    for (const usar of [undefined, false, 'true', 1, null]) {
      const { supabase, chamadas } = falso({ data: { ok: true, resgate_centavos: 999 } })
      const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar })
      assert.deepEqual(r, { ok: true, resgate: 0 })
      assert.equal(chamadas.length, 0)
    }
  })
  test('SUPOSIÇÃO-CASHBACK-4: cupom e saldo juntos = 422 sem consultar o banco', async () => {
    const { supabase, chamadas } = falso({ data: { ok: true, resgate_centavos: 200 } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true, temCupom: true })
    assert.ok(!r.ok)
    if (!r.ok) {
      assert.equal(r.status, 422)
      assert.equal(r.corpo.codigo, 'cashback_e_cupom')
    }
    assert.equal(chamadas.length, 0)
  })
  test('sem cliente identificado = 401', async () => {
    const { supabase, chamadas } = falso({ data: { ok: true, resgate_centavos: 200 } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true, clienteId: null })
    assert.ok(!r.ok)
    if (!r.ok) {
      assert.equal(r.status, 401)
      assert.equal(r.corpo.codigo, 'cashback_sem_cliente')
    }
    assert.equal(chamadas.length, 0)
  })
  test('resgate válido volta com o valor e chama a RPC de avaliação com os argumentos certos', async () => {
    const { supabase, chamadas } = falso({ data: { ok: true, resgate_centavos: 200 } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true })
    assert.deepEqual(r, { ok: true, resgate: 200 })
    assert.deepEqual(chamadas, [
      { nome: 'cashback_avaliar_resgate', args: { p_barraca_id: 'b1', p_cliente_id: 'c1', p_itens_centavos: 4000 } },
    ])
  })
  test('erro da RPC = 500 e nenhum desconto', async () => {
    const { supabase } = falso({ error: { message: 'x' } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true })
    assert.ok(!r.ok)
    if (!r.ok) assert.equal(r.status, 500)
  })
  test('ok:false do banco = 422 com a mensagem do erro', async () => {
    const { supabase } = falso({ data: { ok: false, erro: 'sem_saldo' } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true })
    assert.ok(!r.ok)
    if (!r.ok) {
      assert.equal(r.status, 422)
      assert.equal(r.corpo.erro, 'Você não tem saldo disponível.')
    }
  })
  test('resposta fora de forma = 422 e nunca desconto', async () => {
    const { supabase } = falso({ data: { ok: true, resgate_centavos: -50 } })
    const r = await avaliarCashbackDoPedido(supabase, { ...BASE, usar: true })
    assert.ok(!r.ok)
  })
})

describe('reservarCashbackDoPedido', () => {
  const A = { barracaId: 'b1', clienteId: 'c1', itensCentavos: 4000, pendenteId: 'p1', reservadoAte: new Date('2026-11-01T12:00:00.000Z') }

  test('reserva ok devolve resgate e usoId e manda os argumentos certos', async () => {
    const { supabase, chamadas } = falso({ data: { ok: true, resgate_centavos: 200, uso_id: 'u1' } })
    const r = await reservarCashbackDoPedido(supabase, A)
    assert.deepEqual(r, { ok: true, resgate: 200, usoId: 'u1' })
    assert.deepEqual(chamadas, [
      {
        nome: 'cashback_reservar',
        args: { p_barraca_id: 'b1', p_cliente_id: 'c1', p_itens_centavos: 4000, p_pendente_id: 'p1', p_reservado_ate: '2026-11-01T12:00:00.000Z' },
      },
    ])
  })
  test('perdeu a corrida (ok:false) = 422', async () => {
    const { supabase } = falso({ data: { ok: false, erro: 'sem_saldo' } })
    const r = await reservarCashbackDoPedido(supabase, A)
    assert.ok(!r.ok)
    if (!r.ok) assert.equal(r.status, 422)
  })
  test('erro da RPC = 500', async () => {
    const { supabase } = falso({ error: { message: 'x' } })
    const r = await reservarCashbackDoPedido(supabase, A)
    assert.ok(!r.ok)
    if (!r.ok) assert.equal(r.status, 500)
  })
  test('ok sem uso_id é tratado como falha (não há reserva para confirmar depois)', async () => {
    const { supabase } = falso({ data: { ok: true, resgate_centavos: 200 } })
    const r = await reservarCashbackDoPedido(supabase, A)
    assert.ok(!r.ok)
  })
})

describe('liberarCashbackAbandonado', () => {
  test('chama a RPC com o pendente anterior', async () => {
    const { supabase, chamadas } = falso({ data: null })
    await liberarCashbackAbandonado(supabase, { barracaId: 'b1', clienteId: 'c1', pendenteAnteriorId: 'p0' })
    assert.deepEqual(chamadas, [
      { nome: 'cashback_liberar_abandonadas', args: { p_barraca_id: 'b1', p_cliente_id: 'c1', p_pendente_anterior_id: 'p0' } },
    ])
  })
  test('sem cliente identificado não chama o banco', async () => {
    const { supabase, chamadas } = falso({ data: null })
    await liberarCashbackAbandonado(supabase, { barracaId: 'b1', clienteId: null })
    assert.equal(chamadas.length, 0)
  })
  test('engole erro da RPC e exceção', async () => {
    const a = falso({ error: { message: 'x' } })
    await liberarCashbackAbandonado(a.supabase, { barracaId: 'b1', clienteId: 'c1' })
    const b = falso(() => {
      throw new Error('rede')
    })
    await liberarCashbackAbandonado(b.supabase, { barracaId: 'b1', clienteId: 'c1', pendenteAnteriorId: null })
  })
})
