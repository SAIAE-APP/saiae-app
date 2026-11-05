// Painel do superadmin, bloqueio de conta e log de ações: migrations reais no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO = 'a2000000-0000-4000-8000-000000000002'
const FUNC = 'a9000000-0000-4000-8000-000000000009'
const SEM_ASSINATURA = 'a5000000-0000-4000-8000-000000000005'
const BARRACA = 'b2000000-0000-4000-8000-000000000002'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const acesso = async () =>
  (await um<{ v: boolean }>(`select public.assinatura_tem_acesso(a) as v from public.assinaturas a where usuario_id = '${DONO}'`)).v
const logs = async () => (await um<{ n: number }>(`select count(*)::int as n from public.admin_acoes_log`)).n

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.app_config (chave text primary key, valor jsonb not null);
    create table public.barracas (id uuid primary key default gen_random_uuid(), nome text, slug text, criada_em timestamptz default now());
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.assinaturas (
      usuario_id uuid primary key, status text not null, plan text, cycle text, trial_ends_at timestamptz,
      current_period_end timestamptz, grace_until timestamptz, stripe_subscription_id text,
      updated_at timestamptz not null default now()
    );
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), event text, subscription_id text, error text,
      received_at timestamptz not null default now()
    );
    create function public.cobranca_ativa() returns boolean language sql stable as $$
      select coalesce((select valor <> 'false'::jsonb from public.app_config where chave = 'cobranca_ativa'), true) $$;
    create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable as $$
      select exists (select 1 from public.usuarios_barracas where barraca_id = p and usuario_id = auth.uid()) $$;
    -- corpos vigentes em produção (migration 20261013100000_cobranca_flag.sql)
    create function public.assinatura_tem_acesso(p_assinatura public.assinaturas, p_now timestamptz default now()) returns boolean
      language sql stable as $$
        select not public.cobranca_ativa() or case p_assinatura.status
          when 'trialing' then p_assinatura.trial_ends_at is not null and p_now < p_assinatura.trial_ends_at
          when 'active' then true
          when 'past_due' then p_assinatura.grace_until is not null and p_now < p_assinatura.grace_until
          when 'canceled' then p_assinatura.current_period_end is not null and p_now < p_assinatura.current_period_end
          else false end $$;
    create function public.barraca_assinatura_ativa(p_barraca_id uuid) returns boolean language sql stable security definer as $$
      select not public.cobranca_ativa() or coalesce((
        select public.assinatura_tem_acesso(a, now()) from public.usuarios_barracas ub
        join public.assinaturas a on a.usuario_id = ub.usuario_id
        where ub.barraca_id = p_barraca_id and ub.papel = 'dono' limit 1), false) $$;
    create function public.assinatura_da_barraca(p_slug text)
      returns table(status text, plano text, ciclo text, tem_acesso boolean, dias_restantes_trial integer,
        trial_ends_at timestamptz, current_period_end timestamptz, eh_dono boolean, cobranca_ativa boolean)
      language sql stable as $$ select null::text, null::text, null::text, true, null::integer, null::timestamptz, null::timestamptz, false, true $$;
    grant usage on schema public to authenticated;

    insert into auth.users values
      ('${ADMIN}', 'admin@x.com'), ('${DONO}', 'dono@x.com'), ('${FUNC}', 'func@x.com'), ('${SEM_ASSINATURA}', 'sem@x.com');
    insert into public.barracas (id, nome, slug) values ('${BARRACA}', 'Ativa', 'ativa');
    insert into public.usuarios_barracas values ('${DONO}', '${BARRACA}', 'dono'), ('${FUNC}', '${BARRACA}', 'funcionario');
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at, current_period_end, stripe_subscription_id)
      values ('${DONO}', 'active', 'pro', null, now() + interval '20 days', 'sub_1');
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  await db.exec(sql('20261108100000_admin_bloqueio_conta.sql'))
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
})

after(async () => {
  await db.close()
})

