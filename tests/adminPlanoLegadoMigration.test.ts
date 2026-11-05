// Painel do superadmin, trocar plano / estender vencimento / origem_plano: migrations reais no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const COMUM = 'a1000000-0000-4000-8000-000000000001'
const LEGADO = 'a2000000-0000-4000-8000-000000000002' // pro, antigo, sem stripe
const PAGO = 'a3000000-0000-4000-8000-000000000003' // pro, antigo, com stripe
const TRIAL = 'a4000000-0000-4000-8000-000000000004' // essencial trialing, novo
const ATIVO = 'a6000000-0000-4000-8000-000000000006' // essencial active, novo
const SEM_ASSINATURA = 'a5000000-0000-4000-8000-000000000005'
const EXPIRADO = 'a8000000-0000-4000-8000-000000000008'
const PASTDUE = 'a9100000-0000-4000-8000-000000000091'
const NOVO ='a7000000-0000-4000-8000-000000000007'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const ass = (id: string) =>
  um<{ plan: string; status: string; origem_plano: string; trial_ends_at: string | null; current_period_end: string | null }>(
    `select plan, status, origem_plano, trial_ends_at::text, current_period_end::text from public.assinaturas where usuario_id = '${id}'`)
const logs = async (acao: string) =>
  (await um<{ n: number }>(`select count(*)::int as n from public.admin_acoes_log where acao = '${acao}'`)).n
const diasEntre = async (a: string, b: string) =>
  Number((await um<{ d: string }>(`select extract(epoch from ('${a}'::timestamptz - '${b}'::timestamptz)) / 86400 as d`)).d)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
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
    create function public.assinatura_tem_acesso(p_assinatura public.assinaturas, p_now timestamptz default now()) returns boolean
      language sql stable as $$ select true $$;
    create function public.barraca_assinatura_ativa(p_barraca_id uuid) returns boolean language sql stable as $$ select true $$;
    create function public.assinatura_da_barraca(p_slug text)
      returns table(status text, plano text, ciclo text, tem_acesso boolean, dias_restantes_trial integer,
        trial_ends_at timestamptz, current_period_end timestamptz, eh_dono boolean, cobranca_ativa boolean)
      language sql stable as $$ select null::text, null::text, null::text, true, null::integer, null::timestamptz, null::timestamptz, false, true $$;
    grant usage on schema public to authenticated;

    insert into auth.users (id, email, created_at) values
      ('${ADMIN}', 'admin@x.com', '2026-09-01'), ('${COMUM}', 'comum@x.com', '2026-09-01'),
      ('${LEGADO}', 'leg@x.com', '2026-10-01'), ('${PAGO}', 'pago@x.com', '2026-10-05'),
      ('${TRIAL}', 'trial@x.com', '2026-11-04'), ('${ATIVO}', 'ativo@x.com', '2026-11-03'),
      ('${EXPIRADO}', 'exp@x.com', '2026-10-05'), ('${PASTDUE}', 'pd@x.com', '2026-10-05'),
      ('${SEM_ASSINATURA}', 'sem@x.com', '2026-11-03'), ('${NOVO}', 'novo@x.com', '2026-11-05');
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at, current_period_end, stripe_subscription_id) values
      ('${LEGADO}', 'active', 'pro', null, null, null),
      ('${PAGO}', 'active', 'pro', null, now() + interval '10 days', 'sub_1'),
      ('${TRIAL}', 'trialing', 'essencial', now() + interval '2 days', null, null),
      ('${ATIVO}', 'active', 'essencial', null, now() + interval '20 days', null),
      ('${EXPIRADO}', 'expired', 'essencial', null, now() - interval '4 days', 'sub_2'),
      ('${PASTDUE}', 'past_due', 'pro', null, now() + interval '5 days', 'sub_3');
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  await db.exec(sql('20261108100000_admin_bloqueio_conta.sql'))
  await db.exec(sql('20261108110000_admin_plano_legado.sql'))
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
})

after(async () => {
  await db.close()
})

describe('origem_plano', () => {
  test('origem_plano preenchida: pro antigo sem stripe = legado, stripe = pago, resto = trial', async () => {
    assert.equal((await ass(LEGADO)).origem_plano, 'legado')
    assert.equal((await ass(PAGO)).origem_plano, 'pago')
    assert.equal((await ass(TRIAL)).origem_plano, 'trial')
    assert.equal((await ass(ATIVO)).origem_plano, 'trial')
  })

  test('trigger: nova linha trialing = trial; ao ganhar stripe_subscription_id vira pago', async () => {
    await db.exec(`insert into public.assinaturas (usuario_id, status, plan, trial_ends_at)
      values ('${NOVO}', 'trialing', 'pro', now() + interval '3 days')`)
    assert.equal((await ass(NOVO)).origem_plano, 'trial')
    await db.exec(`update public.assinaturas set status = 'active', stripe_subscription_id = 'sub_9' where usuario_id = '${NOVO}'`)
    assert.equal((await ass(NOVO)).origem_plano, 'pago')
    // legado que depois assina vira pago; atualização sem stripe não muda a origem
    await db.exec(`update public.assinaturas set updated_at = now() where usuario_id = '${LEGADO}'`)
    assert.equal((await ass(LEGADO)).origem_plano, 'legado')
  })

  test('check rejeita origem desconhecida', async () => {
    await assert.rejects(db.query(`update public.assinaturas set origem_plano = 'x' where usuario_id = '${LEGADO}'`), /check/)
  })
})

