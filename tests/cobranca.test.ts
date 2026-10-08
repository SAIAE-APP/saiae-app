// Cobrança desligável (app_config.cobranca_ativa): nada de trial/banner/bloqueio com a chave false. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acessoBloqueadoPorAssinatura, cobrancaAtiva, mostraBannerDeTrial } from '../src/lib/cobranca.ts'

const trialDoDono = { status: 'trialing', eh_dono: true, tem_acesso: true } as const
const venceu = { status: 'expired', eh_dono: true, tem_acesso: false } as const

test('cobrancaAtiva: só false explícito desliga', () => {
  assert.equal(cobrancaAtiva({ cobranca_ativa: false }), false)
  assert.equal(cobrancaAtiva({ cobranca_ativa: true }), true)
  // servidor ou cache antigo (sem o campo) = comportamento de sempre
  assert.equal(cobrancaAtiva({}), true)
  assert.equal(cobrancaAtiva(null), true)
  assert.equal(cobrancaAtiva(undefined), true)
})

test('acessoBloqueadoPorAssinatura: cobrança desligada nunca bloqueia, mesmo com cache de acesso caído', () => {
  assert.equal(acessoBloqueadoPorAssinatura({ ...venceu, cobranca_ativa: false }, false), false)
  assert.equal(acessoBloqueadoPorAssinatura({ ...venceu, cobranca_ativa: true }, false), true)
  assert.equal(acessoBloqueadoPorAssinatura({ ...venceu }, false), true) // cache sem o campo
})

test('acessoBloqueadoPorAssinatura: fail-open sem assinatura carregada e na tela de planos', () => {
  assert.equal(acessoBloqueadoPorAssinatura(null, false), false)
  assert.equal(acessoBloqueadoPorAssinatura({ ...venceu, cobranca_ativa: true }, true), false)
  assert.equal(acessoBloqueadoPorAssinatura({ ...trialDoDono, cobranca_ativa: true }, false), false)
})

test('mostraBannerDeTrial: some com a cobrança desligada, mesmo em trial no cache', () => {
  assert.equal(mostraBannerDeTrial({ ...trialDoDono, cobranca_ativa: false }, false), false)
  assert.equal(mostraBannerDeTrial({ ...trialDoDono, cobranca_ativa: true }, false), true)
  assert.equal(mostraBannerDeTrial({ ...trialDoDono }, false), true) // cache sem o campo
})

test('mostraBannerDeTrial: só dono, só trialing, fora das telas sem banner', () => {
  assert.equal(mostraBannerDeTrial({ ...trialDoDono, eh_dono: false, cobranca_ativa: true }, false), false)
  assert.equal(mostraBannerDeTrial({ ...venceu, cobranca_ativa: true }, false), false)
  assert.equal(mostraBannerDeTrial({ ...trialDoDono, cobranca_ativa: true }, true), false)
  assert.equal(mostraBannerDeTrial(null, false), false)
})
