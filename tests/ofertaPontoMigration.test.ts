// Oferta 'ponto'/'fiscal': CHECKs, limite de 1 ponto em criar_barraca, admin_definir_plano e ia_limites_plano.
// Migrations reais no PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const MIG = '20261110100000_oferta_ponto_fiscal.sql'

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const U_PONTO = 'a1000000-0000-4000-8000-000000000001'
const U_ESSENCIAL = 'a2000000-0000-4000-8000-000000000002'
const U_PRO = 'a3000000-0000-4000-8000-000000000003'
const U_PONTO_2 = 'a4000000-0000-4000-8000-000000000004' // com 2 barracas criadas antes do limite
const U_LEGADO = 'a5000000-0000-4000-8000-000000000005'
const U_TRIAL = 'a6000000-0000-4000-8000-000000000006'

const MSG_PONTO = 'Sua assinatura cobre um ponto de venda. Para adicionar outro ponto, fale com o suporte.'
const MSG_ESSENCIAL = 'O plano Essencial permite só 1 barraca. Faça upgrade para o Pro pra criar mais.'

let db: PGlite

async function como(uid: string | null) {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role authenticated`)
}
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const criar = (uid: string, slug: string) => async () => {
  await como(uid)
  return db.query(`select public.criar_barraca('Loja ${slug}', '${slug}')`)
}
const donoDe = async (uid: string) =>
  (await um<{ n: number }>(`select count(*)::int as n from public.usuarios_barracas where usuario_id = '${uid}' and papel = 'dono'`)).n

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.app_config (chave text primary key, valor jsonb not null);
    create table public.barracas (
      id uuid primary key default gen_random_uuid(), nome text, slug text, modo text, verde_ate int, amarelo_ate int,
      metodos_pagamento_ativos jsonb, criada_em timestamptz default now()
    );
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    -- CHECKs originais de 20260922120000 (inline, como na produção)
    create table public.assinaturas (
      usuario_id uuid primary key, status text not null, plan text check (plan in ('essencial', 'pro')), cycle text,
      trial_ends_at timestamptz, current_period_end timestamptz, grace_until timestamptz, stripe_subscription_id text,
      updated_at timestamptz not null default now()
    );
    create table public.assinatura_ofertas (
      id uuid primary key default gen_random_uuid(),
      plano text not null check (plano in ('essencial', 'pro')),
      ciclo text not null check (ciclo in ('mensal', 'anual')),
      checkout_url text unique, offer_id text unique, ativo boolean not null default true,
      stripe_price_id text unique, unique (plano, ciclo)
    );
    create table public.ia_limites_plano (plano text primary key, conversas_mes integer not null check (conversas_mes >= 0));
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), event text, subscription_id text, error text,
      received_at timestamptz not null default now()
    );
    create function public.cobranca_ativa() returns boolean language sql stable as $$
      select coalesce((select valor <> 'false'::jsonb from public.app_config where chave = 'cobranca_ativa'), true) $$;
    create function public.slug_reservado(p text) returns boolean language sql stable as $$ select p = 'admin' $$;
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
      ('${ADMIN}', 'admin@x.com', '2026-09-01'), ('${U_PONTO}', 'p@x.com', '2026-11-01'), ('${U_ESSENCIAL}', 'e@x.com', '2026-11-01'),
      ('${U_PRO}', 'pro@x.com', '2026-11-01'), ('${U_PONTO_2}', 'p2@x.com', '2026-11-01'),
      ('${U_LEGADO}', 'l@x.com', '2026-10-01'), ('${U_TRIAL}', 't@x.com', '2026-11-01');
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at) values
      ('${U_ESSENCIAL}', 'active', 'essencial', null), ('${U_PRO}', 'active', 'pro', null),
      ('${U_LEGADO}', 'active', 'pro', null), ('${U_TRIAL}', 'trialing', 'essencial', now() + interval '3 days');
    insert into public.ia_limites_plano (plano, conversas_mes) values ('essencial', 100), ('pro', 500);
    insert into public.assinatura_ofertas (plano, ciclo, stripe_price_id) values ('essencial', 'mensal', 'price_antigo_e'), ('pro', 'anual', 'price_antigo_p');
    insert into public.barracas (id, nome, slug) values ('b1000000-0000-4000-8000-000000000001', 'Antiga', 'antiga');
    insert into public.usuarios_barracas values ('${U_ESSENCIAL}', 'b1000000-0000-4000-8000-000000000001', 'dono');
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  await db.exec(sql('20261108100000_admin_bloqueio_conta.sql'))
  await db.exec(sql('20261108110000_admin_plano_legado.sql'))
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
  // antes da migration o CHECK antigo recusa 'ponto'
  await assert.rejects(db.query(`insert into public.assinaturas (usuario_id, status, plan) values ('${U_PONTO}', 'active', 'ponto')`), /check/)
  await db.exec(sql(MIG))
  await db.exec(`
    insert into public.assinaturas (usuario_id, status, plan) values ('${U_PONTO}', 'active', 'ponto'), ('${U_PONTO_2}', 'active', 'ponto');
    insert into public.barracas (id, nome, slug) values
      ('b2000000-0000-4000-8000-000000000002', 'Um', 'um'), ('b3000000-0000-4000-8000-000000000003', 'Dois', 'dois');
    insert into public.usuarios_barracas values
      ('${U_PONTO_2}', 'b2000000-0000-4000-8000-000000000002', 'dono'), ('${U_PONTO_2}', 'b3000000-0000-4000-8000-000000000003', 'dono');
  `)
})

after(async () => {
  await db.close()
})

describe('CHECKs', () => {
  test('assinaturas.plan aceita ponto, essencial, pro e null; recusa fiscal e desconhecido', async () => {
    for (const p of ['ponto', 'essencial', 'pro']) {
      await db.exec(`update public.assinaturas set plan = '${p}' where usuario_id = '${U_LEGADO}'`)
    }
    await db.exec(`update public.assinaturas set plan = null where usuario_id = '${U_LEGADO}'`)
    await db.exec(`update public.assinaturas set plan = 'pro' where usuario_id = '${U_LEGADO}'`)
    for (const p of ['fiscal', 'premium']) {
      await assert.rejects(db.query(`update public.assinaturas set plan = '${p}' where usuario_id = '${U_LEGADO}'`), /check/)
    }
  })

  test('assinatura_ofertas aceita ponto (mensal/anual) e fiscal mensal; fiscal anual e plano desconhecido são recusados', async () => {
    await db.exec(`insert into public.assinatura_ofertas (plano, ciclo, stripe_price_id) values
      ('ponto', 'mensal', 'price_t1'), ('ponto', 'anual', 'price_t2'), ('fiscal', 'mensal', 'price_t3'),
      ('essencial', 'anual', 'price_t4'), ('pro', 'mensal', 'price_t5')`)
    await assert.rejects(db.query(`insert into public.assinatura_ofertas (plano, ciclo, stripe_price_id) values ('fiscal', 'anual', 'price_x')`), /check/)
    await assert.rejects(db.query(`insert into public.assinatura_ofertas (plano, ciclo, stripe_price_id) values ('premium', 'mensal', 'price_y')`), /check/)
  })

  test('legados intactos e migration reexecutável sem criar ofertas', async () => {
    const o = await um<{ n: number }>(`select count(*)::int as n from public.assinatura_ofertas where stripe_price_id in ('price_antigo_e', 'price_antigo_p')`)
    assert.equal(o.n, 2)
    const a = await um<{ plan: string; status: string }>(`select plan, status from public.assinaturas where usuario_id = '${U_ESSENCIAL}'`)
    assert.deepEqual([a.plan, a.status], ['essencial', 'active'])
    const antes = (await um<{ n: number }>(`select count(*)::int as n from public.assinatura_ofertas`)).n
    await db.exec(sql(MIG))
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.assinatura_ofertas`)).n, antes)
  })
})

