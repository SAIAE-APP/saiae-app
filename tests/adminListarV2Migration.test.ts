// Painel do superadmin, lista v2 (busca, ordem, filtros novos, saúde, contagens): migration real no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const U_ZE = 'a1000000-0000-4000-8000-000000000001'
const U_PRO = 'a2000000-0000-4000-8000-000000000002'
const U_VENC = 'a3000000-0000-4000-8000-000000000003'
const U_ARQ = 'a4000000-0000-4000-8000-000000000004'
const U_SEM = 'a5000000-0000-4000-8000-000000000005'
const COMUM = 'a9000000-0000-4000-8000-000000000009'
const B_ZE = 'b1000000-0000-4000-8000-000000000001'
const B_PRO = 'b2000000-0000-4000-8000-000000000002'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

type Linha = Record<string, unknown> & { nome: string; total: string }
const listar = async (args = 'null, null, 50, 0') =>
  (await db.query<Linha>(`select * from public.admin_listar_barracas(${args})`)).rows
const nomes = async (args: string) => (await listar(args)).map((l) => l.nome)
const erro = (code: string) => (e: unknown) => (e as { code?: string }).code === code

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key default gen_random_uuid(), nome text, slug text,
      criada_em timestamptz default now(), arquivada_em timestamptz);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.assinaturas (
      usuario_id uuid primary key, status text not null, plan text, trial_ends_at timestamptz,
      current_period_end timestamptz, grace_until timestamptz, stripe_subscription_id text,
      updated_at timestamptz not null default now(),
      bloqueada_admin boolean not null default false, bloqueio_motivo text, origem_plano text not null default 'trial'
    );
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), event text, subscription_id text, error text,
      received_at timestamptz not null default now()
    );
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid,
      cancelado_em timestamptz, criado_em timestamptz not null default now());
    create table public.eventos_erro (id uuid primary key default gen_random_uuid(), barraca_id uuid,
      criado_em timestamptz not null default now());
    create table public.barracas_versao_app (barraca_id uuid primary key, versao_app text, plataforma text);
    create function public.assinatura_tem_acesso(p public.assinaturas, p_now timestamptz default now()) returns boolean
      language sql stable as $$ select not p.bloqueada_admin and p.status in ('active', 'trialing') $$;
    grant usage on schema public to authenticated;

    insert into auth.users values
      ('${ADMIN}', 'admin@x.com'), ('${U_ZE}', 'dona.maria@x.com'), ('${U_PRO}', 'pro@x.com'),
      ('${U_VENC}', 'venc@x.com'), ('${U_ARQ}', 'arq@x.com'), ('${U_SEM}', 'sem@x.com'), ('${COMUM}', 'comum@x.com');
    insert into public.barracas (id, nome, slug, criada_em, arquivada_em) values
      ('${B_ZE}', 'Barraca do Zé', 'ze', now() - interval '10 days', null),
      ('${B_PRO}', 'Pastelaria 100%_', 'pasteis', now() - interval '5 days', null),
      ('b3000000-0000-4000-8000-000000000003', 'Vencida', 'vencida', now() - interval '20 days', null),
      ('b4000000-0000-4000-8000-000000000004', 'Arquivada', 'arq', now() - interval '30 days', now() - interval '2 days'),
      ('b5000000-0000-4000-8000-000000000005', 'Sem assinatura', 'sem', now() - interval '1 day', null);
    insert into public.usuarios_barracas values
      ('${U_ZE}', '${B_ZE}', 'dono'), ('${U_PRO}', '${B_PRO}', 'dono'),
      ('${U_VENC}', 'b3000000-0000-4000-8000-000000000003', 'dono'),
      ('${U_ARQ}', 'b4000000-0000-4000-8000-000000000004', 'dono'),
      ('${U_SEM}', 'b5000000-0000-4000-8000-000000000005', 'dono'),
      ('${COMUM}', '${B_ZE}', 'funcionario');
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at, current_period_end, origem_plano,
                                    bloqueada_admin, bloqueio_motivo) values
      ('${U_ZE}', 'trialing', 'essencial', now() + interval '3 days', null, 'trial', false, null),
      ('${U_PRO}', 'active', 'pro', null, now() + interval '20 days', 'legado', true, 'chargeback'),
      ('${U_VENC}', 'past_due', 'essencial', null, now() - interval '3 days', 'trial', false, null),
      ('${U_ARQ}', 'past_due', 'pro', null, now() - interval '9 days', 'legado', false, null);

    -- saúde da B_ZE: 3 pedidos nos 7 dias (1 cancelado extra), 2 na semana anterior, 2 erros em 24 h (1 antigo)
    insert into public.pedidos (barraca_id, criado_em, cancelado_em) values
      ('${B_ZE}', now() - interval '1 hour', null), ('${B_ZE}', now() - interval '2 days', null),
      ('${B_ZE}', now() - interval '6 days', null), ('${B_ZE}', now() - interval '1 day', now()),
      ('${B_ZE}', now() - interval '9 days', null), ('${B_ZE}', now() - interval '13 days', null),
      ('${B_PRO}', now() - interval '3 days', null);
    insert into public.eventos_erro (barraca_id, criado_em) values
      ('${B_ZE}', now() - interval '1 hour'), ('${B_ZE}', now() - interval '3 hours'), ('${B_ZE}', now() - interval '3 days');
    insert into public.barracas_versao_app values ('${B_ZE}', '1.4.2', 'android');
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  await db.exec(sql('20261108130000_admin_listar_v2.sql'))
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
  await como(ADMIN)
})

