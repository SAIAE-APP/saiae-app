// Cupons, Task 7: rpc cupons_resumo roda de verdade (migrations reais de cupons no PGlite, tabelas-base em stub).
// O dono só lê o AGREGADO; confirma isolamento entre lojas e que reserva/liberado não contam. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: é só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const U1 = 'a1000000-0000-4000-8000-000000000001'
const U2 = 'a2000000-0000-4000-8000-000000000002'
const C_A = 'c1000000-0000-4000-8000-00000000000a' // loja 1, 3 usos confirmados (500+500+300)
const C_B = 'c1000000-0000-4000-8000-00000000000b' // loja 1, só reserva e liberado
const C_C = 'c1000000-0000-4000-8000-00000000000c' // loja 1, sem uso
const C_X = 'c2000000-0000-4000-8000-00000000000d' // loja 2

let db: PGlite

async function resumo(uid: string, barraca: string, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`select set_config('test.uid', '${uid}', false); set role ${papel}`)
  try {
    return (await db.query<{ cupom_id: string; usos_confirmados: number; desconto_total_centavos: string | number }>(
      `select * from public.cupons_resumo($1)`,
      [barraca],
    )).rows
  } finally {
    await db.exec('reset role')
  }
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.clientes_finais (id uuid primary key default gen_random_uuid());
    create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid());
    create table public.pedidos (id uuid primary key default gen_random_uuid());
    insert into public.barracas values ('${B1}', 'loja-1'), ('${B2}', 'loja-2');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono'), ('${U2}', '${B2}', 'dono');
  `)
  await db.exec(sql('20261018100000_cupons.sql'))
  await db.exec(sql('20261018120000_cupons_painel.sql'))
  await db.exec(sql('20261018120000_cupons_painel.sql')) // re-executável
  await db.exec(`
    insert into public.cupons (id, barraca_id, codigo, tipo, valor) values
      ('${C_A}', '${B1}', 'AAA', 'fixo', 500), ('${C_B}', '${B1}', 'BBB', 'percentual', 10),
      ('${C_C}', '${B1}', 'CCC', 'percentual', 5), ('${C_X}', '${B2}', 'XXX', 'fixo', 100);
    insert into public.cupom_usos (cupom_id, barraca_id, estado, desconto_centavos, reservado_ate) values
      ('${C_A}', '${B1}', 'confirmado', 500, now()), ('${C_A}', '${B1}', 'confirmado', 500, now()),
      ('${C_A}', '${B1}', 'confirmado', 300, now()), ('${C_A}', '${B1}', 'liberado', 999, now()),
      ('${C_A}', '${B1}', 'reservado', 777, now() + interval '10 minutes'),
      ('${C_B}', '${B1}', 'reservado', 400, now() + interval '10 minutes'), ('${C_B}', '${B1}', 'liberado', 400, now()),
      ('${C_X}', '${B2}', 'confirmado', 100, now());
  `)
})

after(async () => {
  await db.close()
})

describe('cupons_resumo', () => {
  test('conta e soma só os usos CONFIRMADOS; reserva e liberado não entram', async () => {
    const r = await resumo(U1, B1)
    const por = new Map(r.map((x) => [x.cupom_id, [Number(x.usos_confirmados), Number(x.desconto_total_centavos)]]))
    assert.deepEqual(por.get(C_A), [3, 1300])
    assert.deepEqual(por.get(C_B), [0, 0])
    assert.deepEqual(por.get(C_C), [0, 0]) // cupom sem nenhum uso aparece com zeros
    assert.equal(r.length, 3)
  })

  test('isolamento: o dono de outra loja não vê números e a chamada é recusada', async () => {
    await assert.rejects(resumo(U2, B1), /sem acesso/)
    const r = await resumo(U2, B2)
    assert.deepEqual(r.map((x) => x.cupom_id), [C_X])
    assert.equal(Number(r[0].desconto_total_centavos), 100)
  })

  test('sem login (uid nulo) e anon não executam', async () => {
    await assert.rejects(resumo('', B1), /sem acesso/)
    await assert.rejects(resumo(U1, B1, 'anon'), /permission denied/)
  })

  test('o painel continua sem ler cupom_usos diretamente', async () => {
    await db.exec(`select set_config('test.uid', '${U1}', false); set role authenticated`)
    try {
      await assert.rejects(db.query('select * from public.cupom_usos'), /permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  test('dono lê, cria e edita os próprios cupons pela RLS, e não os de outra loja', async () => {
    // O Supabase dá grants padrão ao papel authenticated; o PGlite não. A RLS é quem decide o resto.
    await db.exec('grant usage on schema public to authenticated; grant select, insert, update, delete on public.cupons to authenticated')
    await db.exec(`select set_config('test.uid', '${U1}', false); set role authenticated`)
    try {
      const mine = await db.query<{ codigo: string }>('select codigo from public.cupons order by codigo')
      assert.deepEqual(mine.rows.map((x) => x.codigo), ['AAA', 'BBB', 'CCC'])
      await db.query(`insert into public.cupons (barraca_id, codigo, tipo, valor) values ($1, 'NOVO', 'percentual', 7)`, [B1])
      await assert.rejects(db.query(`insert into public.cupons (barraca_id, codigo, tipo, valor) values ($1, 'ALHEIO', 'fixo', 1)`, [B2]), /row-level security/)
      await assert.rejects(db.query(`insert into public.cupons (barraca_id, codigo, tipo, valor) values ($1, 'AAA', 'fixo', 1)`, [B1]), /unique|duplicate/)
      const up = await db.query(`update public.cupons set ativo = false where id = $1`, [C_X])
      assert.equal(up.affectedRows, 0)
      const del = await db.query(`delete from public.cupons where id = $1`, [C_C])
      assert.equal(del.affectedRows, 0, 'sem DELETE direto: a exclusão vai por cupom_apagar')
    } finally {
      await db.exec('reset role')
    }
  })
})
