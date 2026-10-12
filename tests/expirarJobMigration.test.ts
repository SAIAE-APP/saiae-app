// Migration do job de expiração: regras lidas do SQL (o job é SQL puro). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261024110000_expirar_job_sem_stripe.sql', import.meta.url), 'utf8')
const corpo = sql.replace(/\r\n/g, '\n').replace(/^--.*$/gm, '') // só o SQL, sem comentários

describe('expirar_assinaturas_job', () => {
  test('o rebaixamento active -> past_due exclui assinatura da Stripe', () => {
    const bloco = corpo.slice(corpo.indexOf("set status = 'past_due'"))
    assert.match(bloco, /status = 'active'\s+and stripe_subscription_id is null/)
  })
  test('as expirações por trial/carência/cancelamento continuam valendo para todos', () => {
    assert.match(corpo, /status = 'trialing' and trial_ends_at < now\(\)/)
    assert.match(corpo, /status = 'past_due' and grace_until < now\(\)/)
    assert.match(corpo, /status = 'canceled' and current_period_end < now\(\)/)
  })
  test('não é executável por public, anon nem authenticated', () => {
    assert.match(corpo, /revoke all on function public\.expirar_assinaturas_job\(\) from public, anon, authenticated;/)
    assert.doesNotMatch(corpo, /grant execute/i)
  })
  test('não mexe na chave de cobrança', () => {
    assert.doesNotMatch(corpo, /app_config/)
  })
})
