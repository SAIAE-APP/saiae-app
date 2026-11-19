// Cobrança do módulo fiscal: fiscal_assinaturas, flag fiscal_contratacao_aberta e cnpj_valido. Migration real no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const DONO = 'a1000000-0000-4000-8000-000000000001'
const OUTRO = 'a2000000-0000-4000-8000-000000000002'
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const B3 = 'b3000000-0000-4000-8000-000000000003'
const CNPJ_A = '11222333000181' // válido
const CNPJ_B = '11444777000161' // válido

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const ins = (uid: string, barraca: string, cnpj: string, status: string, extra = '') =>
  db.query(`insert into public.fiscal_assinaturas (usuario_id, barraca_id, cnpj, status${extra ? ', ' + extra.split('=')[0] : ''})
    values ('${uid}', '${barraca}', '${cnpj}', '${status}'${extra ? ", '" + extra.split('=')[1] + "'" : ''})`)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.app_config (chave text primary key, valor jsonb not null, atualizado_em timestamptz not null default now());
    create table public.barracas (id uuid primary key, nome text);
    grant usage on schema public to authenticated, anon;
    insert into auth.users values ('${DONO}'), ('${OUTRO}');
    insert into public.barracas values ('${B1}', 'A'), ('${B2}', 'B'), ('${B3}', 'C');
  `)
  await db.exec(sql('20261110110000_fiscal_assinaturas.sql'))
})

after(async () => {
  await db.close()
})

describe('fiscal_assinaturas', () => {
  test('aceita os 5 status; recusa status e cnpj fora do formato (14 dígitos normalizados)', async () => {
    await db.exec('reset role')
    await ins(DONO, B1, CNPJ_A, 'pendente')
    await ins(DONO, B2, CNPJ_B, 'active')
    await ins(DONO, B3, '45997418000153', 'past_due')
    await ins(DONO, B1, CNPJ_A, 'canceled')
    await ins(DONO, B1, CNPJ_A, 'expired')
    await db.exec('delete from public.fiscal_assinaturas')
    await assert.rejects(ins(DONO, B1, CNPJ_A, 'ativo'), /check/)
    await assert.rejects(ins(DONO, B1, '11.222.333/0001-81', 'pendente'), /check/)
    await assert.rejects(ins(DONO, B1, '1122233300018', 'pendente'), /check/)
  })

  test('índices únicos: 2 vivas para o mesmo cnpj ou a mesma barraca são recusadas', async () => {
    await db.exec('reset role; delete from public.fiscal_assinaturas')
    await ins(DONO, B1, CNPJ_A, 'pendente')
    await assert.rejects(ins(DONO, B2, CNPJ_A, 'active'), /unique|duplicate|fiscal_assinatura_viva/) // mesmo cnpj, outra barraca
    await assert.rejects(ins(DONO, B1, CNPJ_B, 'past_due'), /unique|duplicate|fiscal_assinatura_viva/) // mesma barraca, outro cnpj
    await ins(DONO, B2, CNPJ_B, 'active') // outro cnpj e outra barraca: ok
  })

  test('depois de canceled/expired dá para contratar de novo; mortas não bloqueiam e podem repetir', async () => {
    await db.exec(`reset role; update public.fiscal_assinaturas set status = 'canceled' where cnpj = '${CNPJ_A}'`)
    await ins(OUTRO, B1, CNPJ_A, 'pendente') // mesmo cnpj/barraca de uma cancelada
    await db.exec(`update public.fiscal_assinaturas set status = 'expired' where cnpj = '${CNPJ_A}' and status = 'pendente'`)
    await ins(OUTRO, B1, CNPJ_A, 'active')
    const n = await um<{ n: number }>(`select count(*)::int as n from public.fiscal_assinaturas where cnpj = '${CNPJ_A}'`)
    assert.equal(n.n, 3)
  })

  test('stripe_subscription_id e stripe_checkout_session_id são únicos', async () => {
    await db.exec(`reset role; delete from public.fiscal_assinaturas;
      insert into public.fiscal_assinaturas (usuario_id, barraca_id, cnpj, status, stripe_subscription_id, stripe_checkout_session_id)
      values ('${DONO}', '${B1}', '${CNPJ_A}', 'active', 'sub_1', 'cs_1')`)
    await assert.rejects(db.query(`insert into public.fiscal_assinaturas (usuario_id, barraca_id, cnpj, status, stripe_subscription_id)
      values ('${DONO}', '${B2}', '${CNPJ_B}', 'active', 'sub_1')`), /unique|duplicate|fiscal_assinatura_viva/)
    await assert.rejects(db.query(`insert into public.fiscal_assinaturas (usuario_id, barraca_id, cnpj, status, stripe_checkout_session_id)
      values ('${DONO}', '${B2}', '${CNPJ_B}', 'pendente', 'cs_1')`), /unique|duplicate|fiscal_assinatura_viva/)
  })

  test('RLS: dono lê a própria; outro usuário e anon não leem', async () => {
    await como(DONO)
    assert.equal((await db.query(`select 1 from public.fiscal_assinaturas`)).rows.length, 1)
    await como(OUTRO)
    assert.equal((await db.query(`select 1 from public.fiscal_assinaturas`)).rows.length, 0)
    await como(null, 'anon')
    await assert.rejects(db.query(`select 1 from public.fiscal_assinaturas`), /permission denied/)
  })

  test('RLS: cliente não escreve (insert, update, delete negados), nem a própria linha', async () => {
    await como(DONO)
    await assert.rejects(ins(DONO, B3, CNPJ_B, 'active'), /permission denied|row-level security/)
    await assert.rejects(db.query(`update public.fiscal_assinaturas set status = 'expired'`), /permission denied|row-level security/)
    await assert.rejects(db.query(`delete from public.fiscal_assinaturas`), /permission denied|row-level security/)
    await db.exec('reset role')
    assert.equal((await um<{ status: string }>(`select status from public.fiscal_assinaturas`)).status, 'active')
  })

  test('apagar a barraca ou o usuário leva a linha junto (padrão do projeto)', async () => {
    await db.exec(`reset role; delete from public.barracas where id = '${B1}'`)
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.fiscal_assinaturas`)).n, 0)
  })
})

