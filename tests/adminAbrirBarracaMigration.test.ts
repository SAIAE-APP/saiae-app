// Abrir barraca pelo painel, somente leitura: migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const ADMIN2 = 'a8000000-0000-4000-8000-000000000008'
const COMUM = 'a9000000-0000-4000-8000-000000000009'
const DONO1 = 'a1000000-0000-4000-8000-000000000001'
const DONO2 = 'a2000000-0000-4000-8000-000000000002'
const FUNC1 = 'a3000000-0000-4000-8000-000000000003'
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const P_ABERTO = 'c1000000-0000-4000-8000-000000000001'
const P_ENTREGUE = 'c2000000-0000-4000-8000-000000000002'
const P_CANCELADO = 'c3000000-0000-4000-8000-000000000003'
const P_OUTRA = 'c4000000-0000-4000-8000-000000000004'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

async function abrir(barraca = B1): Promise<string> {
  const r = await db.query<{ r: { acesso_id: string } }>('select public.admin_abrir_barraca_leitura($1) as r', [barraca])
  return r.rows[0].r.acesso_id
}

type Pedido = { pedido_id: string; status: string; cliente_primeiro_nome: string | null; telefone_mascarado: string | null; total_centavos: string; total: string }
async function pedidos(acesso: string, filtro: string | null = null, limite = 30, offset = 0) {
  return (await db.query<Pedido>('select * from public.admin_barraca_pedidos($1, $2, $3, $4)', [acesso, filtro, limite, offset])).rows
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (
      id uuid primary key, nome text, slug text, criada_em timestamptz default now(), fuso text default 'America/Sao_Paulo',
      modos_atendimento text[] default '{balcao}', taxa_entrega_habilitada boolean default false, taxa_entrega_centavos integer default 0,
      pagamento_provedor text default 'mercadopago', pagamento_online_habilitado boolean default false,
      pagar_na_entrega_habilitado boolean default false, fiscal_habilitado boolean default false, impressora_habilitada boolean default false,
      ia_habilitada boolean default false, cupons_habilitado boolean default false, opcoes_habilitado boolean default false,
      estoque_bloqueia boolean default false, bloquear_fora_do_horario boolean default false, onboarding_concluido_em timestamptz,
      cnpj text default '12345678000199', ia_whatsapp_dono text default '5561999990000', whatsapp_pedidos text default '5561988880000'
    );
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.assinaturas (usuario_id uuid primary key, status text, plan text, trial_ends_at timestamptz, current_period_end timestamptz);
    create table public.pedidos (
      id uuid primary key, barraca_id uuid not null, senha integer, status text not null default 'a_fazer',
      criado_em timestamptz not null default now(), data_operacao date not null default current_date, tipo_atendimento text,
      metodo_pagamento text, cliente_nome text, cliente_telefone text, entrega_rua text, entrega_numero text,
      entrega_bairro text, entrega_referencia text
    );
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid(), pedido_id uuid, preco_centavos_unitario integer, quantidade integer, removido boolean not null default false);
    create table public.caixas (id uuid primary key default gen_random_uuid(), barraca_id uuid, data date, status text, valor_abertura_centavos integer,
      valor_fechamento_centavos integer, valor_esperado_centavos integer, diferenca_centavos integer, aberto_em timestamptz default now(), fechado_em timestamptz);
    create table public.superadmins (usuario_id uuid primary key);
    create table public.usuarios_suporte (usuario_id uuid primary key);
    alter table public.pedidos enable row level security;
    alter table public.caixas enable row level security;
    alter table public.barracas enable row level security;
    grant usage on schema public to authenticated, anon;
    grant select, insert, update, delete on public.pedidos, public.caixas, public.barracas to authenticated;

    insert into auth.users values ('${ADMIN}'), ('${ADMIN2}'), ('${COMUM}'), ('${DONO1}'), ('${DONO2}'), ('${FUNC1}');
    insert into public.barracas (id, nome, slug) values ('${B1}', 'Loja 1', 'loja-1'), ('${B2}', 'Loja 2', 'loja-2');
    insert into public.usuarios_barracas values ('${DONO1}', '${B1}', 'dono'), ('${FUNC1}', '${B1}', 'funcionario'), ('${DONO2}', '${B2}', 'dono');
    insert into public.assinaturas values ('${DONO1}', 'active', 'pro', null, now() + interval '20 days');
    insert into public.pedidos (id, barraca_id, senha, status, tipo_atendimento, metodo_pagamento, cliente_nome, cliente_telefone, entrega_rua, entrega_numero, entrega_bairro, entrega_referencia) values
      ('${P_ABERTO}', '${B1}', 1, 'a_fazer', 'entrega', 'pix', 'Maria da Silva', '61982694384', 'Rua das Flores', '12', 'Centro', 'perto da praça'),
      ('${P_ENTREGUE}', '${B1}', 2, 'entregue', 'balcao', 'dinheiro', null, null, null, null, null, null),
      ('${P_CANCELADO}', '${B1}', 3, 'cancelado', 'balcao', 'pix', null, null, null, null, null, null),
      ('${P_OUTRA}', '${B2}', 1, 'a_fazer', 'balcao', 'pix', 'Joao', '61911112222', null, null, null, null);
    insert into public.itens_do_pedido (pedido_id, preco_centavos_unitario, quantidade, removido) values
      ('${P_ABERTO}', 1000, 2, false), ('${P_ABERTO}', 500, 1, false), ('${P_ABERTO}', 9999, 1, true),
      ('${P_ENTREGUE}', 700, 1, false), ('${P_CANCELADO}', 800, 1, false), ('${P_OUTRA}', 300, 1, false);
    insert into public.caixas (barraca_id, data, status, valor_abertura_centavos) values ('${B1}', current_date, 'aberto', 5000), ('${B2}', current_date, 'aberto', 1);
  `)
  await db.exec(`insert into public.superadmins values ('${ADMIN}')`) // antes da migration: o backfill cobre
  await db.exec(sql('20261028140000_admin_abrir_barraca.sql'))
  await db.exec(sql('20261028150000_superadmin_vira_suporte.sql'))
  await db.exec(`insert into public.superadmins values ('${ADMIN2}')`) // depois: o gatilho cobre
})

after(async () => {
  await db.close()
})

describe('abertura e log', () => {
  test('conta fora da allowlist e anon não abrem', async () => {
    await como(COMUM)
    await assert.rejects(abrir(), /acesso negado/)
    await como(DONO1)
    await assert.rejects(abrir(), /acesso negado/)
    await como(null, 'anon')
    await assert.rejects(abrir(), /permission denied/)
  })

  test('barraca inexistente é recusada', async () => {
    await como(ADMIN)
    await assert.rejects(abrir('b9000000-0000-4000-8000-000000000009'), /barraca nao encontrada/)
  })

  test('cada abertura vira uma linha do log, com quem e qual barraca', async () => {
    await como(ADMIN)
    await abrir()
    await abrir()
    await db.exec('reset role')
    const n = (await db.query<{ n: string }>(`select count(*) as n from public.acessos_admin_log where superadmin_id = '${ADMIN}' and barraca_id = '${B1}'`)).rows[0].n
    assert.ok(Number(n) >= 2)
  })

  test('o log e as revelações não são legíveis direto', async () => {
    await como(ADMIN)
    await assert.rejects(db.query('select * from public.acessos_admin_log'), /permission denied/)
    await assert.rejects(db.query('select * from public.acessos_admin_revelacoes'), /permission denied/)
  })
})

describe('leitura exige acesso válido do próprio superadmin', () => {
  test('acesso inexistente, de outro superadmin ou vencido: negado', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    await assert.rejects(pedidos('d0000000-0000-4000-8000-000000000000'), /acesso negado/)
    await como(ADMIN2)
    await assert.rejects(pedidos(acesso), /acesso negado/)
    await db.exec(`reset role; update public.acessos_admin_log set aberto_em = now() - interval '3 hours' where id = '${acesso}'`)
    await como(ADMIN)
    await assert.rejects(pedidos(acesso), /acesso negado/)
  })

  test('tirar da allowlist encerra na hora, mesmo com acesso aberto', async () => {
    await como(ADMIN2)
    const acesso = await abrir()
    assert.ok((await pedidos(acesso)).length > 0)
    await db.exec(`reset role; delete from public.superadmins where usuario_id = '${ADMIN2}'`)
    await como(ADMIN2)
    await assert.rejects(pedidos(acesso), /acesso negado/)
    await db.exec(`reset role; insert into public.superadmins values ('${ADMIN2}')`)
  })

  test('uso atualiza a duração', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    await db.exec(`reset role; update public.acessos_admin_log set aberto_em = now() - interval '10 minutes', ultimo_uso_em = now() - interval '10 minutes' where id = '${acesso}'`)
    await como(ADMIN)
    await pedidos(acesso)
    await como(DONO1)
    const lista = (await db.query<{ duracao_segundos: number }>('select * from public.acessos_admin_da_barraca($1)', [B1])).rows
    assert.ok(lista.some((l) => l.duracao_segundos >= 590 && l.duracao_segundos <= 620))
  })
})

describe('pedidos, faturamento, caixa e ajustes', () => {
  test('lista só da barraca aberta, com total sem itens removidos e dados mascarados', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    const lista = await pedidos(acesso)
    assert.equal(lista.length, 3)
    assert.ok(!lista.some((p) => p.pedido_id === P_OUTRA))
    const aberto = lista.find((p) => p.pedido_id === P_ABERTO)!
    assert.equal(Number(aberto.total_centavos), 2500)
    assert.equal(aberto.cliente_primeiro_nome, 'Maria')
    assert.equal(aberto.telefone_mascarado, '*******4384')
    assert.ok(!JSON.stringify(lista).includes('Flores') && !JSON.stringify(lista).includes('61982694384'))
  })

  test('filtro abertos e paginação com total e limite travado em 50', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    assert.deepEqual((await pedidos(acesso, 'abertos')).map((p) => p.pedido_id), [P_ABERTO])
    const pag = await pedidos(acesso, null, 1, 1)
    assert.equal(pag.length, 1)
    assert.equal(Number(pag[0].total), 3)
    assert.equal((await pedidos(acesso, null, 9999, 0)).length, 3)
    await assert.rejects(pedidos(acesso, 'qualquer'), /filtro invalido/)
  })

  test('revelar mostra completo, um pedido por vez, e registra', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    const r = (await db.query<{ cliente_telefone: string; entrega_rua: string }>('select * from public.admin_barraca_revelar_cliente($1, $2)', [acesso, P_ABERTO])).rows[0]
    assert.equal(r.cliente_telefone, '61982694384')
    assert.equal(r.entrega_rua, 'Rua das Flores')
    await assert.rejects(db.query('select * from public.admin_barraca_revelar_cliente($1, $2)', [acesso, P_OUTRA]), /acesso negado/)
    await db.exec('reset role')
    const log = (await db.query<{ revelacoes: number }>(`select revelacoes from public.acessos_admin_log where id = '${acesso}'`)).rows[0]
    assert.equal(log.revelacoes, 1)
    const rev = (await db.query<{ n: string }>(`select count(*) as n from public.acessos_admin_revelacoes where acesso_id = '${acesso}' and pedido_id = '${P_ABERTO}'`)).rows[0]
    assert.equal(Number(rev.n), 1)
  })

  test('faturamento por dia e forma de pagamento, sem cancelados', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    const f = (await db.query<{ metodo_pagamento: string; pedidos: string; total_centavos: string }>('select * from public.admin_barraca_faturamento($1)', [acesso])).rows
    const por = Object.fromEntries(f.map((x) => [x.metodo_pagamento, x]))
    assert.equal(Number(por['pix'].total_centavos), 2500)
    assert.equal(Number(por['pix'].pedidos), 1)
    assert.equal(Number(por['dinheiro'].total_centavos), 700)
  })

  test('caixas da barraca aberta', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    const c = (await db.query<{ valor_abertura_centavos: number }>('select * from public.admin_barraca_caixas($1)', [acesso])).rows
    assert.deepEqual(c.map((x) => x.valor_abertura_centavos), [5000])
  })

  test('ajustes sem segredo nem contato do dono, com a assinatura', async () => {
    await como(ADMIN)
    const acesso = await abrir()
    const a = (await db.query<{ a: Record<string, unknown> }>('select public.admin_barraca_ajustes($1) as a', [acesso])).rows[0].a
    assert.equal(a.nome, 'Loja 1')
    assert.equal((a.assinatura as { plano: string }).plano, 'pro')
    for (const proibido of ['cnpj', 'ia_whatsapp_dono', 'whatsapp_pedidos']) assert.ok(!(proibido in a))
    assert.ok(!JSON.stringify(a).includes('12345678000199'))
  })
})

describe('somente leitura de verdade', () => {
  test('superadmin não grava nem apaga pedido, caixa ou barraca direto', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`insert into public.pedidos (id, barraca_id) values (gen_random_uuid(), '${B1}')`), /row-level security/)
    const alterados = await db.query(`update public.pedidos set status = 'cancelado' where barraca_id = '${B1}' returning id`)
    assert.equal(alterados.rows.length, 0)
    assert.equal((await db.query(`delete from public.pedidos where barraca_id = '${B1}' returning id`)).rows.length, 0)
    assert.equal((await db.query(`update public.barracas set nome = 'x' where id = '${B1}' returning id`)).rows.length, 0)
    await db.exec('reset role')
    assert.equal((await db.query<{ n: string }>(`select count(*) as n from public.pedidos where barraca_id = '${B1}'`)).rows[0].n.toString(), '3')
  })

  test('as funções não alteram pedidos (contagem igual antes e depois)', async () => {
    await db.exec('reset role')
    const antes = (await db.query<{ n: string; s: string }>(`select count(*) as n, coalesce(sum(senha), 0) as s from public.pedidos`)).rows[0]
    await como(ADMIN)
    const acesso = await abrir()
    await pedidos(acesso)
    await db.query('select * from public.admin_barraca_faturamento($1)', [acesso])
    await db.exec('reset role')
    const depois = (await db.query<{ n: string; s: string }>(`select count(*) as n, coalesce(sum(senha), 0) as s from public.pedidos`)).rows[0]
    assert.deepEqual(depois, antes)
  })
})

describe('o dono vê quem abriu', () => {
  test('dono da barraca vê; funcionário, dono de outra barraca e anon não', async () => {
    await como(DONO1)
    const lista = (await db.query<{ modo: string }>('select * from public.acessos_admin_da_barraca($1)', [B1])).rows
    assert.ok(lista.length > 0 && lista.every((l) => l.modo === 'leitura'))
    await como(FUNC1)
    await assert.rejects(db.query('select * from public.acessos_admin_da_barraca($1)', [B1]), /acesso negado/)
    await como(DONO2)
    await assert.rejects(db.query('select * from public.acessos_admin_da_barraca($1)', [B1]), /acesso negado/)
    await como(null, 'anon')
    await assert.rejects(db.query('select * from public.acessos_admin_da_barraca($1)', [B1]), /permission denied/)
  })
})

describe('edição pelo mecanismo do suporte', () => {
  test('superadmin antigo (backfill) e novo (gatilho) entram em usuarios_suporte; comum não', async () => {
    await db.exec('reset role')
    const ids = (await db.query<{ usuario_id: string }>('select usuario_id from public.usuarios_suporte order by usuario_id')).rows.map((r) => r.usuario_id)
    assert.ok(ids.includes(ADMIN))
    assert.ok(ids.includes(ADMIN2))
    assert.ok(!ids.includes(COMUM))
  })
})
