// public/_headers (auditoria B9): a CSP em vigor não muda; a Report-Only (sem 'unsafe-inline' em style-src) observa.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
const valor = (nome: string): string => {
  const linha = headers.split(/\r?\n/).find((l) => l.trim().toLowerCase().startsWith(`${nome.toLowerCase()}:`))
  assert.ok(linha, `${nome} ausente em public/_headers`)
  return linha.slice(linha.indexOf(':') + 1).trim()
}
const diretiva = (csp: string, nome: string): string | undefined =>
  csp.split(';').map((d) => d.trim()).find((d) => d === nome || d.startsWith(`${nome} `))

describe('CSP em vigor (inalterada)', () => {
  const csp = valor('Content-Security-Policy')
  test("continua com 'unsafe-inline' em style-src e style-src-elem", () => {
    assert.match(diretiva(csp, 'style-src') ?? '', /'unsafe-inline'/)
    assert.match(diretiva(csp, 'style-src-elem') ?? '', /'unsafe-inline'/)
  })
  test("script-src só 'self' + medição (Meta/GTM) e frame-ancestors 'none'", () => {
    assert.equal(diretiva(csp, 'script-src'), "script-src 'self' https://connect.facebook.net https://www.googletagmanager.com")
    assert.equal(diretiva(csp, 'frame-ancestors'), "frame-ancestors 'none'")
  })
})

describe('CSP Report-Only', () => {
  const ro = valor('Content-Security-Policy-Report-Only')
  test("style-src e style-src-elem SEM 'unsafe-inline'", () => {
    assert.doesNotMatch(diretiva(ro, 'style-src') ?? '', /unsafe-inline/)
    assert.doesNotMatch(diretiva(ro, 'style-src-elem') ?? '', /unsafe-inline/)
  })
  test("style-src-attr permite 'unsafe-inline' (atributos style do React)", () => {
    assert.equal(diretiva(ro, 'style-src-attr'), "style-src-attr 'unsafe-inline'")
  })
  test('mesmas demais diretivas da CSP em vigor (só o estilo difere)', () => {
    const resto = (csp: string) =>
      csp.split(';').map((d) => d.trim()).filter((d) => d && !/^style-src/.test(d)).sort()
    assert.deepEqual(resto(ro), resto(valor('Content-Security-Policy')))
  })
  test('sem endpoint de relatório por ora', () => {
    assert.doesNotMatch(ro, /report-(uri|to)/)
  })
})

describe('CSP e o cartão do cardápio', () => {
  // O token do cartão é gerado no navegador direto na API do Mercado Pago (src/lib/cartaoMercadoPago.ts).
  test('connect-src libera https://api.mercadopago.com nas duas políticas, sem mexer em script-src', () => {
    for (const nome of ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
      const csp = valor(nome)
      assert.ok((diretiva(csp, 'connect-src') ?? '').split(/\s+/).includes('https://api.mercadopago.com'), nome)
      assert.equal(diretiva(csp, 'script-src'), "script-src 'self' https://connect.facebook.net https://www.googletagmanager.com", nome)
    }
  })
})
