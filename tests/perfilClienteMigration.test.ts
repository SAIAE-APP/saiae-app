// A migration do perfil precisa fechar as tabelas sensíveis e ser aditiva. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261017100000_perfil_cliente_final.sql', import.meta.url), 'utf8')

test('tabelas de código e sessão: RLS ligada e nenhum acesso para anon/authenticated', () => {
  for (const t of ['cliente_codigos', 'cliente_sessoes']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated`))
    assert.doesNotMatch(sql, new RegExp(`create policy[^;]*on public\\.${t}`))
  }
})

test('só o hash é guardado', () => {
  assert.match(sql, /codigo_hash text not null/)
  assert.match(sql, /token_hash text not null/)
  assert.doesNotMatch(sql, /\bcodigo text\b/)
})

test('funções sensíveis só para o papel de serviço; config pública para anon', () => {
  for (const f of ['cliente_registrar_verificado', 'cliente_apagar_dados']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`))
  }
  assert.match(sql, /grant execute on function public\.perfil_cliente_config\(text\) to anon/)
})

test('aditiva: nada de drop table, delete de dados nem truncate', () => {
  assert.doesNotMatch(sql, /drop table|truncate|drop column/i)
})

test('um endereço padrão por cliente', () => {
  assert.match(sql, /create unique index[^;]*cliente_enderecos[^;]*where padrao/i)
})

test('flags nascem desligadas', () => {
  assert.match(sql, /perfil_cliente_obrigatorio boolean not null default false/)
})
