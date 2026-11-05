// Módulos pagos no app: a lista vem do servidor e null (ainda sem resposta) vale como desligado. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deveMostrarFaixaCaiu, mostrarCaixaPromocoes, mostrarWhatsappAutomacao, temModulo } from '../src/lib/modulos.ts'

describe('módulos', () => {
  test('temModulo(null, …) é falso', () => {
    assert.equal(temModulo(null, 'fiscal'), false)
    assert.equal(temModulo([], 'whatsapp_bot'), false)
    assert.equal(temModulo(['fiscal'], 'fiscal'), true)
  })
  test('mostrarWhatsappAutomacao é verdadeiro com só o bot e falso com só fiscal', () => {
    assert.equal(mostrarWhatsappAutomacao(['whatsapp_bot']), true)
    assert.equal(mostrarWhatsappAutomacao(['whatsapp_avisos']), true)
    assert.equal(mostrarWhatsappAutomacao(['whatsapp_disparos']), true)
    assert.equal(mostrarWhatsappAutomacao(['fiscal']), false)
    assert.equal(mostrarWhatsappAutomacao(null), false)
  })
  test("faixa de queda só com whatsapp_status 'caiu' e algum módulo de WhatsApp", () => {
    assert.equal(deveMostrarFaixaCaiu({ whatsapp_status: 'caiu' }, ['whatsapp_avisos']), true)
    assert.equal(deveMostrarFaixaCaiu({ whatsapp_status: 'caiu' }, ['fiscal']), false)
    assert.equal(deveMostrarFaixaCaiu({ whatsapp_status: 'caiu' }, null), false)
    for (const s of ['conectado', 'desconectado', null, undefined] as const) {
      assert.equal(deveMostrarFaixaCaiu({ whatsapp_status: s }, ['whatsapp_bot']), false, String(s))
    }
  })
  test('a caixa de promoções só aparece com whatsapp_disparos', () => {
    assert.equal(mostrarCaixaPromocoes(['whatsapp_disparos']), true)
    assert.equal(mostrarCaixaPromocoes(['whatsapp_avisos', 'whatsapp_bot']), false)
    assert.equal(mostrarCaixaPromocoes(null), false)
  })
})
