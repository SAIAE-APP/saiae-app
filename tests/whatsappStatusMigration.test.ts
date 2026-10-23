// Estado da conexão do WhatsApp avisado pelo CRM: texto da migration + migration real no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261030110000_whatsapp_status.sql', import.meta.url), 'utf8')
const B1 = 'b1000000-0000-4000-8000-000000000001'

describe('migration whatsapp_status (texto)', () => {
  test('Rollback no topo', () => {
    assert.match(sql.split('\n').slice(0, 40).join('\n'), /Rollback:/)
  })
  test('RPC security definer com search_path fixo e grants só para service_role', () => {
    assert.match(sql, /security definer/i)
    assert.match(sql, /set search_path = public, pg_temp/i)
    assert.match(sql, /revoke all on function public\.whatsapp_status_gravar\(uuid, text, timestamptz\) from public, anon, authenticated/i)
    assert.match(sql, /grant execute on function public\.whatsapp_status_gravar\(uuid, text, timestamptz\) to service_role/i)
  })
})

describe('migration whatsapp_status (PGlite)', () => {
  let db: PGlite
  async function gravar(barraca: string, estado: string, em: string) {
    const r = await db.query<{ r: string }>('select public.whatsapp_status_gravar($1, $2, $3::timestamptz) as r', [barraca, estado, em])
    return r.rows[0].r
  }
  async function linha() {
    const r = await db.query<{ s: string | null; em: string | null }>(
      `select whatsapp_status as s, to_char(whatsapp_status_em at time zone 'UTC', 'HH24:MI:SS') as em from public.barracas where id = $1`,
      [B1],
    )
    return r.rows[0]
  }

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create table public.barracas (id uuid primary key, nome text);
      grant usage on schema public to authenticated, anon, service_role;
      grant select on public.barracas to service_role;
      insert into public.barracas values ('${B1}', 'B1');
    `)
    await db.exec(sql)
    await db.exec(sql) // idempotente
    await db.exec('set role service_role')
  })
  after(async () => {
    await db.close()
  })

  test('colunas nascem nulas', async () => {
    assert.deepEqual(await linha(), { s: null, em: null })
  })

  test('grava caiu', async () => {
    assert.equal(await gravar(B1, 'caiu', '2026-10-23T12:00:00Z'), 'ok')
    assert.deepEqual(await linha(), { s: 'caiu', em: '12:00:00' })
  })

  test('evento mais antigo é ignorado e o estado fica', async () => {
    assert.equal(await gravar(B1, 'conectado', '2026-10-23T11:59:00Z'), 'ignorado')
    assert.deepEqual(await linha(), { s: 'caiu', em: '12:00:00' })
  })

  test('replay com o mesmo occurred_at não regrava', async () => {
    assert.equal(await gravar(B1, 'caiu', '2026-10-23T12:00:00Z'), 'ignorado')
  })

  test('evento mais novo vence', async () => {
    assert.equal(await gravar(B1, 'conectado', '2026-10-23T12:05:00Z'), 'ok')
    assert.deepEqual(await linha(), { s: 'conectado', em: '12:05:00' })
  })

  test('barraca inexistente → ignorado, nada gravado', async () => {
    assert.equal(await gravar('c0000000-0000-4000-8000-000000000000', 'caiu', '2026-10-23T13:00:00Z'), 'ignorado')
  })

  test('estado fora da lista dá erro e não grava', async () => {
    await assert.rejects(gravar(B1, 'explodiu', '2026-10-23T14:00:00Z'))
    assert.deepEqual(await linha(), { s: 'conectado', em: '12:05:00' })
  })

  test('authenticated e anon não executam', async () => {
    for (const papel of ['authenticated', 'anon']) {
      await db.exec(`set role ${papel}`)
      await assert.rejects(gravar(B1, 'caiu', '2026-10-23T15:00:00Z'), /permission denied/i, papel)
    }
    await db.exec('set role service_role')
  })
})
