// Webhook do Pix: corrida de notificações (23505 em pedidos_client_uuid_key) vira sucesso idempotente;
// qualquer outro erro continua sendo falha. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { desfechoDaCriacao, ehConflitoClientUuid } from '../supabase/functions/_shared/pagamento/corrida.ts'

const CONFLITO = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "pedidos_client_uuid_key"',
}

describe('ehConflitoClientUuid', () => {
  test('só a unicidade de client_uuid conta', () => {
    assert.equal(ehConflitoClientUuid(CONFLITO), true)
    assert.equal(ehConflitoClientUuid({ code: '23505', message: 'duplicate key value violates unique constraint "outra_key"' }), false)
    assert.equal(ehConflitoClientUuid({ code: '23503', message: 'pedidos_client_uuid_key' }), false)
    assert.equal(ehConflitoClientUuid({ message: 'timeout' }), false)
    assert.equal(ehConflitoClientUuid(null), false)
  })
})

describe('desfechoDaCriacao', () => {
  const naoDeveBuscar = async () => {
    throw new Error('não devia buscar')
  }

  test('criou normalmente', async () => {
    assert.deepEqual(await desfechoDaCriacao({ pedido_id: 'p1' }, null, naoDeveBuscar), { acao: 'criado', pedidoId: 'p1' })
  })

  test('ramo 1: corrida — pedido já existe, devolve o id dele (sem falha)', async () => {
    let buscas = 0
    const r = await desfechoDaCriacao(null, CONFLITO, async () => {
      buscas++
      return 'p-existente'
    })
    assert.deepEqual(r, { acao: 'ja_existia', pedidoId: 'p-existente' })
    assert.equal(buscas, 1)
  })

  test('ramo 2: outro erro continua sendo falha e nem busca o pedido', async () => {
    const r = await desfechoDaCriacao(null, { code: '57014', message: 'canceling statement due to statement timeout' }, naoDeveBuscar)
    assert.equal(r.acao, 'falha')
    if (r.acao === 'falha') assert.match(r.detalhe, /timeout/)
  })

  test('conflito mas o pedido não é encontrado: falha (500 e conciliação), nunca engole', async () => {
    const r = await desfechoDaCriacao(null, CONFLITO, async () => null)
    assert.equal(r.acao, 'falha')
  })

  test('sem erro e sem resultado: falha', async () => {
    const r = await desfechoDaCriacao(null, null, naoDeveBuscar)
    assert.deepEqual(r, { acao: 'falha', detalhe: 'sem resposta' })
  })
})