describe('criar_barraca: limite de 1 ponto', () => {
  test('ponto sem barraca cria a primeira; a segunda é negada com a mensagem exata', async () => {
    await criar(U_PONTO, 'ponto-1')()
    await assert.rejects(criar(U_PONTO, 'ponto-2')(), (e: unknown) => (e as Error).message === MSG_PONTO)
    await db.exec('reset role')
    assert.equal(await donoDe(U_PONTO), 1)
  })

  test('essencial mantém a mensagem antiga', async () => {
    await assert.rejects(criar(U_ESSENCIAL, 'ess-2')(), (e: unknown) => (e as Error).message === MSG_ESSENCIAL)
  })

  test('pro continua criando várias', async () => {
    await criar(U_PRO, 'pro-1')()
    await criar(U_PRO, 'pro-2')()
    await criar(U_PRO, 'pro-3')()
    await db.exec('reset role')
    assert.equal(await donoDe(U_PRO), 3)
  })

  test('trial essencial segue limitado; sem assinatura segue sem limite', async () => {
    await criar(U_TRIAL, 'trial-1')()
    await assert.rejects(criar(U_TRIAL, 'trial-2')(), (e: unknown) => (e as Error).message === MSG_ESSENCIAL)
    await criar(ADMIN, 'adm-1')()
    await criar(ADMIN, 'adm-2')()
  })

  test('quem já tem 2 barracas no ponto não é afetado: mantém as 2 e só a criação nova é barrada', async () => {
    await db.exec('reset role')
    assert.equal(await donoDe(U_PONTO_2), 2)
    await assert.rejects(criar(U_PONTO_2, 'ponto2-3')(), (e: unknown) => (e as Error).message === MSG_PONTO)
    await db.exec('reset role')
    assert.equal(await donoDe(U_PONTO_2), 2)
  })

  test('cobrança desligada: ponto também fica sem limite (igual ao essencial)', async () => {
    await db.exec(`reset role; insert into public.app_config (chave, valor) values ('cobranca_ativa', 'false'::jsonb)`)
    await criar(U_PONTO, 'ponto-livre')()
    await db.exec(`reset role; delete from public.app_config where chave = 'cobranca_ativa'`)
  })
})

