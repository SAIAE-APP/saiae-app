// Migration da origem do cadastro (UTM) rodando de verdade no PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const U1 = 'a1000000-0000-4000-8000-000000000001'
const U2 = 'a2000000-0000-4000-8000-000000000002'
let db: PGlite
const como = (uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') =>
  db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.assinaturas (usuario_id uuid primary key, status text not null default 'trialing', plan text not null default 'pro');
    alter table public.assinaturas enable row level security;
    insert into public.assinaturas (usuario_id) values ('${U1}'), ('${U2}');
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20261107100000_origem_cadastro_utm.sql', import.meta.url), 'utf8'))
})
after(async () => db.close())

async function linha(uid: string) {
  await db.exec('reset role')
  return (await db.query<Record<string, unknown>>(`select * from public.assinaturas where usuario_id = $1`, [uid])).rows[0]
}

describe('registrar_origem_cadastro', () => {
  test('grava as 5 colunas e cadastro_origem_em; plano e status ficam intactos', async () => {
    await como(U1)
    const r = await db.query<{ ok: boolean }>(`select public.registrar_origem_cadastro('meta','cpc','lancamento','v1','comanda') as ok`)
    assert.equal(r.rows[0].ok, true)
    const l = await linha(U1)
    assert.deepEqual([l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term], ['meta', 'cpc', 'lancamento', 'v1', 'comanda'])
    assert.ok(l.cadastro_origem_em)
    assert.deepEqual([l.status, l.plan], ['trialing', 'pro'])
  })
  test('primeira origem vence: segunda chamada não sobrescreve', async () => {
    await como(U1)
    const r = await db.query<{ ok: boolean }>(`select public.registrar_origem_cadastro('google') as ok`)
    assert.equal(r.rows[0].ok, false)
    assert.equal((await linha(U1)).utm_source, 'meta')
  })
  test('sem nenhum UTM não grava (cadastro sem UTM segue igual)', async () => {
    await como(U2)
    const r = await db.query<{ ok: boolean }>(`select public.registrar_origem_cadastro('  ', '', null, null, null) as ok`)
    assert.equal(r.rows[0].ok, false)
    assert.equal((await linha(U2)).cadastro_origem_em, null)
  })
  test('só grava na própria conta e limita o tamanho', async () => {
    await como(U2)
    await db.query(`select public.registrar_origem_cadastro($1)`, ['x'.repeat(500)])
    assert.equal(String((await linha(U2)).utm_source).length, 200)
    assert.equal((await linha(U1)).utm_source, 'meta')
  })
  test('anônimo não executa', async () => {
    await como(null, 'anon')
    await assert.rejects(db.query(`select public.registrar_origem_cadastro('meta')`), /permission denied/)
    await db.exec('reset role')
  })
})
