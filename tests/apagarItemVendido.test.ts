// Apagar item mesmo já vendido (2026-10-10): o pedido guarda nome/preço e o banco solta a ligação (SET NULL).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('apagar item já vendido', () => {
  const sql = ler('supabase/migrations/20261022100000_apagar_item_vendido.sql')
  test('a migration troca a ligação para ON DELETE SET NULL e valida sem travar a tabela', () => {
    assert.match(sql, /drop constraint if exists itens_do_pedido_item_id_fkey/)
    assert.match(sql, /foreign key \(item_id\) references public\.itens\(id\) on delete set null not valid/)
    assert.match(sql, /validate constraint itens_do_pedido_item_id_fkey/)
  })
  test('a migration não apaga dados nem mexe em pedidos', () => {
    assert.doesNotMatch(sql, /\bdelete from\b|\btruncate\b|\bdrop table\b|\bupdate public\./i)
  })
  test('a tela avisa que o histórico dos pedidos antigos continua', () => {
    const a = ler('src/pages/Ajustes.tsx')
    assert.match(a, /Os pedidos antigos continuam no histórico e nos relatórios/)
  })
  test('banco antigo (DELETE recusado) ainda cai para desativar o item', () => {
    const a = ler('src/pages/Ajustes.tsx')
    assert.match(a, /update\(\{ ativo: false \}\)/)
  })
})