describe('fiscal_contratacao_aberta', () => {
  test('nasce falsa (chave registrada com false) e é chamável por anon e authenticated', async () => {
    await db.exec('reset role')
    assert.deepEqual(await um(`select valor::text from public.app_config where chave = 'fiscal_contratacao_aberta'`), { valor: 'false' })
    for (const papel of ['anon', 'authenticated'] as const) {
      await como(null, papel)
      assert.equal((await um<{ r: boolean }>(`select public.fiscal_contratacao_aberta() as r`)).r, false)
    }
  })

  test('só o JSON true abre; linha ausente ou valor estranho = fechado; não toca em cobranca_ativa', async () => {
    await db.exec(`reset role; update public.app_config set valor = 'true'::jsonb where chave = 'fiscal_contratacao_aberta'`)
    assert.equal((await um<{ r: boolean }>(`select public.fiscal_contratacao_aberta() as r`)).r, true)
    await db.exec(`update public.app_config set valor = '"true"'::jsonb where chave = 'fiscal_contratacao_aberta'`)
    assert.equal((await um<{ r: boolean }>(`select public.fiscal_contratacao_aberta() as r`)).r, false)
    await db.exec(`delete from public.app_config where chave = 'fiscal_contratacao_aberta'`)
    assert.equal((await um<{ r: boolean }>(`select public.fiscal_contratacao_aberta() as r`)).r, false)
  })
})

describe('cnpj_valido', () => {
  const v = async (c: string | null) =>
    (await db.query<{ r: boolean }>(`select public.cnpj_valido($1) as r`, [c])).rows[0].r

  test('aceita CNPJ válido, com ou sem máscara', async () => {
    assert.equal(await v(CNPJ_A), true)
    assert.equal(await v('11.444.777/0001-61'), true)
    assert.equal(await v('00000000000191'), true) // Banco do Brasil
  })

  test('recusa dígito verificador errado, tamanho errado, repetidos, vazio e nulo', async () => {
    for (const c of ['11222333000182', '11222333000191', '1122233300018', '112223330001811', '11111111111111', '00000000000000', '', 'abc', null]) {
      assert.equal(await v(c), false, String(c))
    }
  })
})
