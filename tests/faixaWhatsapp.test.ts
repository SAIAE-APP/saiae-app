// Faixa de aviso quando o WhatsApp da loja cai. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deveMostrarFaixaCaiu } from '../src/lib/visibilidadeIaCrm.ts'

const loja = { slug: 'qa-teste-varredura' }

test('só "caiu" em loja liberada mostra a faixa', () => {
  assert.equal(deveMostrarFaixaCaiu({ ...loja, whatsapp_status: 'caiu' }, undefined), true)
  assert.equal(deveMostrarFaixaCaiu({ slug: 'outra', whatsapp_status: 'caiu' }, '1'), true)
  for (const s of ['conectado', 'desconectado', null, undefined] as const) {
    assert.equal(deveMostrarFaixaCaiu({ ...loja, whatsapp_status: s }, undefined), false, String(s))
  }
  assert.equal(deveMostrarFaixaCaiu({ slug: 'outra', whatsapp_status: 'caiu' }, undefined), false)
})
