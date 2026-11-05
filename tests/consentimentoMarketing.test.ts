// Cookies de medição lidos no navegador e gravados só com consentimento. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { gaClientIdDoCookie, lerCookie } from '../src/lib/cookiesMedicao.ts'

describe('cookies', () => {
  test('lerCookie acha pelo nome exato', () => {
    assert.equal(lerCookie('a=1; _fbp=fb.1.2.3; _fbc=x', '_fbp'), 'fb.1.2.3')
    assert.equal(lerCookie('a=1', '_fbp'), null)
    assert.equal(lerCookie('x_fbp=1', '_fbp'), null)
  })
  test('client_id do GA4 vem do _ga (GA1.1.<id>.<ts>)', () => {
    assert.equal(gaClientIdDoCookie('GA1.1.123456789.1700000000'), '123456789.1700000000')
    assert.equal(gaClientIdDoCookie('lixo'), null)
    assert.equal(gaClientIdDoCookie(null), null)
  })
})
