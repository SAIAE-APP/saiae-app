// A migration dos cupons precisa fechar as tabelas sensíveis, ser aditiva e nascer desligada. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../supabase/migrations/20261018100000_cupons.sql', import.meta.url), 'utf8')

test('RLS ligada nas três tabelas novas', () => {
  for (const t of ['cupons', 'cupom_usos', 'cupom_tentativas_log']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t)
  }
})

test('usos e log de tentativas: fechados para anon e authenticated, sem policy', () => {
  for (const t of ['cupom_usos', 'cupom_tentativas_log']) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from anon, authenticated`), t)
    assert.doesNotMatch(sql, new RegExp(`create policy[^;]*on public\\.${t}`), t)
  }
})

test('cupons: dono lê, cria e edita (com WITH CHECK); sem delete direto', () => {
  assert.match(sql, /create policy cupons_dono_select on public\.cupons for select/)
  assert.match(sql, /create policy cupons_dono_insert on public\.cupons for insert[\s\S]*?with check \(public\.usuario_tem_acesso_barraca/)
  assert.match(sql, /create policy cupons_dono_update on public\.cupons for update[\s\S]*?with check \(public\.usuario_tem_acesso_barraca/)
  assert.doesNotMatch(sql, /for delete/)
})

test('código único por loja, formato, tipo, valor e janela validados', () => {
  assert.match(sql, /unique \(barraca_id, codigo\)/)
  assert.match(sql, /codigo ~ '\^\[A-Z0-9_-\]\{3,20\}\$'/)
  assert.match(sql, /tipo in \('percentual', 'fixo'\)/)
  assert.match(sql, /tipo <> 'percentual' or valor <= 100/)
  assert.match(sql, /fim_em > inicio_em/)
})

test('uma reserva por cobrança e uso não some com o cupom', () => {
  assert.match(sql, /create unique index[^;]*cupom_usos_pendente_uq[^;]*where pagamento_pendente_id is not null/)
  assert.match(sql, /cupom_id uuid not null references public\.cupons\(id\) on delete restrict/)
})

test('flag nasce desligada e cupom_config é a única pública', () => {
  assert.match(sql, /cupons_habilitado boolean not null default false/)
  assert.match(sql, /grant execute on function public\.cupom_config\(text\) to anon, authenticated/)
  assert.equal((sql.match(/grant execute on function/g) ?? []).length, 1)
})

test('aditiva: nada de drop table, truncate, drop column nem delete de dados', () => {
  assert.doesNotMatch(sql, /drop table|truncate|drop column|delete from/i)
})

test('pedido guarda cópia do código e do desconto', () => {
  assert.match(sql, /add column if not exists cupom_codigo text/)
  assert.match(sql, /add column if not exists desconto_cupom_centavos integer not null default 0/)
})
