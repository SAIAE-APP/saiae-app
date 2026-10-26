// Pagamento marketplace (taxa da plataforma, OAuth do Mercado Pago): confere a migration por texto.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const sql = readFileSync(
  new URL('../supabase/migrations/20261104100000_pagamento_marketplace.sql', import.meta.url),
  'utf8',
)

describe('migration pagamento marketplace', () => {
  test('taxa_plataforma_centavos em pagamentos_pendentes e pedidos: not null default 0 e check >= 0', () => {
    for (const tabela of ['pagamentos_pendentes', 'pedidos']) {
      const re = new RegExp(
        `alter table public\\.${tabela}[\\s\\S]*?add column if not exists taxa_plataforma_centavos integer not null default 0[\\s\\S]*?check \\(taxa_plataforma_centavos >= 0\\)`,
      )
      assert.match(sql, re, tabela)
    }
  })

  test('pagamentos_pendentes.estornado_em timestamptz anulável', () => {
    assert.match(sql, /add column if not exists estornado_em timestamptz\s*;/)
  })

  test('barracas_mp_oauth e mp_oauth_estados: RLS ligada e nenhuma policy', () => {
    for (const tabela of ['barracas_mp_oauth', 'mp_oauth_estados']) {
      assert.match(sql, new RegExp(`create table if not exists public\\.${tabela}\\b`), tabela)
      assert.match(sql, new RegExp(`alter table public\\.${tabela} enable row level security`), tabela)
    }
    assert.doesNotMatch(sql, /create policy/i)
  })

  test('barracas_mp_oauth: status só conectada/desconectada e tokens cifrados', () => {
    assert.match(sql, /status text[^,]*check \(status in \('conectada', 'desconectada'\)\)/)
    assert.match(sql, /access_token_cifrado text/)
    assert.match(sql, /refresh_token_cifrado text/)
    assert.match(sql, /public_key text/)
  })

  test('mp_oauth_status é security definer, confere acesso e dá erro genérico', () => {
    const fn = sql.slice(sql.indexOf('function public.mp_oauth_status'))
    assert.match(fn, /returns table\s*\(\s*conectada boolean,\s*atualizado_em timestamptz\s*\)/)
    assert.match(fn, /security definer/)
    assert.match(fn, /set search_path/)
    assert.match(fn, /usuario_tem_acesso_barraca\(p_barraca_id\)/)
    assert.equal((fn.match(/raise exception/g) ?? []).length, 1, 'um único erro, sempre o mesmo texto')
    assert.match(fn, /grant execute on function public\.mp_oauth_status\(uuid\) to authenticated/)
  })

  test('pagamentos_pendentes.meio_pagamento: not null default pix, só pix/cartao', () => {
    assert.match(sql, /add column if not exists meio_pagamento text not null default 'pix'/)
    assert.match(sql, /drop constraint if exists pagamentos_pendentes_meio_pagamento_valido/)
    assert.match(sql, /add constraint pagamentos_pendentes_meio_pagamento_valido\s+check \(meio_pagamento in \('pix', 'cartao'\)\)/)
  })

  test('aditiva: não mexe em criar_pedido nem em usuario_tem_acesso_barraca', () => {    assert.doesNotMatch(sql, /(create|drop)( or replace)? function public\.(criar_pedido|usuario_tem_acesso_barraca)/)
  })
})
