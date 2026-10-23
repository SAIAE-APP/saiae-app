// Estado da tela de conexão do WhatsApp a partir da resposta do proxy. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mascararNumero, telaDaConexao, type RespostaConexao } from '../src/lib/estadoWhatsapp.ts'

const r = (estado: RespostaConexao['estado'], extra: Partial<RespostaConexao> = {}): RespostaConexao => ({
  estado,
  qr: null,
  numero: null,
  avisos: [],
  ...extra,
})

describe('telaDaConexao', () => {
  test('null sem erro é carregando; erro vence', () => {
    assert.equal(telaDaConexao(null, false).tipo, 'carregando')
    assert.equal(telaDaConexao(null, true).tipo, 'erro')
    assert.equal(telaDaConexao(r('conectado'), true).tipo, 'erro')
  })
  test('sem_sessao e desconectado', () => {
    assert.equal(telaDaConexao(r('sem_sessao'), false).tipo, 'sem_sessao')
    assert.equal(telaDaConexao(r('desconectado'), false).tipo, 'desconectado')
  })
  test('qr só aparece em aguardando_qr', () => {
    assert.deepEqual(telaDaConexao(r('aguardando_qr', { qr: 'abc' }), false), { tipo: 'qr', qr: 'abc' })
    assert.equal(telaDaConexao(r('aguardando_qr'), false).tipo, 'sem_sessao')
    for (const e of ['conectado', 'desconectado', 'sem_sessao'] as const) {
      assert.equal(telaDaConexao(r(e, { qr: 'abc' }), false).qr, undefined)
    }
  })
  test('conectado traz o número mascarado', () => {
    const t = telaDaConexao(r('conectado', { numero: '5561999990001' }), false)
    assert.equal(t.tipo, 'conectado')
    assert.equal(t.numeroMascarado, '(61) 9••••-0001')
  })
})

describe('mascararNumero', () => {
  test('celular com 55', () => assert.equal(mascararNumero('5561999990001'), '(61) 9••••-0001'))
  test('nunca devolve o número completo', () => {
    for (const n of ['5561999990001', '61999990001', '1234', '']) {
      const m = mascararNumero(n)
      assert.ok(n.length < 5 || !m.includes(n.slice(2, 9)), n)
    }
  })
})