describe('admin e IA', () => {
  test('admin_definir_plano aceita ponto e registra o log; fiscal segue recusado', async () => {
    await como(ADMIN)
    await db.query(`select public.admin_definir_plano('${U_ESSENCIAL}', 'ponto')`)
    await assert.rejects(db.query(`select public.admin_definir_plano('${U_ESSENCIAL}', 'fiscal')`),
      (e: unknown) => (e as { code?: string }).code === '22023')
    await db.exec('reset role')
    assert.equal((await um<{ plan: string }>(`select plan from public.assinaturas where usuario_id = '${U_ESSENCIAL}'`)).plan, 'ponto')
    const l = await um<{ detalhes: { plano: string; plano_anterior: string } }>(
      `select detalhes from public.admin_acoes_log where acao = 'definir_plano' and alvo_id = '${U_ESSENCIAL}'`)
    assert.deepEqual([l.detalhes.plano, l.detalhes.plano_anterior], ['ponto', 'essencial'])
  })

  test('admin_listar_barracas: filtro de plano valida ponto, recusa desconhecido (22023)', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select * from public.admin_listar_barracas(null, 'premium', 10, 0, null, 'nova')`),
      (e: unknown) => (e as { code?: string }).code === '22023')
    // o corpo completo usa tabelas fora deste cenário: aqui só importa que 'ponto' passe da validação.
    await db.query(`select * from public.admin_listar_barracas(null, 'ponto', 10, 0, null, 'nova')`).catch((e: { code?: string; message: string }) => {
      assert.notEqual(e.code, '22023', e.message)
    })
  })

  test('ia_limites_plano: ponto herda o limite do pro; essencial e pro não mudam', async () => {
    await db.exec('reset role')
    const r = await db.query<{ plano: string; conversas_mes: number }>(`select plano, conversas_mes from public.ia_limites_plano order by plano`)
    assert.deepEqual(r.rows, [
      { plano: 'essencial', conversas_mes: 100 }, { plano: 'ponto', conversas_mes: 500 }, { plano: 'pro', conversas_mes: 500 },
    ])
  })
})
