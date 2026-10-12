// "Saiu para entrega", PR 3/4: o status novo não quebra Chamada, Dashboard, Caixa nem relatórios.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('status saiu_entrega nas outras telas', () => {
  test('a Chamada lista só Pronto: o pedido que saiu deixa a lista de senhas chamadas', () => {
    assert.match(ler('src/pages/TelaChamada.tsx'), /\.filter\(\(p\) => p\.status === 'pronto'\)/)
  })
  test('relatórios e caixa contam tudo que não foi cancelado (o pedido em Saiu entra no faturamento)', () => {
    assert.match(ler('src/lib/relatorio.ts'), /p\.status !== 'cancelado'/)
    assert.match(ler('src/components/SecaoCaixa.tsx'), /\.neq\('status', 'cancelado'\)/)
  })
  test('o Histórico tem rótulo para o status novo', () => {
    assert.match(ler('src/pages/Historico.tsx'), /if \(status === 'saiu_entrega'\) return ROTULO_SAIU/)
  })
  test('o link do entregador confirma a entrega de qualquer estado não cancelado, inclusive Saiu', () => {
    const sql = ler('supabase/migrations/20261006150000_link_entregador.sql')
    assert.match(sql, /if v_pedido\.status = 'cancelado' then/)
    assert.doesNotMatch(sql, /status in \('a_fazer', 'pronto'\)/)
  })
})