after(async () => {
  await db.close()
})

describe('admin_listar_barracas v2', () => {
  test('chamada antiga de 4 argumentos segue valendo e esconde arquivadas', async () => {
    const l = await listar()
    assert.deepEqual(l.map((x) => x.nome).sort(), ['Barraca do Zé', 'Pastelaria 100%_', 'Sem assinatura', 'Vencida'])
    assert.equal(Number(l[0].total), 4)
  })

  test('acesso: só superadmin; anon sem permissão', async () => {
    await como(COMUM)
    await assert.rejects(listar(), erro('42501'))
    await assert.rejects(db.query('select * from public.admin_contar_filtros()'), erro('42501'))
    await como(null, 'anon')
    await assert.rejects(listar(), /permission denied/)
    await como(ADMIN)
  })

  test('busca acha por nome, slug e e-mail do dono', async () => {
    assert.deepEqual(await nomes(`null, null, 50, 0, 'ZÉ'`), ['Barraca do Zé'])
    assert.deepEqual(await nomes(`null, null, 50, 0, 'pasteis'`), ['Pastelaria 100%_'])
    assert.deepEqual(await nomes(`null, null, 50, 0, 'DONA.MARIA'`), ['Barraca do Zé'])
    assert.deepEqual(await nomes(`null, null, 50, 0, '   '`).then((n) => n.length), 4)
    assert.deepEqual(await nomes(`null, null, 50, 0, 'nada-disso'`), [])
  })

  test('busca trata % e _ como texto literal', async () => {
    assert.deepEqual(await nomes(`null, null, 50, 0, '%'`), ['Pastelaria 100%_'])
    assert.deepEqual(await nomes(`null, null, 50, 0, '_'`), ['Pastelaria 100%_'])
    assert.deepEqual(await nomes(`null, null, 50, 0, '100%_'`), ['Pastelaria 100%_'])
  })

  test('ordem inválida levanta 22023; filtro inválido também', async () => {
    await assert.rejects(listar(`null, null, 50, 0, null, 'aleatoria'`), erro('22023'))
    await assert.rejects(listar(`'todas', null, 50, 0`), erro('22023'))
  })

  test('ordens: nome, nova, atividade, vencimento', async () => {
    assert.deepEqual(await nomes(`null, null, 50, 0, null, 'nome'`), ['Barraca do Zé', 'Pastelaria 100%_', 'Sem assinatura', 'Vencida'])
    assert.deepEqual(await nomes(`null, null, 50, 0, null, 'nova'`), ['Sem assinatura', 'Pastelaria 100%_', 'Barraca do Zé', 'Vencida'])
    // Zé tem pedido há 1 h, Pastelaria há 3 dias; os outros sem pedido vão por último (por nome)
    assert.deepEqual(await nomes(`null, null, 50, 0, null, 'atividade'`), ['Barraca do Zé', 'Pastelaria 100%_', 'Sem assinatura', 'Vencida'])
    // vencimento: Vencida (-3 d), Zé (+3 d), Pastelaria (+20 d), sem prazo por último
    assert.deepEqual(await nomes(`null, null, 50, 0, null, 'vencimento'`), ['Vencida', 'Barraca do Zé', 'Pastelaria 100%_', 'Sem assinatura'])
  })

  test('arquivada só aparece no filtro arquivada', async () => {
    assert.deepEqual(await nomes(`'arquivada', null, 50, 0`), ['Arquivada'])
    for (const f of ['vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado']) {
      assert.ok(!(await nomes(`'${f}', null, 50, 0`)).includes('Arquivada'), f)
    }
    // legado e past_due, mas arquivada: segue fora dos filtros comuns
    assert.deepEqual(await nomes(`'legado', null, 50, 0`), ['Pastelaria 100%_'])
  })

  test('filtro bloqueada e legado', async () => {
    const b = await listar(`'bloqueada', null, 50, 0`)
    assert.deepEqual(b.map((x) => x.nome), ['Pastelaria 100%_'])
    assert.equal(b[0].bloqueada, true)
    assert.equal(b[0].bloqueio_motivo, 'chargeback')
    assert.equal(b[0].usuario_id, U_PRO)
    assert.equal(b[0].origem_plano, 'legado')
    assert.deepEqual(await nomes(`'legado', null, 50, 0`), ['Pastelaria 100%_'])
  })

  test('colunas de saúde vêm preenchidas e zeradas quando não há dados', async () => {
    const ze = (await listar(`null, null, 50, 0, 'ze'`))[0]
    assert.equal(Number(ze.pedidos_7d), 3) // cancelado não conta
    assert.equal(Number(ze.pedidos_semana_anterior), 2)
    assert.equal(Number(ze.erros_24h), 2)
    assert.equal(ze.versao_app, '1.4.2')
    assert.equal(ze.plataforma, 'android')
    const sem = (await listar(`null, null, 50, 0, 'sem assinatura'`))[0]
    assert.equal(Number(sem.pedidos_7d), 0)
    assert.equal(Number(sem.erros_24h), 0)
    assert.equal(sem.versao_app, null)
    assert.equal(sem.bloqueada, false)
  })

  test('paginação mantém o total', async () => {
    const l = await listar('null, null, 2, 2')
    assert.equal(l.length, 2)
    assert.equal(Number(l[0].total), 4)
  })
})

describe('admin_contar_filtros', () => {
  test('contagens batem com as listas', async () => {
    const c = Object.fromEntries(
      (await db.query<{ filtro: string; total: string }>('select * from public.admin_contar_filtros()')).rows.map((r) => [r.filtro, Number(r.total)]),
    )
    assert.deepEqual(Object.keys(c), ['todas', 'vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado', 'arquivada'])
    assert.equal(c.todas, (await listar()).length)
    for (const f of ['vence_7d', 'trial_acabando', 'vencida', 'bloqueada', 'legado', 'arquivada']) {
      assert.equal(c[f], (await listar(`'${f}', null, 50, 0`)).length, f)
    }
    assert.equal(c.todas, 4)
    assert.equal(c.arquivada, 1)
    assert.equal(c.bloqueada, 1)
  })
})
