// A consulta pública do perfil só responde para lojas com a flag ligada. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261017130000_perfil_config_por_loja.sql', import.meta.url), 'utf8')

test('só devolve linha quando a flag da loja está ligada', () => {
  assert.match(sql, /where b\.slug = p_slug and b\.perfil_cliente_obrigatorio/)
})

test('mesma assinatura, aditiva e liberada para anon', () => {
  assert.match(sql, /create or replace function public\.perfil_cliente_config\(p_slug text\)/)
  assert.match(sql, /grant execute on function public\.perfil_cliente_config\(text\) to anon, authenticated/)
  assert.doesNotMatch(sql, /drop (table|function)|truncate|delete from/i)
})
