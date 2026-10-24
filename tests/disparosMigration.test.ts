// WhatsApp disparos (fase 3): migrations de colunas, proteção, RPC da avaliação e público. PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ler = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const M1 = '20261101100000_disparos_whatsapp.sql'
const M2 = '20261101110000_disparos_publico.sql'
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const FORA = 'a9000000-0000-4000-8000-000000000009'

describe('texto das migrations', () => {
  const m1 = ler(M1)
  const m2 = ler(M2)
  test('rollback no cabeçalho', () => {
    assert.match(m1.split('\n')[0], /^-- Rollback:/)
    assert.match(m2.split('\n')[0], /^-- Rollback:/)
  })
  test('colunas com default false e limite de texto', () => {
    assert.match(m1, /whatsapp_disparos_habilitado boolean not null default false/)
    assert.match(m1, /avaliacao_ativa boolean not null default false/)
    assert.match(m1, /char_length\(avaliacao_texto\) <= 500/)
  })
  test('funções security definer com search_path fixo', () => {
    assert.equal((m2.match(/security definer/g) ?? []).length, 3)
    assert.equal((m2.match(/set search_path = public, pg_temp/g) ?? []).length, 3)
    assert.match(m1, /security definer\s+set search_path = public, pg_temp/)
  })
  test('grants: service_role nas de plataforma, authenticated só na RPC da avaliação, nada para anon', () => {
    for (const f of ['disparos_publico(uuid, text, integer)', 'disparos_publico_contagem(uuid, text, integer)', 'integracao_avaliacao_config(uuid)']) {
      assert.ok(m2.includes(`revoke all on function public.${f} from public, anon, authenticated`), f)
      assert.ok(m2.includes(`grant execute on function public.${f} to service_role`), f)
    }
    assert.match(m1, /grant execute on function public\.whatsapp_avaliacao_salvar\(uuid, boolean, text\) to authenticated/)
    assert.doesNotMatch(m1 + m2, /grant[^;]*to[^;]*\banon\b/i)
    assert.doesNotMatch(m2, /to authenticated/)
  })
})

