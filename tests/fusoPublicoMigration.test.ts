// fuso_publico: texto da migration + migration real no PGlite.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261105110000_fuso_publico.sql', import.meta.url), 'utf8')

describe('migration fuso_publico', () => {
  test('Rollback no topo, função segura e grant', () => {
    assert.match(sql.split('\n').slice(0, 40).join('\n'), /Rollback:/)
    assert.match(sql, /security definer/)
    assert.match(sql, /set search_path = public, pg_temp/)
    assert.match(sql, /grant execute on function public\.fuso_publico\(text\) to anon, authenticated/)
  })

  describe('PGlite', () => {
    let db: PGlite
    before(async () => {
      db = new PGlite()
      await db.exec(`
        create role anon; create role authenticated;
        create table public.barracas (id uuid primary key, slug text unique, fuso text not null default 'America/Sao_Paulo');
        insert into public.barracas values ('b1000000-0000-4000-8000-000000000001', 'manaus', 'America/Manaus');
      `)
      await db.exec(sql)
    })
    after(async () => {
      await db.close()
    })

    test('devolve o fuso da barraca e nulo para slug inexistente', async () => {
      const a = await db.query<{ fuso_publico: string | null }>("select public.fuso_publico('manaus') as fuso_publico")
      assert.equal(a.rows[0].fuso_publico, 'America/Manaus')
      const b = await db.query<{ fuso_publico: string | null }>("select public.fuso_publico('x') as fuso_publico")
      assert.equal(b.rows[0].fuso_publico, null)
    })
  })
})
