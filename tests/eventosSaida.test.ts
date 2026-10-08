// SAI-013: assinatura HMAC e guarda de URL do worker de eventos. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import {
  assinarEvento,
  cabecalhosDoEvento,
  segredosIguais,
  urlPermitida,
} from '../supabase/functions/_shared/eventosSaida.ts'

describe('assinatura', () => {
  test('sha256= + HMAC(segredo, timestamp.corpo), igual ao node:crypto', async () => {
    const corpo = '{"id":"e1","type":"order.created"}'
    const esperado = 'sha256=' + createHmac('sha256', 'segredo-de-teste').update(`1760000000.${corpo}`).digest('hex')
    assert.equal(await assinarEvento('segredo-de-teste', 1760000000, corpo), esperado)
  })
  test('qualquer byte do corpo, do timestamp ou do segredo muda a assinatura', async () => {
    const a = await assinarEvento('s', 1, '{"a":1}')
    assert.notEqual(a, await assinarEvento('s', 1, '{"a":2}'))
    assert.notEqual(a, await assinarEvento('s', 2, '{"a":1}'))
    assert.notEqual(a, await assinarEvento('outro', 1, '{"a":1}'))
  })
  test('cabeçalhos do contrato', async () => {
    const h = await cabecalhosDoEvento('s', 'uuid-1', 1760000000, '{}')
    assert.equal(h['X-Saiae-Event-Id'], 'uuid-1')
    assert.equal(h['X-Saiae-Timestamp'], '1760000000')
    assert.match(h['X-Saiae-Signature'], /^sha256=[0-9a-f]{64}$/)
  })
})

describe('urlPermitida', () => {
  test('aceita https público', () => {
    assert.equal(urlPermitida('https://crm.saiae.com.br/api/integracao/comanda/v1/eventos'), true)
  })
  test('recusa http, host interno, IP privado, IPv6 e credencial na URL', () => {
    for (const u of [
      'http://crm.saiae.com.br/x',
      'https://localhost/x',
      'https://app.localhost/x',
      'https://x.internal/x',
      'https://10.0.0.5/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/x',
      'https://172.16.1.1/x',
      'https://192.168.0.1/x',
      'https://[::1]/x',
      'https://user:pw@crm.saiae.com.br/x',
      'nao-e-url',
      '',
    ]) {
      assert.equal(urlPermitida(u), false, u)
    }
  })
})

describe('segredosIguais', () => {
  test('exige os dois lados e igualdade exata', () => {
    assert.equal(segredosIguais('abc', 'abc'), true)
    assert.equal(segredosIguais('abc', 'abd'), false)
    assert.equal(segredosIguais('abc', undefined), false)
    assert.equal(segredosIguais(null, 'abc'), false)
    assert.equal(segredosIguais('', ''), false)
  })
})
