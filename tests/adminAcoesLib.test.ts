// Funções puras das ações do superadmin no card da barraca.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nomeConfere, textoEfeitoAcao, type AdminBarraca } from '../src/lib/adminBarracas.ts'

const barraca = { nome: 'Barraca do Zé', origem_cobranca: null, plano: 'pro' } as AdminBarraca

describe('ações do admin', () => {
  test('nomeConfere exige igualdade exata e ignora espaços nas pontas', () => {
    assert.equal(nomeConfere('  Barraca do Zé ', 'Barraca do Zé'), true)
    assert.equal(nomeConfere('barraca do zé', 'Barraca do Zé'), false)
    assert.equal(nomeConfere('Barraca do', 'Barraca do Zé'), false)
    assert.equal(nomeConfere('', ''), false)
  })

  test('textoEfeitoAcao de bloquear cita que dono e funcionários perdem o acesso', () => {
    const t = textoEfeitoAcao('bloquear', barraca)
    assert.match(t, /dono e funcionários perdem o acesso/)
  })

  test('textoEfeitoAcao de plano avisa quando a conta tem Stripe ativo', () => {
    assert.match(textoEfeitoAcao('plano', { ...barraca, origem_cobranca: 'stripe' }), /Stripe/)
    assert.doesNotMatch(textoEfeitoAcao('plano', barraca), /Stripe/)
  })
})

describe('textoEfeitoAcao de bloquear e o Stripe', () => {
  test('só cita a cobrança do Stripe quando a conta paga por Stripe', () => {
    assert.match(textoEfeitoAcao('bloquear', { ...barraca, origem_cobranca: 'stripe' }), /Stripe não é cancelada/)
    assert.doesNotMatch(textoEfeitoAcao('bloquear', barraca), /Stripe/)
  })
})
