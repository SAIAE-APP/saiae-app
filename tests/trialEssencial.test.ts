// Os 30 dias grátis liberam o plano Essencial (2026-10-11).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261022130000_trial_plano_essencial.sql', import.meta.url), 'utf8')

describe('trial grátis = plano Essencial', () => {
  test('o trial novo nasce Essencial, com 30 dias', () => {
    assert.match(sql, /'trialing', 'essencial', now\(\) \+ interval '30 days'/)
    assert.doesNotMatch(sql, /'trialing', 'pro'/)
  })
  test('continua 1 trial por e-mail e não mexe em quem já tem assinatura', () => {
    assert.match(sql, /contas_trial_usadas/)
    assert.match(sql, /on conflict \(usuario_id\) do nothing/)
    assert.doesNotMatch(sql, /\bupdate public\.assinaturas\b/i)
  })
})
