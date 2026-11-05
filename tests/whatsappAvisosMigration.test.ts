// Avisos de status por WhatsApp: texto da migration + migration real rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ARQUIVO = '20261030100000_whatsapp_avisos.sql'
const ARQUIVO_EVENTO_VIGENTE = '20261018130000_evento_cupom.sql'
const ler = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')
const sql = ler(ARQUIVO)

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO_B1 = 'a1000000-0000-4000-8000-000000000001'
const DONO_B2 = 'a2000000-0000-4000-8000-000000000002'
const PEDIDO = 'd1000000-0000-4000-8000-000000000001'
const PEDIDO_B2 = 'd2000000-0000-4000-8000-000000000002'
const EV_ORDER = 'e1000000-0000-4000-8000-000000000001'
const EV_CUSTOMER = 'e2000000-0000-4000-8000-000000000002'
const EV_ORDER_B2 = 'e3000000-0000-4000-8000-000000000003'

const CONFIG = {
  recebido: { ativo: true, texto: null },
  pronto: { ativo: false, texto: 'Oi {nome}, pedido {senha} pronto!' },
}

describe('migration avisos de WhatsApp (texto)', () => {
  test('Rollback no topo', () => {
    assert.match(sql.split('\n').slice(0, 40).join('\n'), /Rollback:/)
  })

  test('coluna jsonb com check de objeto', () => {
    assert.match(sql, /add column if not exists whatsapp_avisos jsonb/i)
    assert.match(sql, /jsonb_typeof\(whatsapp_avisos\) = 'object'/)
  })

  test('RPC security definer, search_path fixo e grants só para authenticated', () => {
    assert.match(sql, /function public\.whatsapp_avisos_salvar\(p_barraca_id uuid, p_avisos jsonb\)/)
    assert.match(sql, /security definer/i)
    assert.match(sql, /set search_path = public, pg_temp/i)
    assert.match(sql, /revoke all on function public\.whatsapp_avisos_salvar\(uuid, jsonb\) from public, anon/i)
    assert.match(sql, /grant execute on function public\.whatsapp_avisos_salvar\(uuid, jsonb\) to authenticated/i)
  })
})

