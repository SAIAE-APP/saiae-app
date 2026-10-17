// Observabilidade do painel do superadmin: migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO1 = 'a1000000-0000-4000-8000-000000000001'
const DONO2 = 'a2000000-0000-4000-8000-000000000002'
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' | 'service_role' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

async function reportar(barraca: string, tipo = 'js', mensagem = 'boom', versao = 'v1', plataforma = 'android') {
  await db.query(`select public.registrar_erro_app($1, $2, $3, $4, $5)`, [barraca, tipo, mensagem, versao, plataforma])
}

async function erros() {
  await db.exec('reset role')
  return (await db.query<{ barraca_id: string; mensagem: string; versao_app: string; tipo: string }>(
    'select barraca_id, mensagem, versao_app, tipo from public.eventos_erro order by criado_em, id',
  )).rows
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, criado_em timestamptz not null default now(), cancelado_em timestamptz);
    create table public.superadmins (usuario_id uuid primary key);
    create table public.eventos_webhook_stripe (id uuid primary key default gen_random_uuid(), error text, received_at timestamptz not null default now());
    create table public.cardapio_pedidos_log (criado_em timestamptz);
    create table public.cliente_verificacoes_log (criado_em timestamptz);
    create table public.cliente_codigos (criado_em timestamptz, usado_em timestamptz, expira_em timestamptz);
    create function public.usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean language sql stable security definer
      as $$ select exists(select 1 from usuarios_barracas where barraca_id = p_barraca_id and usuario_id = auth.uid()) $$;
    grant usage on schema public to authenticated, service_role;
    insert into auth.users values ('${ADMIN}'), ('${DONO1}'), ('${DONO2}');
    insert into public.superadmins values ('${ADMIN}');
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1'), ('${B2}', 'Loja 2', 'loja-2');
    insert into public.usuarios_barracas values ('${DONO1}', '${B1}', 'dono'), ('${DONO2}', '${B2}', 'dono');
  `)
  await db.exec(sql('20261028120000_observabilidade.sql'))
})

after(async () => {
  await db.close()
})

describe('registrar_erro_app', () => {
  test('grava erro de quem tem acesso à barraca', async () => {
    await como(DONO1)
    await reportar(B1, 'sync', 'falha de rede', 'abc123', 'ios')
    const [e] = await erros()
    assert.equal(e.barraca_id, B1)
    assert.equal(e.tipo, 'sync')
    assert.equal(e.versao_app, 'abc123')
  })

  test('ignora barraca alheia, anon, tipo e plataforma inválidos, sem erro', async () => {
    const antes = (await erros()).length
    await como(DONO1)
    await reportar(B2)
    await reportar(B1, 'xyz')
    await reportar(B1, 'js', 'x', 'v1', 'windows')
    await reportar(B1, 'js', 'x', '', 'web')
    await como(null, 'anon')
    await assert.rejects(reportar(B1), /permission denied/)
    assert.equal((await erros()).length, antes)
  })

  test('tira e-mail e números longos e corta em 200 caracteres', async () => {
    await como(DONO1)
    await reportar(B1, 'js', 'falhou para joao@exemplo.com tel 61982694384 cpf 12345678901')
    await reportar(B1, 'js', 'x'.repeat(500))
    const todos = await erros()
    const limpo = todos.find((e) => e.mensagem.startsWith('falhou'))!
    assert.equal(limpo.mensagem, 'falhou para [email] tel [numero] cpf [numero]')
    assert.equal(todos.find((e) => e.mensagem.startsWith('xxx'))!.mensagem.length, 200)
  })

  test('limite de 60 por hora por usuário', async () => {
    await como(DONO2)
    for (let i = 0; i < 65; i++) await reportar(B2, 'js', `e${i}`, 'v-limite')
    await db.exec('reset role')
    const n = (await db.query<{ n: string }>(`select count(*) as n from public.eventos_erro where versao_app = 'v-limite'`)).rows[0].n
    assert.equal(Number(n), 60)
  })

  test('ninguém lê eventos_erro direto', async () => {
    await como(DONO1)
    await assert.rejects(db.query('select * from public.eventos_erro'), /permission denied/)
  })
})

describe('registrar_versao_app', () => {
  test('grava e atualiza a versão por barraca; barraca alheia é ignorada', async () => {
    await como(DONO1)
    await db.query(`select public.registrar_versao_app($1, 'v1', 'android')`, [B1])
    await db.query(`select public.registrar_versao_app($1, 'v2', 'ios')`, [B1])
    await db.query(`select public.registrar_versao_app($1, 'v9', 'web')`, [B2])
    await db.exec('reset role')
    const linhas = (await db.query<{ barraca_id: string; versao_app: string; plataforma: string }>(
      'select barraca_id, versao_app, plataforma from public.barracas_versao_app',
    )).rows
    assert.deepEqual(linhas, [{ barraca_id: B1, versao_app: 'v2', plataforma: 'ios' }])
  })
})

describe('painel', () => {
  test('saúde e alertas pelo painel só para superadmin', async () => {
    await como(DONO1)
    await assert.rejects(db.query('select * from public.admin_saude_barracas()'), /acesso negado/)
    await assert.rejects(db.query('select public.admin_alertas()'), /acesso negado/)
    await como(null, 'anon')
    await assert.rejects(db.query('select public.admin_alertas()'), /permission denied/)
  })

  test('saúde: pedidos 7 dias contra semana anterior, versão e erros 24 h', async () => {
    await db.exec(`reset role;
      insert into public.pedidos (barraca_id, criado_em) values
        ('${B1}', now() - interval '1 day'), ('${B1}', now() - interval '2 days'),
        ('${B1}', now() - interval '9 days'), ('${B1}', now() - interval '10 days'), ('${B1}', now() - interval '11 days');
      insert into public.pedidos (barraca_id, criado_em, cancelado_em) values ('${B1}', now() - interval '1 day', now());`)
    await como(ADMIN)
    const por = Object.fromEntries(
      (await db.query<Record<string, unknown>>('select * from public.admin_saude_barracas()')).rows.map((r) => [r.nome, r]),
    )
    assert.equal(Number(por['Loja 1'].pedidos_7d), 2)
    assert.equal(Number(por['Loja 1'].pedidos_semana_anterior), 3)
    assert.equal(por['Loja 1'].versao_app, 'v2')
    assert.equal(Number(por['Loja 1'].erros_24h), 3)
    assert.equal(por['Loja 2'].versao_app, null)
  })

  test('alerta de pico: 10 erros da mesma versão na última hora', async () => {
    await db.exec(`reset role;
      insert into public.eventos_erro (barraca_id, tipo, mensagem, versao_app, plataforma)
      select '${B1}', 'js', 'pico', 'v-pico', 'web' from generate_series(1, 10);
      insert into public.eventos_erro (barraca_id, tipo, mensagem, versao_app, plataforma)
      select '${B1}', 'js', 'quase', 'v-quase', 'web' from generate_series(1, 9);`)
    await como(ADMIN)
    const a = (await db.query<{ a: { pico_erros: { versao: string; erros: number }[] } }>('select public.admin_alertas() as a')).rows[0].a
    // v-limite (60 erros do teste de limite) também é pico de verdade; v-quase (9) não
    assert.deepEqual(a.pico_erros.map((p) => p.versao).sort(), ['v-limite', 'v-pico'])
  })

  test('alerta de webhook: 3 falhas da Stripe em 24 h; antigas e sem erro não contam', async () => {
    await db.exec(`reset role;
      insert into public.eventos_webhook_stripe (error) values ('x'), ('y');
      insert into public.eventos_webhook_stripe (error) values (null);
      insert into public.eventos_webhook_stripe (error, received_at) values ('velho', now() - interval '3 days');`)
    await como(ADMIN)
    const w = async () => (await db.query<{ a: { webhook_falhas: number } }>('select public.admin_alertas() as a')).rows[0].a.webhook_falhas
    assert.equal(await w(), 0)
    await db.exec(`reset role; insert into public.eventos_webhook_stripe (error) values ('z')`)
    await como(ADMIN)
    assert.equal(await w(), 3)
  })

  test('alerta de barraca que vendia e parou', async () => {
    await db.exec(`reset role;
      insert into public.pedidos (barraca_id, criado_em)
      select '${B2}', (((now() at time zone 'America/Sao_Paulo')::date - d)::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo'
        from unnest(array[9, 8, 7, 6, 5]) as d;`)
    await como(ADMIN)
    const a = (await db.query<{ a: { parou: { nome: string }[] } }>('select public.admin_alertas() as a')).rows[0].a
    assert.deepEqual(a.parou.map((b) => b.nome), ['Loja 2'])
  })

  test('o job (service_role) chama alertas_sistema; authenticated não', async () => {
    await como(null, 'service_role')
    assert.ok((await db.query('select public.alertas_sistema() as a')).rows.length === 1)
    await como(ADMIN)
    await assert.rejects(db.query('select public.alertas_sistema()'), /permission denied/)
  })
})

describe('retenção', () => {
  test('limpar_logs_antigos apaga erro com mais de 30 dias e mantém o recente', async () => {
    await db.exec(`reset role;
      insert into public.eventos_erro (barraca_id, tipo, mensagem, versao_app, plataforma, criado_em)
      values ('${B1}', 'js', 'velho', 'v-velho', 'web', now() - interval '31 days'),
             ('${B1}', 'js', 'novo', 'v-novo', 'web', now() - interval '29 days');
      select public.limpar_logs_antigos();`)
    const v = (await db.query<{ versao_app: string }>(`select versao_app from public.eventos_erro where versao_app in ('v-velho', 'v-novo')`)).rows
    assert.deepEqual(v.map((r) => r.versao_app), ['v-novo'])
  })
})
