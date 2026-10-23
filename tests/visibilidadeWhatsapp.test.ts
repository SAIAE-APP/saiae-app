// Flag da aba "WhatsApp e Automação". Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mostrarWhatsappAutomacao } from '../src/lib/visibilidadeIaCrm.ts'

test('loja liberada e flag 1 mostram; outras não', () => {
  assert.equal(mostrarWhatsappAutomacao({ slug: 'qa-teste-varredura' }, undefined), true)
  assert.equal(mostrarWhatsappAutomacao({ slug: 'outra' }, '1'), true)
  assert.equal(mostrarWhatsappAutomacao({ slug: 'outra' }, undefined), false)
  assert.equal(mostrarWhatsappAutomacao({ slug: 'outra' }, 'true'), false)
  assert.equal(mostrarWhatsappAutomacao({}, ''), false)
})
