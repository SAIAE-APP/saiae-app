import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PIX_EXPIRACAO_OPCOES_MINUTOS, minutosExpiracaoPix } from '../src/lib/pixExpiracao.ts'
import { minutosExpiracaoPix as minutosFuncao } from '../supabase/functions/_shared/pagamento/expiracao.ts'

test('padrão quando ausente ou inválido', () => {
  for (const v of [undefined, null, 'abc', NaN]) assert.equal(minutosExpiracaoPix(v), 35)
})

test('respeita valores válidos e limita à faixa 35..60', () => {
  assert.equal(minutosExpiracaoPix(35), 35)
  assert.equal(minutosExpiracaoPix(45), 45)
  assert.equal(minutosExpiracaoPix(60), 60)
  assert.equal(minutosExpiracaoPix(5), 35)
  assert.equal(minutosExpiracaoPix(30), 35)
  assert.equal(minutosExpiracaoPix(1440), 60)
  assert.equal(minutosExpiracaoPix('50'), 50)
  assert.equal(minutosExpiracaoPix(44.9), 44)
})

test('front e edge function têm a mesma regra', () => {
  for (const v of [undefined, 0, 5, 35, 40, 59.9, 60, 61, 9999, '45', 'x']) {
    assert.equal(minutosExpiracaoPix(v), minutosFuncao(v))
  }
})

test('opções oferecidas estão dentro da faixa', () => {
  for (const m of PIX_EXPIRACAO_OPCOES_MINUTOS) assert.equal(minutosExpiracaoPix(m), m)
})
