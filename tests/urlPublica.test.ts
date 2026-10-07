// Garante que links públicos nunca saem com localhost no app nativo. Rodar: npm test
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Capacitor } from '@capacitor/core'
import { linkDoEntregador, mensagemLinkEntregador } from '../src/lib/linkEntregador.ts'
import { urlPublica } from '../src/lib/urlPublica.ts'

const original = Capacitor.isNativePlatform.bind(Capacitor)
const globais = globalThis as unknown as { window?: unknown }

function simular(nativo: boolean, origin: string) {
  Capacitor.isNativePlatform = () => nativo
  globais.window = { location: { origin } }
}

afterEach(() => {
  Capacitor.isNativePlatform = original
  delete globais.window
})

test('nativo: nunca devolve localhost', () => {
  simular(true, 'https://localhost')
  const token = 'a'.repeat(64)
  for (const url of [urlPublica('/x/cardapio'), linkDoEntregador(token), mensagemLinkEntregador(7, token)]) {
    assert.ok(!url.includes('localhost'), url)
  }
  assert.equal(linkDoEntregador(token), `https://app.saiae.com.br/e/${token}`)
})

test('web: continua usando a origem atual', () => {
  simular(false, 'https://preview.saiae.pages.dev')
  assert.equal(linkDoEntregador('abc'), 'https://preview.saiae.pages.dev/e/abc')
  assert.equal(urlPublica('/s/cardapio'), 'https://preview.saiae.pages.dev/s/cardapio')
})