describe('banco (PGlite)', () => {
  let db: PGlite
  const como = (uid: string | null, papel = 'authenticated') =>
    db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
  const salvar = async (b: string, ativa: boolean, texto: string | null) =>
    (await db.query<{ r: { estado: string } }>('select public.whatsapp_avaliacao_salvar($1, $2, $3) as r', [b, ativa, texto])).rows[0].r.estado

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth; grant usage on schema auth to authenticated, anon, service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.barracas (id uuid primary key, nome text, ia_whatsapp_dono text, whatsapp_pedidos text);
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
        select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
      create table public.clientes_finais (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, telefone text,
        consentimento_marketing_em timestamptz, criado_em timestamptz not null default now());
      create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid, status text, criado_em timestamptz not null default now(),
        cliente_id uuid, cliente_telefone text, entrega_telefone text);
      grant usage on schema public to authenticated, anon, service_role;
      grant select, insert, update on public.barracas to authenticated, service_role;
      insert into public.barracas values ('${B1}', 'Loja 1', '5561999990000', null), ('${B2}', 'Loja 2', null, null);
      insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono');
    `)
    await db.exec(ler(M1))
    await db.exec(ler(M1)) // idempotente
    await db.exec(ler(M2))
    await db.exec(ler(M2))
  })
  after(async () => {
    await db.close()
  })

  test('módulo desligado: RPC da avaliação recusa; sem acesso e sem login também', async () => {
    await como(DONO)
    assert.equal(await salvar(B1, true, null), 'modulo_desligado')
    await como(FORA)
    assert.equal(await salvar(B1, true, null), 'sem_acesso')
    await como(null)
    assert.equal(await salvar(B1, true, null), 'nao_autenticado')
  })

  test('authenticated não liga o módulo nem muda a avaliação por update direto; service_role liga', async () => {
    await como(DONO)
    await assert.rejects(db.exec(`update public.barracas set whatsapp_disparos_habilitado = true where id = '${B1}'`), /disparos_use_a_tela/)
    await assert.rejects(db.exec(`update public.barracas set avaliacao_ativa = true where id = '${B1}'`), /disparos_use_a_tela/)
    await assert.rejects(db.exec(`update public.barracas set avaliacao_texto = 'x' where id = '${B1}'`), /disparos_use_a_tela/)
    await assert.rejects(
      db.exec(`insert into public.barracas (id, nome, whatsapp_disparos_habilitado) values (gen_random_uuid(), 'x', true)`),
      /disparos_use_a_tela/,
    )
    await db.exec(`update public.barracas set nome = 'Loja 1' where id = '${B1}'`)
    await como(null, 'service_role')
    await db.exec(`update public.barracas set whatsapp_disparos_habilitado = true where id = '${B1}'`)
  })

  test('módulo ligado: RPC valida texto e grava; config reflete', async () => {
    await como(DONO)
    assert.equal(await salvar(B1, true, '   '), 'dados_invalidos')
    assert.equal(await salvar(B1, true, ''), 'dados_invalidos')
    assert.equal(await salvar(B1, true, 'x'.repeat(501)), 'dados_invalidos')
    assert.equal(await salvar(B1, true, 'Olá {nome}!'), 'ok')
    await como(null, 'service_role')
    const r = await db.query<{ c: unknown }>('select public.integracao_avaliacao_config($1) as c', [B1])
    assert.deepEqual(r.rows[0].c, { ativo: true, texto: 'Olá {nome}!', whatsapp_dono: '5561999990000', barraca_nome: 'Loja 1' })
    await como(DONO)
    assert.equal(await salvar(B1, false, null), 'ok')
    await como(null, 'service_role')
    const r2 = await db.query<{ c: { ativo: boolean; texto: string | null } }>('select public.integracao_avaliacao_config($1) as c', [B1])
    assert.equal(r2.rows[0].c.ativo, false)
    assert.equal(r2.rows[0].c.texto, null)
  })

  test('público: só consentidos, ignora cancelados, reativação por inatividade, mais recentes primeiro, isolado por loja', async () => {
    await db.exec(`reset role`)
    await db.exec(`
      insert into public.clientes_finais (id, barraca_id, nome, telefone, consentimento_marketing_em, criado_em) values
        ('c0000000-0000-4000-8000-000000000001', '${B1}', 'Ana', '61900000001', now(), now() - interval '100 days'),
        ('c0000000-0000-4000-8000-000000000002', '${B1}', 'Beto', '61900000002', now(), now() - interval '100 days'),
        ('c0000000-0000-4000-8000-000000000003', '${B1}', 'Caio', '61900000003', null, now() - interval '100 days'),
        ('c0000000-0000-4000-8000-000000000004', '${B1}', 'Duda', '61900000004', now(), now() - interval '40 days'),
        ('c0000000-0000-4000-8000-000000000005', '${B1}', 'Eva', '61900000005', now(), now() - interval '100 days'),
        ('c0000000-0000-4000-8000-000000000006', '${B2}', 'Fora', '61900000006', now(), now() - interval '100 days');
      insert into public.pedidos (barraca_id, status, criado_em, cliente_id) values
        ('${B1}', 'entregue', now() - interval '5 days', 'c0000000-0000-4000-8000-000000000001');
      insert into public.pedidos (barraca_id, status, criado_em, cliente_telefone) values
        ('${B1}', 'entregue', now() - interval '50 days', '61900000002'),
        ('${B1}', 'cancelado', now() - interval '1 day', '61900000005');
    `)
    await db.exec(`set role service_role`)
    const q = async (tipo: string, dias: number | null) =>
      (await db.query<{ nome: string }>('select * from public.disparos_publico($1, $2, $3)', [B1, tipo, dias])).rows.map((x) => x.nome)
    assert.deepEqual(await q('promocao', null), ['Ana', 'Duda', 'Beto', 'Eva'])
    assert.deepEqual(await q('reativacao', 30), ['Duda', 'Beto', 'Eva'])
    assert.deepEqual(await q('reativacao', 60), ['Eva'])
    assert.equal((await db.query<{ n: number }>('select public.disparos_publico_contagem($1, $2, $3) as n', [B1, 'promocao', null])).rows[0].n, 4)
    await assert.rejects(q('outro', null), /tipo_invalido/)
    await assert.rejects(q('reativacao', null), /dias_invalido/)
  })

  test('authenticated e anon não executam as RPCs de plataforma', async () => {
    await como(DONO)
    await assert.rejects(db.query(`select * from public.disparos_publico('${B1}', 'promocao', null)`), /permission denied/)
    await assert.rejects(db.query(`select public.integracao_avaliacao_config('${B1}')`), /permission denied/)
    await como(null, 'anon')
    await assert.rejects(db.query(`select public.disparos_publico_contagem('${B1}', 'promocao', null)`), /permission denied/)
  })
})
