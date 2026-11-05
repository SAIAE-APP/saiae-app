// Painel do superadmin, planos e prazos: migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO_TRIAL = 'a1000000-0000-4000-8000-000000000001'
const DONO_ATIVA = 'a2000000-0000-4000-8000-000000000002'
const DONO_VENCIDA = 'a3000000-0000-4000-8000-000000000003'
const DONO_CANCELADA = 'a4000000-0000-4000-8000-000000000004'
const DONO_SEM_ASSINATURA = 'a5000000-0000-4000-8000-000000000005'
const COMUM = 'a9000000-0000-4000-8000-000000000009'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

type Linha = {
  nome: string
  estado: string
  plano: string | null
  tem_acesso: boolean
  dias_restantes: number | null
  origem_cobranca: string | null
  ultimo_pagamento_em: string | null
  total: string
}

async function listar(args = 'null, null, 50, 0') {
  return (await db.query<Linha>(`select * from public.admin_listar_barracas(${args})`)).rows
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key default gen_random_uuid(), nome text, slug text, criada_em timestamptz default now());
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.assinaturas (
      usuario_id uuid primary key, status text not null, plan text, trial_ends_at timestamptz,
      current_period_end timestamptz, grace_until timestamptz, stripe_subscription_id text,
      updated_at timestamptz not null default now()
    );
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), event text, subscription_id text, error text,
      received_at timestamptz not null default now()
    );
    -- mesma regra de assinatura_tem_acesso, sem a chave global de cobrança
    create function public.assinatura_tem_acesso(p public.assinaturas, p_now timestamptz default now()) returns boolean
      language sql stable as $$
        select case p.status
          when 'trialing' then p.trial_ends_at is not null and p_now < p.trial_ends_at
          when 'active' then true
          when 'past_due' then p.grace_until is not null and p_now < p.grace_until
          when 'canceled' then p.current_period_end is not null and p_now < p.current_period_end
          else false end $$;
    grant usage on schema public to authenticated;

    insert into auth.users values
      ('${ADMIN}', 'admin@x.com'), ('${DONO_TRIAL}', 'trial@x.com'), ('${DONO_ATIVA}', 'ativa@x.com'),
      ('${DONO_VENCIDA}', 'vencida@x.com'), ('${DONO_CANCELADA}', 'cancelada@x.com'),
      ('${DONO_SEM_ASSINATURA}', 'sem@x.com'), ('${COMUM}', 'comum@x.com');
    insert into public.barracas (id, nome, slug) values
      ('b1000000-0000-4000-8000-000000000001', 'Trial', 'trial'),
      ('b2000000-0000-4000-8000-000000000002', 'Ativa', 'ativa'),
      ('b3000000-0000-4000-8000-000000000003', 'Vencida', 'vencida'),
      ('b4000000-0000-4000-8000-000000000004', 'Cancelada', 'cancelada'),
      ('b5000000-0000-4000-8000-000000000005', 'Sem assinatura', 'sem');
    insert into public.usuarios_barracas values
      ('${DONO_TRIAL}', 'b1000000-0000-4000-8000-000000000001', 'dono'),
      ('${DONO_ATIVA}', 'b2000000-0000-4000-8000-000000000002', 'dono'),
      ('${DONO_VENCIDA}', 'b3000000-0000-4000-8000-000000000003', 'dono'),
      ('${DONO_CANCELADA}', 'b4000000-0000-4000-8000-000000000004', 'dono'),
      ('${DONO_SEM_ASSINATURA}', 'b5000000-0000-4000-8000-000000000005', 'dono'),
      ('${COMUM}', 'b2000000-0000-4000-8000-000000000002', 'funcionario');
    insert into public.assinaturas (usuario_id, status, plan, trial_ends_at, current_period_end, stripe_subscription_id) values
      ('${DONO_TRIAL}', 'trialing', 'essencial', now() + interval '3 days 1 hour', null, null),
      ('${DONO_ATIVA}', 'active', 'pro', null, now() + interval '20 days', 'sub_1'),
      ('${DONO_VENCIDA}', 'trialing', 'essencial', now() - interval '2 days', null, null),
      ('${DONO_CANCELADA}', 'canceled', 'pro', null, now() + interval '5 days', 'sub_2');
    insert into public.eventos_webhook_stripe (event, subscription_id, received_at) values
      ('invoice.paid', 'sub_1', now() - interval '10 days'),
      ('invoice.paid', 'sub_1', now() - interval '1 day'),
      ('invoice.payment_failed', 'sub_1', now());
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  // privilégio padrão de tabela nova no Supabase; a migration revoga o que importa
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
})

after(async () => {
  await db.close()
})

