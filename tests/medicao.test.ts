// Medição (Pixel do Meta + GA4) só com consentimento 'granted'; CSP só abre os domínios da medição. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { lerConsentimento } from '../src/lib/consentimento.ts'
import { carregarMedicao, registrarCadastroCompleto, rotaComMedicao } from '../src/lib/medicao.ts'
import type { DocumentoMedicao, JanelaMedicao } from '../src/lib/medicao.ts'

const storageCom = (v: string | null) => ({ getItem: () => v })
function ambiente() {
  const scripts: string[] = []
  const doc: DocumentoMedicao = {
    createElement: () => ({ src: '', async: false }),
    head: { appendChild: (el) => void scripts.push((el as { src: string }).src) },
  }
  return { win: {} as JanelaMedicao, doc, scripts }
}

describe('consentimento', () => {
  test('só "granted" e "denied" valem; o resto é sem escolha', () => {
    assert.equal(lerConsentimento(storageCom('granted')), 'granted')
    assert.equal(lerConsentimento(storageCom('denied')), 'denied')
    for (const v of [null, '', 'true', 'GRANTED', 'yes']) assert.equal(lerConsentimento(storageCom(v)), null, String(v))
    assert.equal(lerConsentimento({ getItem: () => { throw new Error('x') } }), null)
  })
})

describe('carregarMedicao', () => {
  test('sem "granted" NADA carrega: nenhum script, nenhum fbq/gtag/dataLayer', () => {
    for (const v of [null, 'denied', 'qualquer']) {
      const a = ambiente()
      assert.equal(carregarMedicao(a.win, a.doc, storageCom(v)), false)
      assert.deepEqual(a.scripts, [])
      assert.deepEqual(Object.keys(a.win), [])
    }
  })
  test('com "granted" carrega GA4 e Pixel dos domínios certos, uma vez só', () => {
    const a = ambiente()
    assert.equal(carregarMedicao(a.win, a.doc, storageCom('granted')), true)
    assert.deepEqual(a.scripts, ['https://www.googletagmanager.com/gtag/js?id=G-R72CK0Q5DV', 'https://connect.facebook.net/en_US/fbevents.js'])
    carregarMedicao(a.win, a.doc, storageCom('granted'))
    assert.equal(a.scripts.length, 2)
    const fila = a.win.fbq as unknown as { queue: unknown[][] }
    assert.deepEqual(fila.queue.map((e) => e.slice(0, 2)), [['init', '442066388679102'], ['track', 'PageView']])
  })
})

describe('registrarCadastroCompleto', () => {
  test('sem consentimento ou sem medição carregada: não envia nada', () => {
    const a = ambiente()
    assert.equal(registrarCadastroCompleto(a.win, 'e1', storageCom('granted')), false) // não carregou
    carregarMedicao(a.win, a.doc, storageCom('granted'))
    const antes = (a.win.fbq as unknown as { queue: unknown[] }).queue.length
    assert.equal(registrarCadastroCompleto(a.win, 'e1', storageCom('denied')), false)
    assert.equal((a.win.fbq as unknown as { queue: unknown[] }).queue.length, antes)
  })
  test('com consentimento: CompleteRegistration (com eventID) e sign_up', () => {
    const a = ambiente()
    carregarMedicao(a.win, a.doc, storageCom('granted'))
    assert.equal(registrarCadastroCompleto(a.win, 'evt-1', storageCom('granted')), true)
    const fbq = (a.win.fbq as unknown as { queue: unknown[][] }).queue.at(-1)
    assert.deepEqual(fbq, ['track', 'CompleteRegistration', {}, { eventID: 'evt-1' }])
    const gtag = (a.win.dataLayer as unknown[][]).at(-1)
    assert.deepEqual(gtag, ['event', 'sign_up', { method: 'email' }])
  })
})

describe('onde a medição roda e o que o CSP libera', () => {
  test('só telas de entrada; cardápio público e operação nunca', () => {
    for (const r of ['/cadastro', '/login', '/assinar', '/onboarding']) assert.equal(rotaComMedicao(r), true, r)
    for (const r of ['/', '/loja/cardapio', '/loja/cozinha', '/loja/lancar', '/privacidade']) assert.equal(rotaComMedicao(r), false, r)
  })
  test('CSP (aplicada e Report-Only) libera só os domínios da medição, sem curinga novo', () => {
    const linhas = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('Content-Security-Policy'))
    assert.equal(linhas.length, 2)
    for (const l of linhas) {
      const dir = (nome: string) => l.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${nome} `)) ?? ''
      assert.equal(dir('script-src'), "script-src 'self' https://connect.facebook.net https://www.googletagmanager.com")
      assert.match(dir('connect-src'), /https:\/\/www\.google-analytics\.com/)
      assert.match(dir('connect-src'), /https:\/\/www\.facebook\.com/)
      assert.match(dir('img-src'), /https:\/\/www\.facebook\.com/)
      assert.doesNotMatch(l, /unsafe-eval|https:\/\/\*\.(facebook|google)|script-src[^;]*\*/)
      assert.match(l, /default-src 'self'/)
    }
  })
  test('o index.html não carrega mais gtag sozinho', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js|function gtag/)
  })
})
