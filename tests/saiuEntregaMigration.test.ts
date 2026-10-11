// "Saiu para entrega", PR 1/4: migration aditiva, interruptor desligado e evento no contrato.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = ler('supabase/migrations/20261022120000_saiu_para_entrega.sql')

describe('migration saiu_para_entrega', () => {
  test('colunas aditivas e interruptor nasce desligado', () => {
    assert.match(sql, /add column if not exists saiu_entrega_em timestamptz/)
    assert.match(sql, /add column if not exists saiu_entrega_habilitado boolean not null default false/)
  })
  test('o tipo novo entra no CHECK do outbox sem tirar os antigos', () => {
    for (const t of ['order.created', 'order.paid', 'order.status_changed', 'order.ready', 'order.cancelled', 'order.out_for_delivery']) {
      assert.ok(sql.includes(`'${t}'`), t)
    }
  })
  test('o gatilho de status emite order.out_for_delivery e mantém ready/cancelled', () => {
    assert.match(sql, /new\.status = 'saiu_entrega' then\s+perform public\._emitir_evento_saida\(new\.id, 'order\.out_for_delivery'/)
    assert.match(sql, /'order\.ready'/)
    assert.match(sql, /'order\.cancelled'/)
  })
  test('não apaga dados', () => {
    assert.doesNotMatch(sql, /\bdelete from\b|\btruncate\b|\bdrop table\b|\bdrop column\b(?! if exists)/i)
  })
})

describe('contrato SAI-001', () => {
  test('o schema e o INTEGRACAO.md listam order.out_for_delivery', () => {
    const schema = JSON.parse(ler('docs/contrato/v1/evento.schema.json')) as { properties: { type: { enum: string[] } } }
    assert.ok(schema.properties.type.enum.includes('order.out_for_delivery'))
    assert.match(ler('INTEGRACAO.md'), /`order\.out_for_delivery`/)
  })
})
