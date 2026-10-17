// Painel do superadmin, cartões de resumo: migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const COMUM = 'a9000000-0000-4000-8000-000000000009'
const B_AGORA = 'b1000000-0000-4000-8000-000000000001'
const B_ANTIGA = 'b2000000-0000-4000-8000-000000000002'
const B_PAROU = 'b3000000-0000-4000-8000-000000000003'
const B_VENDE = 'b4000000-0000-4000-8000-000000000004'
const B_POUCO = 'b5000000-0000-4000-8000-000000000005'
const B_CANCELADA = 'b6000000-0000-4000-8000-000000000006'

type Resumo = {
  janela_horas: number
  ativas_agora: number
  pedidos_hoje: number
  pedidos_hoje_por_barraca: { nome: string; pedidos: number }[]
  barracas_novas_7d: number
  trials_acabando_7d: number
  pararam: { nome: string }[]
  pedidos_por_dia: { dia: string; pedidos: number }[]
}

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

async function resumo(args = '') {
  return (await db.query<{ r: Resumo }>(`select public.admin_resumo_ativas(${args}) as r`)).rows[0].r
}

/** Pedido `dias` dias atrás, ao meio-dia de São Paulo (longe da virada do dia). */
function pedidoDiasAtras(barraca: string, dias: number) {
  return `insert into public.pedidos (barraca_id, criado_em) values ('${barraca}',
    (((now() at time zone 'America/Sao_Paulo')::date - ${dias})::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo');`
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text, criada_em timestamptz default now());
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, criado_em timestamptz not null default now(), cancelado_em timestamptz);
    create table public.assinaturas (usuario_id uuid primary key default gen_random_uuid(), status text, trial_ends_at timestamptz);
    create table public.superadmins (usuario_id uuid primary key);
    grant usage on schema public to authenticated;
    insert into auth.users values ('${ADMIN}'), ('${COMUM}');
    insert into public.superadmins values ('${ADMIN}');
    insert into public.barracas (id, nome, slug, criada_em) values
      ('${B_AGORA}', 'Agora', 'agora', now() - interval '60 days'),
      ('${B_ANTIGA}', 'Antiga', 'antiga', now() - interval '60 days'),
      ('${B_PAROU}', 'Parou', 'parou', now() - interval '60 days'),
      ('${B_VENDE}', 'Vende', 'vende', now() - interval '60 days'),
      ('${B_POUCO}', 'Pouco', 'pouco', now() - interval '2 days'),
      ('${B_CANCELADA}', 'Cancelada', 'cancelada', now() - interval '60 days');
    -- Agora: um pedido há 1 min (ativa e conta em hoje)
    insert into public.pedidos (barraca_id, criado_em) values ('${B_AGORA}', now() - interval '1 minute');
    -- Antiga: pedido há 5 horas, fora da janela de 2 h
    insert into public.pedidos (barraca_id, criado_em) values ('${B_ANTIGA}', now() - interval '5 hours');
    -- Cancelada: só pedido cancelado agora, não conta em nada
    insert into public.pedidos (barraca_id, criado_em, cancelado_em) values ('${B_CANCELADA}', now(), now());
    -- Assinaturas: 1 trial acabando em 3 dias, 1 trial longe, 1 ativa
    insert into public.assinaturas (status, trial_ends_at) values
      ('trialing', now() + interval '3 days'), ('trialing', now() + interval '20 days'), ('active', null);
  `)
  // Parou: vendeu 5 dias seguidos (9 a 5 dias atrás) e nada nos últimos 3 dias
  for (const d of [9, 8, 7, 6, 5]) await db.exec(pedidoDiasAtras(B_PAROU, d))
  // Vende: mesmo histórico, mas pediu há 2 min
  for (const d of [9, 8, 7, 6, 5]) await db.exec(pedidoDiasAtras(B_VENDE, d))
  await db.exec(`insert into public.pedidos (barraca_id, criado_em) values ('${B_VENDE}', now() - interval '2 minutes')`)
  // Pouco: só 4 dias de venda antes (não "vendia todo dia"), parou
  for (const d of [9, 8, 7, 6]) await db.exec(pedidoDiasAtras(B_POUCO, d))
  await db.exec(sql('20261028110000_admin_resumo_ativas.sql'))
})

after(async () => {
  await db.close()
})

describe('acesso', () => {
  test('conta fora da allowlist e anon são barrados', async () => {
    await como(COMUM)
    await assert.rejects(resumo(), /acesso negado/)
    await como(null, 'anon')
    await assert.rejects(resumo(), /permission denied/)
  })
})

describe('cartões', () => {
  test('ativas agora respeita a janela e ignora cancelados', async () => {
    await como(ADMIN)
    assert.equal((await resumo()).ativas_agora, 2)
    assert.equal((await resumo('6')).ativas_agora, 3)
    assert.equal((await resumo()).janela_horas, 2)
  })

  test('janela é travada entre 1 e 72 horas', async () => {
    await como(ADMIN)
    assert.equal((await resumo('0')).janela_horas, 1)
    assert.equal((await resumo('5000')).janela_horas, 72)
  })

  test('pedidos de hoje: total e ranking por barraca, sem cancelados', async () => {
    await como(ADMIN)
    const r = await resumo()
    assert.ok(r.pedidos_hoje >= 2)
    const nomes = r.pedidos_hoje_por_barraca.map((b) => b.nome)
    assert.ok(nomes.includes('Agora') && nomes.includes('Vende'))
    assert.ok(!nomes.includes('Cancelada'))
    assert.ok(r.pedidos_hoje_por_barraca.every((b) => b.pedidos >= 1))
    assert.ok(r.pedidos_hoje_por_barraca.length <= 10)
  })

  test('barracas novas e trials acabando em 7 dias', async () => {
    await como(ADMIN)
    const r = await resumo()
    assert.equal(r.barracas_novas_7d, 1)
    assert.equal(r.trials_acabando_7d, 1)
  })

  test('vendia e parou: só quem vendia 5+ dias e está há 3 dias sem pedido', async () => {
    await como(ADMIN)
    assert.deepEqual((await resumo()).pararam.map((b) => b.nome), ['Parou'])
  })

  test('pedidos por dia: 14 dias seguidos, dias vazios com zero', async () => {
    await como(ADMIN)
    const dias = (await resumo()).pedidos_por_dia
    assert.equal(dias.length, 14)
    const total = dias.reduce((s, d) => s + d.pedidos, 0)
    // Agora(1) + Antiga(1) + Parou(5) + Vende(6) + Pouco(4); o cancelado fica de fora
    assert.equal(total, 17)
    assert.equal(dias.filter((d) => d.pedidos === 0).length > 0, true)
  })

  test('resposta não traz dado de cliente final', async () => {
    await como(ADMIN)
    const json = JSON.stringify(await resumo())
    for (const campo of ['telefone', 'entrega_', 'cliente']) assert.ok(!json.includes(campo))
  })
})
