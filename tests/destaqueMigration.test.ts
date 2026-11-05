// Destaque do cardápio público: texto da migration + migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ARQUIVO = '20261105100000_destaque_cardapio.sql'
const sql = readFileSync(new URL(`../supabase/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const I_OK = 'c1000000-0000-4000-8000-000000000001'
const I_INATIVO = 'c1000000-0000-4000-8000-000000000002'
const I_ABERTO = 'c1000000-0000-4000-8000-000000000003'
const I_OUTRA = 'c2000000-0000-4000-8000-000000000001'
const I_APAGAR = 'c1000000-0000-4000-8000-000000000009'

describe('migration destaque (texto)', () => {
  test('Rollback no topo', () => {
    assert.match(sql.split('\n').slice(0, 40).join('\n'), /Rollback:/)
  })

  test('coluna, função segura e grant', () => {
    assert.match(sql, /add column if not exists item_destaque_id uuid/)
    assert.match(sql, /on delete set null/)
    assert.match(sql, /security definer/)
    assert.match(sql, /set search_path = public, pg_temp/)
    assert.match(sql, /grant execute on function public\.destaque_publico\(text\) to anon, authenticated/)
  })

  test('não toca em cardapio_publico', () => {
    assert.doesNotMatch(sql, /cardapio_publico/)
  })
})

describe('migration destaque (PGlite)', () => {
  let db: PGlite

  async function destaque(slug: string) {
    const r = await db.query<{ item_id: string }>('select item_id from public.destaque_publico($1)', [slug])
    return r.rows.map((x) => x.item_id)
  }

  async function escolher(barraca: string, item: string | null) {
    await db.query('update public.barracas set item_destaque_id = $2 where id = $1', [barraca, item])
  }

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon; create role authenticated;
      create table public.barracas (id uuid primary key, slug text unique);
      create table public.itens (
        id uuid primary key, barraca_id uuid not null references public.barracas(id),
        ativo boolean not null default true, preco_aberto boolean not null default false
      );
      insert into public.barracas values ('${B1}', 'loja-1'), ('${B2}', 'loja-2');
      insert into public.itens (id, barraca_id, ativo, preco_aberto) values
        ('${I_OK}', '${B1}', true, false),
        ('${I_INATIVO}', '${B1}', false, false),
        ('${I_ABERTO}', '${B1}', true, true),
        ('${I_OUTRA}', '${B2}', true, false);
    `)
    await db.exec(sql)
  })

  after(async () => {
    await db.close()
  })

  test('item ativo da barraca devolve uma linha', async () => {
    await escolher(B1, I_OK)
    assert.deepEqual(await destaque('loja-1'), [I_OK])
  })

  test('item inativo e item de preço aberto não devolvem nada', async () => {
    await escolher(B1, I_INATIVO)
    assert.deepEqual(await destaque('loja-1'), [])
    await escolher(B1, I_ABERTO)
    assert.deepEqual(await destaque('loja-1'), [])
  })

  test('item de OUTRA barraca não devolve nada', async () => {
    await escolher(B1, I_OUTRA)
    assert.deepEqual(await destaque('loja-1'), [])
  })

  test('sem escolha e slug inexistente não devolvem nada', async () => {
    await escolher(B1, null)
    assert.deepEqual(await destaque('loja-1'), [])
    assert.deepEqual(await destaque('nao-existe'), [])
  })

  test('apagar o item zera o destaque (on delete set null)', async () => {
    await db.query('insert into public.itens (id, barraca_id) values ($1, $2)', [I_APAGAR, B1])
    await escolher(B1, I_APAGAR)
    await db.query('delete from public.itens where id = $1', [I_APAGAR])
    const r = await db.query<{ item_destaque_id: string | null }>(
      'select item_destaque_id from public.barracas where id = $1',
      [B1],
    )
    assert.equal(r.rows[0].item_destaque_id, null)
  })
})
