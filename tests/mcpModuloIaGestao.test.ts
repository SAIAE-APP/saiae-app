// Gestão por IA: trava do módulo `ia_gestao` em mcp_token_validar (migration 20261128110000), rodando no PGlite.
// Só a função de validação é carregada; o resto da migration depende das tabelas de módulos reais. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const DONO = 'd0000000-0000-4000-8000-000000000001'
const BARRACA = 'b1000000-0000-4000-8000-000000000001'
let db: PGlite

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create schema extensions;
    create table public.barracas (id uuid primary key, nome text);
    create table public.usuarios_barracas (barraca_id uuid, usuario_id uuid, papel text);
    create table public.modulos_barraca (barraca_id uuid, modulo text, vigente boolean);
    create function public.modulo_ativo(b uuid, m text) returns boolean language sql stable as
      $$ select coalesce((select vigente from public.modulos_barraca where barraca_id = b and modulo = m), false) $$;
    insert into auth.users values ('${DONO}');
    insert into public.barracas values ('${BARRACA}', 'K');
    insert into public.usuarios_barracas values ('${BARRACA}', '${DONO}', 'dono');
  `)
  await db.exec(sql('20261127100000_mcp_gestao.sql'))
  const m = sql('20261128110000_mcp_modulo_ia_gestao.sql')
  await db.exec(m.slice(m.indexOf('create or replace function public.mcp_token_validar')))
  await db.exec(`insert into public.mcp_tokens (barraca_id, nome, token_hash, prefixo, criado_por)
    values ('${BARRACA}', 'ChatGPT', 'h1', 'sae_aaaa', '${DONO}')`)
})
after(async () => {
  await db.close()
})

const validar = async (hash: string) => {
  await db.exec('set role service_role')
  try {
    return (await db.query<{ r: Record<string, unknown> | null }>(`select public.mcp_token_validar('${hash}') as r`)).rows[0].r
  } finally {
    await db.exec('reset role')
  }
}

describe('mcp_token_validar com módulo ia_gestao', () => {
  test('sem módulo: modulo_desligado e o uso não é registrado', async () => {
    assert.deepEqual(await validar('h1'), { estado: 'modulo_desligado' })
    const { rows } = await db.query<{ ultimo_uso_em: string | null }>('select ultimo_uso_em from public.mcp_tokens')
    assert.equal(rows[0].ultimo_uso_em, null)
  })

  test('módulo vigente: devolve barraca e token; hash desconhecido: null', async () => {
    await db.exec(`insert into public.modulos_barraca values ('${BARRACA}', 'ia_gestao', true)`)
    const r = await validar('h1')
    assert.equal(r?.barraca_id, BARRACA)
    assert.equal(await validar('outro'), null)
  })

  test('módulo de outro tipo não libera', async () => {
    await db.exec(`update public.modulos_barraca set modulo = 'fiscal'`)
    assert.deepEqual(await validar('h1'), { estado: 'modulo_desligado' })
  })
})
