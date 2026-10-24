// Fiscal gerenciado: o dono não cadastra token nem liga interruptor; vale o módulo. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { fiscalProntoParaEmitir, mensagemErroEmissao, podeMostrarBotaoNota } from '../src/lib/fiscal.ts'

describe('fiscalProntoParaEmitir', () => {
  test('sem módulo → sem_modulo', () => {
    assert.equal(fiscalProntoParaEmitir([], true), 'sem_modulo')
    assert.equal(fiscalProntoParaEmitir(['whatsapp_bot'], true), 'sem_modulo')
  })
  test('com módulo e sem token → sem_token', () => {
    assert.equal(fiscalProntoParaEmitir(['fiscal'], false), 'sem_token')
  })
  test('com módulo e com token → ok', () => {
    assert.equal(fiscalProntoParaEmitir(['fiscal'], true), 'ok')
  })
  test('modulos null → sem_modulo', () => {
    assert.equal(fiscalProntoParaEmitir(null, true), 'sem_modulo')
  })
})

describe('mensagemErroEmissao', () => {
  test('modulo_desligado vira texto amigável sem termo técnico', () => {
    assert.equal(mensagemErroEmissao('modulo_desligado'), 'Nota fiscal indisponível no momento. O pedido está salvo.')
  })
  test('outro erro passa como veio; vazio vira mensagem padrão', () => {
    assert.equal(mensagemErroEmissao('CNPJ não cadastrado'), 'CNPJ não cadastrado')
    assert.equal(mensagemErroEmissao(undefined), 'Não foi possível emitir. Tente novamente.')
  })
})

describe('mensagemErroEmissao: texto neutro', () => {
  test('mensagem com nome do provedor vira texto neutro', () => {
    assert.equal(mensagemErroEmissao('Erro na FocusNFe: timeout'), 'Não foi possível emitir a nota agora. Tente de novo em instantes.')
  })
  test('token não configurado vira orientação ao suporte', () => {
    assert.equal(mensagemErroEmissao('Token de produção não configurado'), 'Emissão ainda não configurada para a sua loja. Fale com o suporte.')
  })
})

describe('podeMostrarBotaoNota', () => {
  test('módulo desligado + autorizada → mostra', () => assert.equal(podeMostrarBotaoNota({ temModulo: false, autorizada: true, cancelado: false }), true))
  test('módulo desligado + não autorizada → esconde', () => assert.equal(podeMostrarBotaoNota({ temModulo: false, autorizada: false, cancelado: false }), false))
  test('módulo ligado → mostra', () => assert.equal(podeMostrarBotaoNota({ temModulo: true, autorizada: false, cancelado: false }), true))
  test('cancelado → esconde', () => assert.equal(podeMostrarBotaoNota({ temModulo: true, autorizada: true, cancelado: true }), false))
})
