// Comanda aberta na Mesa: texto da migration + migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ARQUIVO = '20261029100000_comanda_aberta.sql'
const sql = readFileSync(new URL(`../supabase/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO_B1 = 'a1000000-0000-4000-8000-000000000001'
const DONO_B2 = 'a2000000-0000-4000-8000-000000000002'

describe('migration comanda aberta (texto)', () => {
  test('Rollback no topo', () => {
    const topo = sql.split('\n').slice(0, 40).join('\n')
    assert.match(topo, /Rollback:/)
  })

  test('interruptores em barracas com os defaults', () => {
    assert.match(sql, /comanda_aberta_habilitada boolean not null default false/)
    assert.match(sql, /taxa_servico_habilitada boolean not null default false/)
    assert.match(sql, /taxa_servico_bps integer not null default 1000/)
    assert.match(sql, /taxa_servico_bps between 0 and 3000/)
  })

  test('índice único parcial, RLS, trigger security definer e corrida', () => {
    assert.match(sql, /create unique index[^;]*\(barraca_id, mesa_normalizada\)\s*where status = 'aberta'/)
    assert.match(sql, /alter table public\.comandas enable row level security/)
    assert.match(sql, /pedidos_atribuir_comanda/)
    assert.match(sql, /security definer/)
    assert.match(sql, /on conflict[^;]*do nothing/)
    assert.match(sql, /function public\.normalizar_mesa/)
    assert.match(sql, /set search_path = public, pg_temp/)
  })

  test('trigger trava a comanda aberta com for share nos dois selects (corrida com o fechamento)', () => {
    const corpo = sql.slice(sql.indexOf('function public._trg_pedidos_atribuir_comanda'))
    const selects = corpo.match(/select c\.id into v_id[^;]*;/g) ?? []
    assert.equal(selects.length, 2)
    for (const s of selects) assert.match(s, /status = 'aberta'\s+for share;/)
  })

  test('FK composta (comanda_id, barraca_id)', () => {
    assert.match(sql, /unique \(id, barraca_id\)/)
    assert.match(sql, /foreign key \(comanda_id, barraca_id\)\s*references public\.comandas \(id, barraca_id\)/)
  })
})

describe('migration comanda aberta (PGlite)', () => {
  let db: PGlite

  async function como(uid: string | null) {
    await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'}`)
  }

  let n = 0
  /** Insere como superusuário (o criar_pedido é security definer) e devolve o comanda_id gravado. */
  async function pedido(barraca: string, mesa: string | null, extra: { tipo?: string; metodo?: string } = {}) {
    n += 1
    const r = await db.query<{ comanda_id: string | null }>(
      `insert into public.pedidos (barraca_id, mesa, tipo_atendimento, metodo_pagamento, client_uuid)
       values ($1, $2, $3, $4, $5) returning comanda_id`,
      [barraca, mesa, extra.tipo ?? 'mesa', extra.metodo ?? 'na_entrega', `c-${n}`],
    )
    return r.rows[0].comanda_id
  }

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.barracas (id uuid primary key, nome text);
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
        select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
      create table public.pedidos (
        id uuid primary key default gen_random_uuid(),
        barraca_id uuid not null references public.barracas(id) on delete cascade,
        mesa text, tipo_atendimento text, metodo_pagamento text, client_uuid text unique
      );
      grant usage on schema public to authenticated, anon;
      insert into public.barracas values ('${B1}', 'B1'), ('${B2}', 'B2');
      insert into public.usuarios_barracas values ('${DONO_B1}', '${B1}', 'dono'), ('${DONO_B2}', '${B2}', 'dono');
    `)
    await db.exec(sql)
    // Rodar duas vezes não quebra (idempotente).
    await db.exec(sql)
  })

  after(async () => {
    await db.close()
  })

  test('normalizar_mesa', async () => {
    const casos: [string | null, string][] = [
      ['5', '5'], ['05', '5'], ['Mesa 5', '5'], ['mesa  5', '5'], [' MESA 005 ', '5'], ['mesa5', '5'],
      ['15', '15'], ['0', '0'], ['00', '0'], ['Mesa', ''], ['   ', ''], [null, ''], ['Varanda Á', 'varanda a'],
      ['Mesanino', 'mesanino'], ['Mesa-5', '5'], ['Mesa: 5', '5'], ['mesa #05', '5'],
    ]
    for (const [entrada, esperado] of casos) {
      const r = await db.query<{ m: string }>('select public.normalizar_mesa($1) as m', [entrada])
      assert.equal(r.rows[0].m, esperado, `normalizar_mesa(${JSON.stringify(entrada)})`)
    }
  })

  test('interruptor desligado: nada muda', async () => {
    assert.equal(await pedido(B1, '5'), null)
    const r = await db.query<{ c: boolean; t: boolean; bps: number }>(
      `select comanda_aberta_habilitada c, taxa_servico_habilitada t, taxa_servico_bps bps from public.barracas where id = $1`, [B1])
    assert.deepEqual(r.rows[0], { c: false, t: false, bps: 1000 })
  })

  test('ligado: "5", "05", "Mesa 5", "mesa  5" na mesma comanda; "15" em outra', async () => {
    await db.exec(`update public.barracas set comanda_aberta_habilitada = true where id in ('${B1}', '${B2}')`)
    const a = await pedido(B1, '5')
    assert.ok(a)
    assert.equal(await pedido(B1, '05'), a)
    assert.equal(await pedido(B1, 'Mesa 5'), a)
    assert.equal(await pedido(B1, 'mesa  5'), a)
    const quinze = await pedido(B1, '15')
    assert.ok(quinze)
    assert.notEqual(quinze, a)
    const outraBarraca = await pedido(B2, '5')
    assert.ok(outraBarraca)
    assert.notEqual(outraBarraca, a)
    const r = await db.query<{ mesa: string; mesa_normalizada: string }>('select mesa, mesa_normalizada from public.comandas where id = $1', [a])
    assert.deepEqual(r.rows[0], { mesa: '5', mesa_normalizada: '5' })
  })

  test('fora das condições não abre comanda', async () => {
    assert.equal(await pedido(B1, '7', { metodo: 'dinheiro' }), null)
    assert.equal(await pedido(B1, '7', { tipo: 'balcao' }), null)
    assert.equal(await pedido(B1, null), null)
    assert.equal(await pedido(B1, 'Mesa'), null)
    assert.equal(await pedido(B1, '  '), null)
  })

  test('pedido da barraca A não aponta para comanda da barraca B (FK composta)', async () => {
    const deB2 = await pedido(B2, '30')
    assert.ok(deB2)
    // dinheiro: o trigger não mexe no comanda_id, então o valor enviado chega à FK.
    await assert.rejects(
      db.query(
        `insert into public.pedidos (barraca_id, mesa, tipo_atendimento, metodo_pagamento, client_uuid, comanda_id)
         values ($1, '30', 'mesa', 'dinheiro', 'x-tenant', $2)`,
        [B1, deB2],
      ),
      /pedidos_comanda_barraca_fk/,
    )
  })

  test('índice único impede duas comandas abertas na mesma mesa (base do on conflict)', async () => {
    await assert.rejects(db.query(`insert into public.comandas (barraca_id, mesa, mesa_normalizada) values ($1, '05', '5')`, [B1]))
  })

  test('comanda fechada libera a mesa: próximo lançamento abre outra', async () => {
    const antiga = await pedido(B1, '9')
    await db.query(`update public.comandas set status = 'fechada', fechada_em = now() where id = $1`, [antiga])
    const nova = await pedido(B1, '09')
    assert.ok(nova)
    assert.notEqual(nova, antiga)
  })

  test('desligar com comanda aberta: comanda continua lá, pedido novo não entra nela', async () => {
    const aberta = await pedido(B1, '22')
    await db.exec(`update public.barracas set comanda_aberta_habilitada = false where id = '${B1}'`)
    assert.equal(await pedido(B1, '22'), null)
    await como(DONO_B1)
    const r = await db.query<{ status: string }>('select status from public.comandas where id = $1', [aberta])
    assert.equal(r.rows[0]?.status, 'aberta')
    await db.exec('reset role')
    await db.exec(`update public.barracas set comanda_aberta_habilitada = true where id = '${B1}'`)
  })

  test('RLS: só lê comanda da própria barraca, sem escrita direta', async () => {
    await como(DONO_B2)
    const r = await db.query<{ barraca_id: string }>('select barraca_id from public.comandas')
    assert.ok(r.rows.length > 0)
    assert.ok(r.rows.every((x) => x.barraca_id === B2))
    await assert.rejects(db.query(`insert into public.comandas (barraca_id, mesa, mesa_normalizada) values ($1, '1', '1')`, [B2]))
    await assert.rejects(db.query(`update public.comandas set status = 'fechada'`))
    await assert.rejects(db.query('delete from public.comandas'))
    await como(null)
    await assert.rejects(db.query('select 1 from public.comandas'))
    await db.exec('reset role')
  })
})
