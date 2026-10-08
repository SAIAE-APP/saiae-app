// Envio do código de verificação ao CRM: assinatura, corpo e tratamento de falhas. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import { enviarCodigoAoCrm } from '../supabase/functions/_shared/codigoCrm.ts'

const args = {
  url: 'https://crm.exemplo.com/api/integracao/comanda/v1/codigo-verificacao',
  segredo: 'segredo-de-teste-com-16+',
  barracaId: '11111111-1111-4111-8111-111111111111',
  telefone: '61999531848',
  codigo: '123456',
  requestId: '22222222-2222-4222-8222-222222222222',
}

describe('enviarCodigoAoCrm', () => {
  test('envia corpo assinado no padrão do contrato', async () => {
    let capturado: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      capturado = { url, init }
      return new Response('{"enviado":true}', { status: 200 })
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.deepEqual(r, { ok: true })
    const h = capturado!.init.headers as Record<string, string>
    const corpo = capturado!.init.body as string
    assert.deepEqual(JSON.parse(corpo), {
      barraca_id: args.barracaId, telefone: args.telefone, codigo: args.codigo, request_id: args.requestId,
    })
    assert.equal(h['X-Saiae-Event-Id'], args.requestId)
    const esperado = 'sha256=' + createHmac('sha256', args.segredo).update(`${h['X-Saiae-Timestamp']}.${corpo}`).digest('hex')
    assert.equal(h['X-Saiae-Signature'], esperado)
  })

  test('resposta não-2xx vira falha sem vazar o corpo', async () => {
    const fake = (async () => new Response('{"error":"telefone 6199..."}', { status: 422 })) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.motivo, 'CRM respondeu 422')
  })

  test('erro de rede vira falha', async () => {
    const fake = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm(args, fake)
    assert.equal(r.ok, false)
  })

  test('URL que não é https público é recusada antes de enviar', async () => {
    let chamou = false
    const fake = (async () => {
      chamou = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const r = await enviarCodigoAoCrm({ ...args, url: 'http://localhost:3000/x' }, fake)
    assert.equal(r.ok, false)
    assert.equal(chamou, false)
  })
})
