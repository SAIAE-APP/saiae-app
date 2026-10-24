// Trial de 3 dias corridos (2026-10-24): trigger de cadastro e avisos do ciclo de vida do trial.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const migration = sql('20261103130000_trial_3_dias.sql')

const id = (n: number) => `a${n}000000-0000-4000-8000-00000000000${n}`
const U = { recemCadastrado: id(1), dia1: id(2), longo30d: id(3) }

let db: PGlite

describe('criar_assinatura_trial', () => {
  test('o trial novo nasce Essencial, com 3 dias corridos (sem pular fim de semana)', () => {
    assert.match(migration, /'trialing', 'essencial', now\(\) \+ interval '3 days'/)
    assert.doesNotMatch(migration, /interval '30 days'/)
  })

  test('quem já usou o trial continua nascendo expirado', () => {
    assert.match(migration, /'expired', 'pro', now\(\)/)
  })
})

describe('trial_avisos_pendentes com trial de 3 dias', () => {
  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth; grant usage on schema auth to authenticated, anon, service_role;
      create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
      create table public.barracas (id uuid primary key default gen_random_uuid(), nome text, slug text, criada_em timestamptz default now());
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, cancelado_em timestamptz);
      create table public.assinaturas (usuario_id uuid primary key, status text, trial_ends_at timestamptz, stripe_subscription_id text);
      create table public.app_config (chave text primary key, valor jsonb);
      create function public.cobranca_ativa() returns boolean language sql stable security definer
        as $$ select true $$;
      grant usage on schema public to service_role, authenticated;
      create table public.contas_trial_usadas (email_lower text primary key);
    `)
    // usuário, cadastro (horas atrás), fim (horas a partir de agora). Todos já fizeram pedido: isola faltam_*.
    const casos: [string, number, number][] = [
      [U.recemCadastrado, 0, 72],
      [U.dia1, 25, 47],
      [U.longo30d, 24 * 25, 24 * 5],
    ]
    for (const [uid, horasCadastro, horasFim] of casos) {
      const barraca = `b${uid.slice(1, 2)}000000-0000-4000-8000-00000000000${uid.slice(1, 2)}`
      await db.exec(`
        insert into auth.users values ('${uid}', '${uid.slice(0, 2)}@x.com', now() - interval '${horasCadastro} hours');
        insert into public.barracas (id, nome, slug) values ('${barraca}', 'Loja ${uid.slice(1, 2)}', 'loja-${uid.slice(1, 2)}');
        insert into public.usuarios_barracas values ('${uid}', '${barraca}', 'dono');
        insert into public.assinaturas values ('${uid}', 'trialing', now() + interval '${horasFim} hours', null);
        insert into public.pedidos (barraca_id) values ('${barraca}');
      `)
    }
    await db.exec(sql('20261028130000_trial_avisos.sql'))
    await db.exec(migration)
  })

  after(async () => {
    await db.close()
  })

  async function etapas(uid: string) {
    await db.exec('reset role; set role service_role')
    const r = await db.query<{ usuario_id: string; etapa: string }>('select usuario_id, etapa from public.trial_avisos_pendentes()')
    return r.rows.filter((l) => l.usuario_id === uid).map((l) => l.etapa)
  }

  test('recém-cadastrado (72 h pela frente) não recebe "faltam 7 dias"', async () => {
    assert.deepEqual(await etapas(U.recemCadastrado), [])
  })

  test('no 2º dia do trial de 3 dias sai o "faltam_2", e só ele', async () => {
    assert.deepEqual(await etapas(U.dia1), ['faltam_2'])
  })

  test('trial longo (30 dias) que já está rodando ainda recebe "faltam_7"', async () => {
    assert.deepEqual(await etapas(U.longo30d), ['faltam_7'])
  })
})