describe('acesso', () => {
  test('conta fora da allowlist recebe erro genérico', async () => {
    await como(COMUM)
    await assert.rejects(listar(), /acesso negado/)
    await como(DONO_ATIVA)
    await assert.rejects(listar(), /acesso negado/)
  })

  test('anon não executa a função', async () => {
    await como(null, 'anon')
    await assert.rejects(listar(), /permission denied/)
  })

  test('ninguém lê a allowlist direto, nem o próprio superadmin', async () => {
    await como(ADMIN)
    await assert.rejects(db.query('select * from public.superadmins'), /permission denied/)
  })

  test('sou_superadmin só vale para quem está na allowlist', async () => {
    await como(ADMIN)
    assert.equal((await db.query<{ v: boolean }>('select public.sou_superadmin() as v')).rows[0].v, true)
    await como(COMUM)
    assert.equal((await db.query<{ v: boolean }>('select public.sou_superadmin() as v')).rows[0].v, false)
  })

  test('tirar da allowlist encerra o acesso na hora', async () => {
    await db.exec(`reset role; insert into public.superadmins (usuario_id) values ('${COMUM}')`)
    await como(COMUM)
    assert.equal((await listar()).length, 5)
    await db.exec(`reset role; delete from public.superadmins where usuario_id = '${COMUM}'`)
    await como(COMUM)
    await assert.rejects(listar(), /acesso negado/)
  })
})

describe('lista', () => {
  test('uma linha por barraca, com estado e acesso batendo com assinatura_tem_acesso', async () => {
    await como(ADMIN)
    const por = Object.fromEntries((await listar()).map((l) => [l.nome, l]))
    assert.equal(por['Trial'].estado, 'trial')
    assert.equal(por['Trial'].tem_acesso, true)
    assert.equal(por['Ativa'].estado, 'ativa')
    assert.equal(por['Vencida'].estado, 'vencida')
    assert.equal(por['Vencida'].tem_acesso, false)
    assert.equal(por['Cancelada'].estado, 'cancelada')
    assert.equal(por['Cancelada'].tem_acesso, true)
    assert.equal(por['Sem assinatura'].estado, 'vencida')
    assert.equal(por['Sem assinatura'].tem_acesso, false)
    assert.equal(por['Sem assinatura'].dias_restantes, null)
  })

  test('funcionário da barraca não duplica a linha', async () => {
    await como(ADMIN)
    assert.equal((await listar()).filter((l) => l.nome === 'Ativa').length, 1)
  })

  test('ordena pelo vencimento mais próximo, sem prazo por último', async () => {
    await como(ADMIN)
    assert.deepEqual((await listar()).map((l) => l.nome), ['Vencida', 'Trial', 'Cancelada', 'Ativa', 'Sem assinatura'])
  })

  test('dias restantes arredonda para cima; vencida fica negativa', async () => {
    await como(ADMIN)
    const por = Object.fromEntries((await listar()).map((l) => [l.nome, l]))
    assert.equal(por['Trial'].dias_restantes, 4)
    assert.equal(por['Vencida'].dias_restantes, -2)
  })

  test('origem e último pagamento só contam invoice.paid da própria assinatura', async () => {
    await como(ADMIN)
    const por = Object.fromEntries((await listar()).map((l) => [l.nome, l]))
    assert.equal(por['Ativa'].origem_cobranca, 'stripe')
    assert.ok(por['Ativa'].ultimo_pagamento_em)
    assert.equal(por['Trial'].origem_cobranca, null)
    assert.equal(por['Trial'].ultimo_pagamento_em, null)
    assert.equal(por['Cancelada'].ultimo_pagamento_em, null)
  })
})

describe('filtros e paginação', () => {
  test('vence_7d', async () => {
    await como(ADMIN)
    assert.deepEqual((await listar(`'vence_7d', null, 50, 0`)).map((l) => l.nome), ['Trial', 'Cancelada'])
  })

  test('trial_acabando', async () => {
    await como(ADMIN)
    assert.deepEqual((await listar(`'trial_acabando', null, 50, 0`)).map((l) => l.nome), ['Trial'])
  })

  test('vencida inclui a que nunca assinou', async () => {
    await como(ADMIN)
    assert.deepEqual((await listar(`'vencida', null, 50, 0`)).map((l) => l.nome), ['Vencida', 'Sem assinatura'])
  })

  test('plano', async () => {
    await como(ADMIN)
    assert.deepEqual((await listar(`null, 'pro', 50, 0`)).map((l) => l.nome), ['Cancelada', 'Ativa'])
  })

  test('valor inválido de filtro ou plano é recusado', async () => {
    await como(ADMIN)
    await assert.rejects(listar(`'qualquer', null, 50, 0`), /filtro invalido/)
    await assert.rejects(listar(`null, 'gratis', 50, 0`), /plano invalido/)
  })

  test('total vem em todas as linhas e ignora limite/offset', async () => {
    await como(ADMIN)
    const pagina = await listar('null, null, 2, 2')
    assert.equal(pagina.length, 2)
    assert.ok(pagina.every((l) => Number(l.total) === 5))
  })

  test('limite é travado entre 1 e 200 e offset negativo vira 0', async () => {
    await como(ADMIN)
    assert.equal((await listar('null, null, 0, -5')).length, 1)
    assert.equal((await listar('null, null, 9999, 0')).length, 5)
  })
})