describe('admin_definir_plano', () => {
  test('definir_plano troca e registra no log (com plano anterior)', async () => {
    await como(ADMIN)
    await db.query(`select public.admin_definir_plano('${ATIVO}', 'pro')`)
    await db.exec('reset role')
    assert.equal((await ass(ATIVO)).plan, 'pro')
    const l = await um<{ detalhes: { plano: string; plano_anterior: string }; alvo_id: string }>(
      `select detalhes, alvo_id from public.admin_acoes_log where acao = 'definir_plano'`)
    assert.equal(l.alvo_id, ATIVO)
    assert.deepEqual([l.detalhes.plano, l.detalhes.plano_anterior], ['pro', 'essencial'])
  })

  test('mesmo plano é idempotente: sem erro e sem log duplicado', async () => {
    await como(ADMIN)
    await db.query(`select public.admin_definir_plano('${ATIVO}', 'pro')`)
    await db.exec('reset role')
    assert.equal(await logs('definir_plano'), 1)
  })

  test('definir_plano recusa plano inválido (22023)', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select public.admin_definir_plano('${ATIVO}', 'premium')`),
      (e: unknown) => (e as { code?: string }).code === '22023')
  })

  test('definir_plano em conta sem assinatura erra e não cria linha', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select public.admin_definir_plano('${SEM_ASSINATURA}', 'pro')`), /conta sem assinatura/)
    await db.exec('reset role')
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.assinaturas where usuario_id = '${SEM_ASSINATURA}'`)).n, 0)
  })
})

describe('admin_estender_vencimento', () => {
  test('estender soma dias ao trial', async () => {
    await db.exec('reset role')
    const antes = (await ass(TRIAL)).trial_ends_at!
    await como(ADMIN)
    await db.query(`select public.admin_estender_vencimento('${TRIAL}', 7)`)
    await db.exec('reset role')
    const depois = await ass(TRIAL)
    assert.equal(await diasEntre(depois.trial_ends_at!, antes), 7)
    const l = await um<{ detalhes: { dias: number; vencimento_anterior: string } }>(
      `select detalhes from public.admin_acoes_log where acao = 'estender_vencimento' and alvo_id = '${TRIAL}'`)
    assert.equal(l.detalhes.dias, 7)
    assert.ok(l.detalhes.vencimento_anterior)
  })

  test('estender soma dias ao período em conta ativa', async () => {
    const antes = (await ass(ATIVO)).current_period_end!
    await como(ADMIN)
    await db.query(`select public.admin_estender_vencimento('${ATIVO}', 30)`)
    await db.exec('reset role')
    assert.equal(await diasEntre((await ass(ATIVO)).current_period_end!, antes), 30)
  })

  test('estender recusa 0 e 366 dias (22023)', async () => {
    await como(ADMIN)
    for (const d of [0, 366, -1]) {
      await assert.rejects(db.query(`select public.admin_estender_vencimento('${ATIVO}', ${d})`),
        (e: unknown) => (e as { code?: string }).code === '22023')
    }
    await db.exec('reset role')
    assert.equal(await logs('estender_vencimento'), 2)
  })

  test('estender recusa conta expired e past_due (22023, sem log, datas intactas)', async () => {
    await db.exec('reset role')
    const antes = [await ass(EXPIRADO), await ass(PASTDUE)]
    const n = await logs('estender_vencimento')
    await como(ADMIN)
    for (const id of [EXPIRADO, PASTDUE]) {
      await assert.rejects(db.query(`select public.admin_estender_vencimento('${id}', 30)`),
        (e: unknown) => (e as { code?: string }).code === '22023' && /conta vencida/.test((e as Error).message))
    }
    await db.exec('reset role')
    assert.deepEqual([await ass(EXPIRADO), await ass(PASTDUE)], antes)
    assert.equal(await logs('estender_vencimento'), n)
  })

  test('estender sem vencimento a somar erra claramente; sem assinatura também', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select public.admin_estender_vencimento('${LEGADO}', 5)`), /sem vencimento/)
    await assert.rejects(db.query(`select public.admin_estender_vencimento('${SEM_ASSINATURA}', 5)`), /conta sem assinatura/)
  })
})

describe('permissões', () => {
  test('ambas exigem superadmin', async () => {
    for (const uid of [COMUM, LEGADO]) {
      await como(uid)
      await assert.rejects(db.query(`select public.admin_definir_plano('${ATIVO}', 'essencial')`),
        (e: unknown) => (e as { code?: string }).code === '42501' && /acesso negado/.test((e as Error).message))
      await assert.rejects(db.query(`select public.admin_estender_vencimento('${ATIVO}', 5)`), /acesso negado/)
    }
    await como(null, 'anon')
    await assert.rejects(db.query(`select public.admin_definir_plano('${ATIVO}', 'essencial')`), /permission denied/)
    await assert.rejects(db.query(`select public.admin_estender_vencimento('${ATIVO}', 5)`), /permission denied/)
  })
})
