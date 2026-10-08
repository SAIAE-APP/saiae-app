// Rodar: node --experimental-strip-types supabase/functions/_shared/antiabuso.test.ts
import assert from 'node:assert/strict'
import { MIN_MS_NO_CHECKOUT, hashIp, ipDoCliente, pareceBot } from './antiabuso.ts'

// honeypot
assert.equal(pareceBot({ website: 'http://spam' }), true)
assert.equal(pareceBot({ website: '' }), false)
assert.equal(pareceBot({}), false)

// tempo no checkout: ausente = cliente antigo, passa; presente e curto = bot
assert.equal(pareceBot({ ms_no_checkout: undefined }), false)
assert.equal(pareceBot({ ms_no_checkout: null }), false)
assert.equal(pareceBot({ ms_no_checkout: MIN_MS_NO_CHECKOUT - 1 }), true)
assert.equal(pareceBot({ ms_no_checkout: MIN_MS_NO_CHECKOUT }), false)
assert.equal(pareceBot({ ms_no_checkout: 'abc' }), true)
assert.equal(pareceBot({ ms_no_checkout: 45000 }), false)

// IP: prioridade cf-connecting-ip > x-forwarded-for (primeiro) > x-real-ip
const req = (h: Record<string, string>) => new Request('https://x.test', { headers: h })
assert.equal(ipDoCliente(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' })), '1.1.1.1')
assert.equal(ipDoCliente(req({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })), '2.2.2.2')
assert.equal(ipDoCliente(req({ 'x-real-ip': '4.4.4.4' })), '4.4.4.4')
assert.equal(ipDoCliente(req({})), 'desconhecido')

// hash: estável, escopo e barraca separam os contadores, IP não aparece em claro
const a = await hashIp('pix', '1.1.1.1', 'barraca-1')
assert.equal(a, await hashIp('pix', '1.1.1.1', 'barraca-1'))
assert.notEqual(a, await hashIp('pedido', '1.1.1.1', 'barraca-1'))
assert.notEqual(a, await hashIp('pix', '1.1.1.1', 'barraca-2'))
assert.notEqual(a, await hashIp('pix', '1.1.1.2', 'barraca-1'))
assert.match(a, /^[0-9a-f]{64}$/)
assert.ok(!a.includes('1.1.1.1'))

console.log('antiabuso.test.ts: tudo certo')