describe('bloqueio de conta', () => {
  test('bloquear corta tem_acesso de conta ativa', async () => {
    assert.equal(await acesso(), true)
    await como(ADMIN)
    await db.query(`select public.admin_bloquear_conta('${DONO}', 'inadimplente')`)
    await db.exec('reset role')
    assert.equal(await acesso(), false)
    const a = await um<{ bloqueada_admin: boolean; bloqueio_motivo: string; bloqueada_em: string }>(
      `select * from public.assinaturas where usuario_id = '${DONO}'`)
    assert.equal(a.bloqueada_admin, true)
    assert.equal(a.bloqueio_motivo, 'inadimplente')
    assert.ok(a.bloqueada_em)
  })

  test('com a cobrança desligada, assinatura_tem_acesso e assinatura_da_barraca ainda refletem o bloqueio (RLS não)', async () => {
    await db.exec(`reset role; insert into public.app_config values ('cobranca_ativa', 'false'::jsonb)`)
    assert.equal(await acesso(), false)
    await como(FUNC)
    const r = await um<{ bloqueada: boolean; tem_acesso: boolean }>(`select * from public.assinatura_da_barraca('ativa')`)
    assert.deepEqual([r.bloqueada, r.tem_acesso], [true, false])
    await db.exec(`reset role`)
    // limite conhecido: barraca_assinatura_ativa libera tudo com a cobrança desligada
    assert.equal((await um<{ v: boolean }>(`select public.barraca_assinatura_ativa('${BARRACA}') as v`)).v, true)
    await db.exec(`delete from public.app_config`)
  })

  test('funcionário perde acesso quando o dono é bloqueado', async () => {
    await db.exec('reset role')
    assert.equal((await um<{ v: boolean }>(`select public.barraca_assinatura_ativa('${BARRACA}') as v`)).v, false)
  })

  test('assinatura_da_barraca informa bloqueada', async () => {
    await como(FUNC)
    const r = await um<{ bloqueada: boolean; tem_acesso: boolean }>(`select * from public.assinatura_da_barraca('ativa')`)
    assert.equal(r.bloqueada, true)
    assert.equal(r.tem_acesso, false)
  })

  test('bloquear duas vezes não duplica o log', async () => {
    await como(ADMIN)
    await db.query(`select public.admin_bloquear_conta('${DONO}', 'outra')`)
    await db.exec('reset role')
    assert.equal(await logs(), 1)
    assert.equal((await um<{ m: string }>(`select bloqueio_motivo as m from public.assinaturas where usuario_id = '${DONO}'`)).m, 'inadimplente')
  })

  test('desbloquear devolve o acesso sem mexer em plano nem prazo', async () => {
    await db.exec('reset role')
    const antes = await um(`select status, plan, current_period_end from public.assinaturas where usuario_id = '${DONO}'`)
    await como(ADMIN)
    await db.query(`select public.admin_desbloquear_conta('${DONO}')`)
    await db.query(`select public.admin_desbloquear_conta('${DONO}')`)
    await db.exec('reset role')
    assert.equal(await acesso(), true)
    assert.equal((await um<{ v: boolean }>(`select public.barraca_assinatura_ativa('${BARRACA}') as v`)).v, true)
    assert.deepEqual(await um(`select status, plan, current_period_end from public.assinaturas where usuario_id = '${DONO}'`), antes)
    assert.equal(await logs(), 2)
  })

  test('bloquear exige superadmin (comum recebe 42501)', async () => {
    for (const uid of [FUNC, DONO]) {
      await como(uid)
      await assert.rejects(
        db.query(`select public.admin_bloquear_conta('${DONO}')`),
        (e: any) => e.code === '42501' && /acesso negado/.test(e.message),
      )
      await assert.rejects(db.query(`select public.admin_desbloquear_conta('${DONO}')`), /acesso negado/)
    }
    await como(null, 'anon')
    await assert.rejects(db.query(`select public.admin_bloquear_conta('${DONO}')`), /permission denied/)
  })

  test('bloquear conta sem assinatura levanta erro e não cria linha', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select public.admin_bloquear_conta('${SEM_ASSINATURA}')`), /conta sem assinatura/)
    await db.exec('reset role')
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.assinaturas`)).n, 1)
  })
})

describe('log de ações', () => {
  test('admin_listar_acoes só para superadmin, mais recente primeiro, com e-mail', async () => {
    await como(FUNC)
    await assert.rejects(db.query('select * from public.admin_listar_acoes()'), /acesso negado/)
    await como(ADMIN)
    const r = (await db.query<{ acao: string; admin_email: string; alvo_id: string }>('select * from public.admin_listar_acoes()')).rows
    assert.equal(r.length, 2)
    assert.equal(r[0].admin_email, 'admin@x.com')
    assert.equal(r[0].alvo_id, DONO)
    assert.deepEqual(new Set(r.map((l) => l.acao)), new Set(['bloquear_conta', 'desbloquear_conta']))
  })

  test('tabela e função interna não são acessíveis a authenticated', async () => {
    await como(ADMIN)
    await assert.rejects(db.query('select * from public.admin_acoes_log'), /permission denied/)
    await assert.rejects(db.query(`select public.admin_registrar_acao('x','y',null,'{}')`), /permission denied/)
  })
})
