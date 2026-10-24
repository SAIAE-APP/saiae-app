// Aba "WhatsApp e Automação" escondida em todas as barracas, menos a de teste: regra de visibilidade.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SLUGS_COM_IA_E_CRM, mostrarWhatsappAutomacao } from '../src/lib/visibilidadeIaCrm.ts'

describe('aba WhatsApp e Automação', () => {
  test('barraca comum fica escondida', () => {
    assert.equal(mostrarWhatsappAutomacao({ slug: 'sabor-kawashima' }, undefined), false)
    assert.equal(mostrarWhatsappAutomacao({ slug: 'outra-loja' }, '0'), false)
    assert.equal(mostrarWhatsappAutomacao({}, undefined), false)
  })
  test('as barracas liberadas e a variável de staging liberam', () => {
    assert.deepEqual([...SLUGS_COM_IA_E_CRM], ['qa-teste-varredura', 'dhelenarestaurante'])
    assert.equal(mostrarWhatsappAutomacao({ slug: 'qa-teste-varredura' }, undefined), true)
    assert.equal(mostrarWhatsappAutomacao({ slug: 'dhelenarestaurante' }, undefined), true)
    assert.equal(mostrarWhatsappAutomacao({ slug: 'qualquer' }, '1'), true)
  })
})
