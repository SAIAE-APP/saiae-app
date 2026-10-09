// Abrir WhatsApp (wa.me) a partir do app: no Android nativo navega o WebView (o Capacitor lança a intent); no navegador
// abre janela nova. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { abrirExterno, urlExternaPermitida } from '../src/lib/abrirExterno.ts'

function abridor(nativo: boolean) {
  const chamadas: string[] = []
  return {
    chamadas,
    a: {
      nativo,
      janelaNova: (u: string) => chamadas.push(`janela:${u}`),
      navegar: (u: string) => chamadas.push(`navegar:${u}`),
    },
  }
}
const URL_WA = 'https://wa.me/?text=' + encodeURIComponent('*Entrega - Pedido #7*\nhttps://app.saiae.com.br/e/abc')

describe('abrirExterno', () => {
  test('app nativo: navega o WebView (nunca window.open com noopener)', () => {
    const { chamadas, a } = abridor(true)
    assert.equal(abrirExterno(URL_WA, a), true)
    assert.deepEqual(chamadas, [`navegar:${URL_WA}`])
  })

  test('navegador: janela nova', () => {
    const { chamadas, a } = abridor(false)
    assert.equal(abrirExterno(URL_WA, a), true)
    assert.deepEqual(chamadas, [`janela:${URL_WA}`])
  })

  test('só http(s) sai do app', () => {
    for (const ruim of ['javascript:alert(1)', 'data:text/html,x', 'intent://x#Intent;end', 'whatsapp://send?text=oi', 'não é url', '']) {
      for (const nativo of [true, false]) {
        const { chamadas, a } = abridor(nativo)
        assert.equal(abrirExterno(ruim, a), false, ruim)
        assert.deepEqual(chamadas, [])
      }
    }
    assert.equal(urlExternaPermitida('https://wa.me/'), true)
    assert.equal(urlExternaPermitida('http://wa.me/'), true)
  })
})

test('os botões de WhatsApp do app do operador usam o abridor único (nenhum window.open direto)', () => {
  for (const f of ['components/BotoesLinkEntregador.tsx', 'components/BotaoAvisarCliente.tsx', 'pages/LancarPedido.tsx', 'pages/Assinatura.tsx']) {
    const s = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
    assert.match(s, /abrirLinkExterno\(/, f)
    assert.doesNotMatch(s, /window\.open\(/, f)
  }
})

test('o aviso "O WhatsApp não abriu" e o Copiar link continuam no botão do entregador', () => {
  const s = readFileSync(new URL('../src/components/BotoesLinkEntregador.tsx', import.meta.url), 'utf8')
  assert.match(s, /O WhatsApp não abriu/)
  assert.match(s, /if \(!document\.hidden\) setAviso\(true\)/)
  assert.match(s, /navigator\.clipboard\.writeText\(mensagemLinkEntregador/)
})
