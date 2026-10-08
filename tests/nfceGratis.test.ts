// NFC-e de pedido grátis (cupom de 100%): total R$ 0,00 não emite nota. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { MENSAGEM_PEDIDO_GRATIS, totalDaNotaCentavos } from '../supabase/functions/_shared/descontoNfce.ts'

describe('totalDaNotaCentavos', () => {
  test('itens − desconto, nunca negativo', () => {
    assert.equal(totalDaNotaCentavos([1000, 500], 0), 1500)
    assert.equal(totalDaNotaCentavos([1000, 500], 300), 1200)
    assert.equal(totalDaNotaCentavos([1000, 500], 1500), 0)
    assert.equal(totalDaNotaCentavos([1000], 9999), 0)
    assert.equal(totalDaNotaCentavos([1000], -5), 1000)
    assert.equal(totalDaNotaCentavos([], 0), 0)
  })
})

test('emitir-nfce recusa total zero ANTES de qualquer chamada à FocusNFe', () => {
  const f = readFileSync(new URL('../supabase/functions/emitir-nfce/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const guarda = f.indexOf('MENSAGEM_PEDIDO_GRATIS, codigo')
  assert.ok(guarda > 0)
  assert.match(f, /=== 0\) \{\n    return jsonResponse\(\{ erro: MENSAGEM_PEDIDO_GRATIS/)
  assert.ok(guarda < f.indexOf('fetch('), 'a guarda vem antes do primeiro fetch')
  assert.ok(guarda < f.indexOf('FORMA_PAGAMENTO_POR_METODO[pedido'), 'e antes da forma de pagamento')
  assert.match(MENSAGEM_PEDIDO_GRATIS, /R\$ 0,00/)
})
