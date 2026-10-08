// IA no WhatsApp, Task 1: guardas estáticas da migration (o comportamento está em tests/iaContexto.test.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261019100000_ia_atendente.sql', import.meta.url), 'utf8')

test('ia_contexto: só o papel de serviço executa; ninguém mais', () => {
  assert.match(sql, /revoke all on function public\.ia_contexto\(text, text\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.ia_contexto\(text, text\) to service_role/)
  assert.match(sql, /revoke all on function public\.ia_gerar_codigo\(\) from public, anon, authenticated/)
})

test('a IA nasce desligada e cliente só com telefone confirmado', () => {
  assert.match(sql, /ia_habilitada boolean not null default false/)
  assert.match(sql, /telefone_confirmado_em is not null/)
  assert.match(sql, /select \* into b from public\.barracas where ia_codigo = v_codigo and ia_habilitada/)
})

test('só leitura: a função não escreve em nada', () => {
  const corpo = sql.slice(sql.indexOf('create or replace function public.ia_contexto'))
  assert.ok(!/\b(insert into|update public|delete from)\b/i.test(corpo))
})

test('limites de formato das colunas novas', () => {
  assert.match(sql, /char_length\(ia_texto_livre\) <= 2000/)
  assert.match(sql, /ia_whatsapp_dono ~ '\^\[0-9\]\{10,13\}\$'/)
  assert.match(sql, /create unique index if not exists barracas_ia_codigo_unico/)
  assert.match(sql, /revoke all on public\.ia_limites_plano from anon, authenticated/)
})
