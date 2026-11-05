import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpretarCashback, decidirCashbackConfig, corpoCashback } from '../src/lib/cashbackApi.ts'

const valido = {
  habilitado: true,
  saldo_centavos: 1000,
  disponivel_centavos: 800,
  vence_em: '2026-12-01T00:00:00Z',
  percentual_bp: 500,
  teto_uso_pct: 50,
  lancamentos: [
    { tipo: 'credito', valor_centavos: 200, criado_em: '2026-10-01T00:00:00Z' },
    { tipo: 'resgate', valor_centavos: -100, criado_em: '2026-10-02T00:00:00Z' },
  ],
}

test('interpretarCashback aceita o formato válido e converte os nomes', () => {
  const r = interpretarCashback(valido)
  assert.equal(r?.saldoCentavos, 1000)
  assert.equal(r?.disponivelCentavos, 800)
  assert.equal(r?.venceEm, '2026-12-01T00:00:00Z')
  assert.deepEqual(r?.lancamentos[1], { tipo: 'resgate', valorCentavos: -100, criadoEm: '2026-10-02T00:00:00Z' })
})

test('interpretarCashback rejeita saldo negativo, string e fora de forma', () => {
  assert.equal(interpretarCashback({ ...valido, saldo_centavos: -5 }), null)
  assert.equal(interpretarCashback({ ...valido, saldo_centavos: '1000' }), null)
  assert.equal(interpretarCashback({ ...valido, disponivel_centavos: 1.5 }), null)
  assert.equal(interpretarCashback({ ...valido, lancamentos: [{ tipo: 'credito' }] }), null)
  assert.equal(interpretarCashback(null), null)
  assert.equal(interpretarCashback('x'), null)
})

test('decidirCashbackConfig: erro, ausente ou fora de forma = desligado', () => {
  assert.equal(decidirCashbackConfig({ data: null, error: { message: 'x' } }).habilitado, false)
  assert.equal(decidirCashbackConfig({ data: [], error: null }).habilitado, false)
  assert.equal(decidirCashbackConfig({ data: [{ habilitado: 'true' }], error: null }).habilitado, false)
  assert.equal(decidirCashbackConfig({ data: [{ habilitado: true, percentual_bp: -1, teto_uso_pct: 50, validade_dias: 60 }], error: null }).habilitado, false)
  assert.deepEqual(
    decidirCashbackConfig({ data: [{ habilitado: true, percentual_bp: 500, teto_uso_pct: 50, validade_dias: 60 }], error: null }),
    { habilitado: true, percentualBp: 500, tetoUsoPct: 50, validadeDias: 60 },
  )
})

test('corpoCashback(false) não manda nada; true manda usar_cashback', () => {
  assert.deepEqual(corpoCashback(false), {})
  assert.deepEqual(corpoCashback(true), { usar_cashback: true })
})

test("case 'cashback' usa o clienteId da sessão e nunca lê cliente_id do corpo", () => {
  const src = readFileSync(new URL('../supabase/functions/cliente-sessao/index.ts', import.meta.url), 'utf8')
  const i = src.indexOf("case 'cashback'")
  assert.ok(i > 0)
  const fim = src.indexOf("case 'pedir_de_novo'", i)
  const bloco = src.slice(i, fim > i ? fim : i + 2500)
  assert.match(bloco, /clienteId/)
  assert.doesNotMatch(bloco, /d\.cliente_id/)
  assert.match(bloco, /cashback_saldo/)
})
