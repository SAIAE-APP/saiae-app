// O evento de pedido usa nome e telefone do perfil quando o pedido não trouxe os seus. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261017140000_evento_usa_telefone_do_perfil.sql', import.meta.url), 'utf8')

test('telefone e nome caem no perfil via cliente_id', () => {
  assert.match(sql, /v_tel := coalesce\(p\.cliente_telefone, p\.entrega_telefone, \(select c\.telefone from public\.clientes_finais c where c\.id = p\.cliente_id\)\)/)
  assert.match(sql, /select c\.nome from public\.clientes_finais c where c\.id = p\.cliente_id/)
})

test('mesma função, mesma assinatura, aditiva', () => {
  assert.match(sql, /create or replace function public\.montar_evento_saida\(p_evento_id uuid\)/i)
  assert.doesNotMatch(sql, /drop (table|function)|truncate|delete from/i)
})
