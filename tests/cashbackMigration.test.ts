// Cashback: confere as migrations M1 a M6 por texto (e as fórmulas no PGlite, na seção M3).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')

const m1 = ler('20261106100000_cashback_config.sql')

describe('M1 cashback_config', () => {
  test('cinco colunas novas com os defaults e os checks da spec', () => {
    assert.match(m1, /add column if not exists cashback_habilitado boolean not null default false/)
    assert.match(m1, /add column if not exists cashback_percentual_bp integer not null default 500/)
    assert.match(m1, /add column if not exists cashback_validade_dias integer not null default 60/)
    assert.match(m1, /add column if not exists cashback_teto_uso_pct integer not null default 50/)
    assert.match(m1, /add column if not exists cashback_termo_aceito_em timestamptz\s*;/)
    assert.match(m1, /check \(cashback_percentual_bp between 100 and 1500\)/)
    assert.match(m1, /check \(cashback_validade_dias between 30 and 90\)/)
    assert.match(m1, /check \(cashback_teto_uso_pct between 10 and 90\)/)
  })

  test('não liga sem o termo aceito', () => {
    assert.match(m1, /check \(not cashback_habilitado or cashback_termo_aceito_em is not null\)/)
  })

  test('constraints são recriadas com drop constraint if exists (reaplicável)', () => {
    const drops = m1.match(/drop constraint if exists barracas_cashback_/g) ?? []
    assert.equal(drops.length, 4)
  })

  test('cashback_config: security definer, search_path fixo, grant para anon, só os quatro campos', () => {
    assert.match(m1, /create or replace function public\.cashback_config\(p_slug text\)/)
    assert.match(m1, /returns table \(habilitado boolean, percentual_bp integer, teto_uso_pct integer, validade_dias integer\)/)
    assert.match(m1, /security definer\s+set search_path = public, pg_temp/)
    assert.match(m1, /grant execute on function public\.cashback_config\(text\) to anon, authenticated/)
    assert.doesNotMatch(m1, /cashback_termo_aceito_em\s+from/)
  })

  test('SUPOSIÇÃO-CASHBACK-2 e -3 anotadas nos defaults', () => {
    assert.match(m1, /SUPOSIÇÃO-CASHBACK-2/)
    assert.match(m1, /SUPOSIÇÃO-CASHBACK-3/)
  })
})
