// Código de verificação, sessão e limites do perfil do cliente. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  MAX_TENTATIVAS,
  REENVIO_MIN_MS,
  VALIDADE_CODIGO_MS,
  VALIDADE_SESSAO_MS,
  avaliarCodigo,
  decidirLimites,
  gerarCodigo,
  gerarTokenSessao,
  hashSegredo,
  iguaisConstante,
  limparCodigo,
  sessaoValida,
} from '../supabase/functions/_shared/clienteCodigo.ts'

describe('gerarCodigo', () => {
  test('sempre 6 dígitos, inclusive com zeros à esquerda', () => {
    for (let i = 0; i < 2000; i++) assert.match(gerarCodigo(), /^\d{6}$/)
  })
  test('não repete sempre o mesmo valor', () => {
    const vistos = new Set(Array.from({ length: 200 }, gerarCodigo))
    assert.ok(vistos.size > 150)
  })
})

describe('limparCodigo', () => {
  test('aceita espaço, traço e ponto; recusa o que não é 6 dígitos', () => {
    assert.equal(limparCodigo('123 456'), '123456')
    assert.equal(limparCodigo('123-456'), '123456')
    for (const t of ['12345', '1234567', 'abcdef', '', null, undefined]) assert.equal(limparCodigo(t as string), null, String(t))
  })
})

describe('hashSegredo', () => {
  test('determinístico e dependente de pimenta, escopo e valor', async () => {
    const a = await hashSegredo('p', 'codigo', '123456')
    assert.equal(a, await hashSegredo('p', 'codigo', '123456'))
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.notEqual(a, await hashSegredo('outra', 'codigo', '123456'))
    assert.notEqual(a, await hashSegredo('p', 'sessao', '123456'))
    assert.notEqual(a, await hashSegredo('p', 'codigo', '123457'))
  })
})

describe('gerarTokenSessao', () => {
  test('43 caracteres url-safe e únicos', () => {
    const a = gerarTokenSessao()
    assert.match(a, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(a, gerarTokenSessao())
  })
})

describe('iguaisConstante', () => {
  test('compara igualdade e tamanho', () => {
    assert.equal(iguaisConstante('abc', 'abc'), true)
    assert.equal(iguaisConstante('abc', 'abd'), false)
    assert.equal(iguaisConstante('abc', 'abcd'), false)
  })
})

describe('avaliarCodigo', () => {
  const agora = Date.parse('2026-10-08T12:00:00Z')
  const base = { codigo_hash: 'h', usado_em: null, tentativas: 0, expira_em: new Date(agora + 60_000).toISOString() }
  test('ok', () => assert.equal(avaliarCodigo(base, 'h', agora), 'ok'))
  test('incorreto', () => assert.equal(avaliarCodigo(base, 'x', agora), 'incorreto'))
  test('expirado', () => assert.equal(avaliarCodigo({ ...base, expira_em: new Date(agora - 1).toISOString() }, 'h', agora), 'expirado'))
  test('usado vale uma vez só', () => assert.equal(avaliarCodigo({ ...base, usado_em: new Date(agora).toISOString() }, 'h', agora), 'usado'))
  test('excedido mesmo com o código certo', () => assert.equal(avaliarCodigo({ ...base, tentativas: MAX_TENTATIVAS }, 'h', agora), 'excedido'))
})

describe('decidirLimites', () => {
  const e = { pedidosTelefoneHora: 0, pedidosIpHora: 0, enviosLoja24h: 0, tetoLoja: 100, msDesdeUltimoEnvio: null as number | null }
  test('ok', () => assert.equal(decidirLimites(e), 'ok'))
  test('muito cedo', () => assert.equal(decidirLimites({ ...e, msDesdeUltimoEnvio: REENVIO_MIN_MS - 1 }), 'muito_cedo'))
  test('após 60 s libera', () => assert.equal(decidirLimites({ ...e, msDesdeUltimoEnvio: REENVIO_MIN_MS }), 'ok'))
  test('telefone: 3 por hora', () => assert.equal(decidirLimites({ ...e, pedidosTelefoneHora: 3 }), 'limite_telefone'))
  test('ip: 60 por hora por loja (feira: vários clientes no mesmo wifi)', () => {
    assert.equal(decidirLimites({ ...e, pedidosIpHora: 59 }), 'ok')
    assert.equal(decidirLimites({ ...e, pedidosIpHora: 60 }), 'limite_ip')
  })
  test('ip global: 200 por hora', () => {
    assert.equal(decidirLimites({ ...e, pedidosIpGlobalHora: 199 }), 'ok')
    assert.equal(decidirLimites({ ...e, pedidosIpGlobalHora: 200 }), 'limite_ip')
  })
  test('loja: teto diário', () => assert.equal(decidirLimites({ ...e, enviosLoja24h: 100 }), 'limite_loja'))
  test('teto zero desliga o envio', () => assert.equal(decidirLimites({ ...e, tetoLoja: 0 }), 'limite_loja'))
})

describe('sessaoValida', () => {
  const agora = Date.parse('2026-10-08T12:00:00Z')
  test('valida, expirada e revogada', () => {
    assert.equal(sessaoValida({ expira_em: new Date(agora + VALIDADE_SESSAO_MS).toISOString(), revogada_em: null }, agora), true)
    assert.equal(sessaoValida({ expira_em: new Date(agora - 1).toISOString(), revogada_em: null }, agora), false)
    assert.equal(sessaoValida({ expira_em: new Date(agora + 1000).toISOString(), revogada_em: new Date(agora).toISOString() }, agora), false)
  })
  test('validade do código é 5 min', () => assert.equal(VALIDADE_CODIGO_MS, 300_000))
})