describe('migration avisos de WhatsApp (PGlite)', () => {
  let db: PGlite
  let eventoAntes: unknown

  async function como(uid: string | null) {
    await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'}`)
  }
  async function salvar(barraca: string, avisos: unknown) {
    const r = await db.query<{ r: { estado: string } }>('select public.whatsapp_avisos_salvar($1, $2::jsonb) as r', [
      barraca,
      JSON.stringify(avisos),
    ])
    return r.rows[0].r.estado
  }
  async function coluna(barraca: string) {
    const r = await db.query<{ a: unknown }>('select whatsapp_avisos as a from public.barracas where id = $1', [barraca])
    return r.rows[0].a
  }
  async function evento(id: string) {
    const r = await db.query<{ e: { data: Record<string, unknown> } }>('select public.montar_evento_saida($1) as e', [id])
    return r.rows[0].e
  }

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.barracas (id uuid primary key, nome text);
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
        select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
      create table public.clientes_finais (id uuid primary key, barraca_id uuid, nome text, telefone text, consentimento_marketing_em timestamptz);
      create table public.pedidos (
        id uuid primary key, barraca_id uuid not null, senha integer, cliente_nome text, entrega_nome text,
        cliente_telefone text, entrega_telefone text, cliente_id uuid, tipo_atendimento text, viagem boolean default false,
        mesa text, taxa_entrega_centavos integer, desconto_cupom_centavos integer, cupom_codigo text, metodo_pagamento text
      );
      create table public.itens_do_pedido (
        id serial primary key, pedido_id uuid, nome_item text, quantidade integer, preco_centavos_unitario integer,
        observacao text, opcoes jsonb, removido boolean not null default false
      );
      create table public.eventos_saida (
        id uuid primary key, pedido_id uuid, tipo text, status_pedido text, ocorrido_em timestamptz, barraca_id uuid, sequence bigint
      );
      grant usage on schema public to authenticated, anon;
      grant select on public.barracas to authenticated;
      insert into public.barracas values ('${B1}', 'Loja 1'), ('${B2}', 'Loja 2');
      insert into public.usuarios_barracas values ('${DONO_B1}', '${B1}', 'dono'), ('${DONO_B2}', '${B2}', 'dono');
      insert into public.pedidos (id, barraca_id, senha, cliente_nome, cliente_telefone, tipo_atendimento, metodo_pagamento)
        values ('${PEDIDO}', '${B1}', 7, 'Maria', '55999990000', 'retirada', 'dinheiro'),
               ('${PEDIDO_B2}', '${B2}', 8, 'Joao', '55999991111', 'retirada', 'dinheiro');
      insert into public.itens_do_pedido (pedido_id, nome_item, quantidade, preco_centavos_unitario)
        values ('${PEDIDO}', 'Temaki', 2, 1500), ('${PEDIDO_B2}', 'Yakisoba', 1, 2500);
      insert into public.eventos_saida values
        ('${EV_ORDER}', '${PEDIDO}', 'order.ready', 'pronto', now(), '${B1}', 1),
        ('${EV_CUSTOMER}', '${PEDIDO}', 'customer.created', 'pronto', now(), '${B1}', 2),
        ('${EV_ORDER_B2}', '${PEDIDO_B2}', 'order.ready', 'pronto', now(), '${B2}', 3);
    `)
    await db.exec(ler(ARQUIVO_EVENTO_VIGENTE))
    eventoAntes = (await evento(EV_ORDER)).data
    await db.exec(sql)
    // Rodar duas vezes não quebra (idempotente).
    await db.exec(sql)
  })

  after(async () => {
    await db.close()
  })

  test('coluna nasce nula e o check recusa valor que não é objeto', async () => {
    await db.exec('reset role')
    assert.equal(await coluna(B1), null)
    await assert.rejects(db.exec(`update public.barracas set whatsapp_avisos = '[]'::jsonb where id = '${B1}'`))
  })

  test('dono salva config válida e a coluna fica igual', async () => {
    await como(DONO_B1)
    assert.equal(await salvar(B1, CONFIG), 'ok')
    assert.deepEqual(await coluna(B1), CONFIG)
  })

  test('outra loja → sem_acesso; sem login → nao_autenticado', async () => {
    await como(DONO_B2)
    assert.equal(await salvar(B1, CONFIG), 'sem_acesso')
    await como(null)
    await assert.rejects(db.query('select public.whatsapp_avisos_salvar($1, $2::jsonb)', [B1, '{}']), /permission denied/i)
    await db.exec(`reset role; select set_config('test.uid', '', false)`)
    // authenticated sem uid (sessão sem usuário) também é recusado pela própria função
    await db.exec('set role authenticated')
    assert.equal(await salvar(B1, CONFIG), 'nao_autenticado')
  })

  test('config inválida → dados_invalidos e coluna inalterada', async () => {
    await como(DONO_B1)
    const ruins = [
      { em_preparo: { ativo: true, texto: null } },
      { pronto: { ativo: 'sim', texto: null } },
      { pronto: { ativo: true, texto: 'a'.repeat(501) } },
      { pronto: { ativo: true, texto: 5 } },
      { pronto: { ativo: true, texto: null, extra: 1 } },
      { pronto: 'texto' },
      [],
    ]
    for (const ruim of ruins) {
      assert.equal(await salvar(B1, ruim), 'dados_invalidos', JSON.stringify(ruim))
    }
    assert.equal(await salvar(B1, null), 'dados_invalidos')
    assert.deepEqual(await coluna(B1), CONFIG)
  })

  test('texto de 500 caracteres é aceito', async () => {
    await como(DONO_B1)
    assert.equal(await salvar(B1, { pronto: { ativo: true, texto: 'a'.repeat(500) } }), 'ok')
    assert.equal(await salvar(B1, CONFIG), 'ok')
  })

  test('evento order.* de barraca sem config não ganha a chave avisos e fica igual ao de antes', async () => {
    await db.exec('reset role')
    const e = await evento(EV_ORDER_B2)
    assert.equal('avisos' in e.data, false)
    // B1 sem config: zera e compara com o evento capturado antes da migration.
    await db.exec(`update public.barracas set whatsapp_avisos = null where id = '${B1}'`)
    assert.deepEqual((await evento(EV_ORDER)).data, eventoAntes)
    await db.exec(`update public.barracas set whatsapp_avisos = '${JSON.stringify(CONFIG)}'::jsonb where id = '${B1}'`)
  })

  test('evento order.* com config leva data.avisos idêntico à coluna (texto null preservado)', async () => {
    await db.exec('reset role')
    const e = await evento(EV_ORDER)
    assert.deepEqual(e.data.avisos, CONFIG)
    assert.deepEqual({ ...e.data, avisos: undefined }, { ...(eventoAntes as object), avisos: undefined })
  })

  test('evento customer.* nunca leva avisos', async () => {
    await db.exec('reset role')
    assert.equal('avisos' in (await evento(EV_CUSTOMER)).data, false)
  })
})
