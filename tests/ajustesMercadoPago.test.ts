// Testes da lógica pura do estado do Mercado Pago em Ajustes. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dataDoCorte, estadoMercadoPago, retornoOauthMp } from '../src/lib/estadoMercadoPago.ts'

const corte = new Date('2026-12-01T03:00:00Z')
const antes = new Date('2026-11-20T12:00:00Z')
const depois = new Date('2026-12-02T12:00:00Z')

test('conectada vence qualquer token antigo, antes ou depois do corte', () => {
  for (const agora of [antes, depois]) {
    assert.equal(
      estadoMercadoPago({ conectada: true, tokenAntigoConfigurado: true, agora, corte }),
      'conectada',
    )
  }
})

test('token antigo antes do corte: aviso_corte', () => {
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: true, agora: antes, corte }),
    'aviso_corte',
  )
})

test('token antigo depois (ou exatamente no) corte: bloqueada', () => {
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: true, agora: depois, corte }),
    'bloqueada',
  )
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: true, agora: corte, corte }),
    'bloqueada',
  )
})

test('token antigo sem corte definido: aviso_corte (sem contagem), nunca bloqueia', () => {
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: true, agora: depois, corte: null }),
    'aviso_corte',
  )
})

test('sem token antigo: desconectada se já conectou, senão nao_configurada', () => {
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: false, jaConectou: true, agora: antes, corte }),
    'desconectada',
  )
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: false, agora: antes, corte }),
    'nao_configurada',
  )
})

test('já conectou antes e perdeu a conexão: desconectada, mesmo com token antigo', () => {
  assert.equal(
    estadoMercadoPago({ conectada: false, tokenAntigoConfigurado: true, jaConectou: true, agora: antes, corte }),
    'desconectada',
  )
})

test('dataDoCorte: DD/MM no fuso de Brasília; vazio ou inválido = null', () => {
  assert.equal(dataDoCorte('2026-12-01T03:00:00Z'), '01/12')
  assert.equal(dataDoCorte('2026-12-01'), '01/12')
  assert.equal(dataDoCorte(undefined), null)
  assert.equal(dataDoCorte(''), null)
  assert.equal(dataDoCorte('lixo'), null)
})

test('retornoOauthMp: só ok e erro valem', () => {
  assert.equal(retornoOauthMp('?mp=ok'), 'ok')
  assert.equal(retornoOauthMp('?x=1&mp=erro'), 'erro')
  assert.equal(retornoOauthMp('?mp=outro'), null)
  assert.equal(retornoOauthMp(''), null)
})
