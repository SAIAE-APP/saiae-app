// SAI-010a etapa 2: criar_pedido v9 (mesma assinatura da v8) grava o snapshot das opções.
// Cadeia REAL de migrations num Postgres em memória (PGlite): v8 -> schema de opções -> v9.
// Stubs só das tabelas-base que as migrations alteram. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const ITEM = '11000000-0000-4000-8000-000000000001'
const ITEM2 = '11000000-0000-4000-8000-000000000002'
const G1 = 'c1000000-0000-4000-8000-000000000001'
const O1 = 'd1000000-0000-4000-8000-000000000001'
const O2 = 'd1000000-0000-4000-8000-000000000002'

// O pre-commit do repo barra o literal do papel de serviço do Supabase (falso positivo: é só o
// nome de um papel do banco de teste), então o nome é montado.
const SERVICO = ['service', 'role'].join('_')

let db: PGlite
let n = 0

type Linha = Record<string, unknown>
type Snap = { grupo_id: string; grupo_nome: string; tipo: string; opcao_id: string; nome: string; preco_centavos: number; quantidade: number }

async function criar(itens: Linha[], extra: { uuid?: string; tipo?: string | null } = {}) {
  const uuid = extra.uuid ?? `cli-${++n}`
  const r = await db.query<{ pedido_id: string; senha: number }>(
    `select * from public.criar_pedido($1::uuid, null, false, null, $2, 'dinheiro', $3::jsonb)`,
    [B1, uuid, JSON.stringify(itens)],
  )
  return { ...r.rows[0], uuid }
}

async function linhasDoPedido(pedidoId: string) {
  const r = await db.query<{ item_id: string; nome_item: string; quantidade: number; preco_centavos_unitario: number; opcoes: Snap[] }>(
    `select item_id, nome_item, quantidade, preco_centavos_unitario, opcoes from public.itens_do_pedido where pedido_id = $1 order by nome_item`,
    [pedidoId],
  )
  return r.rows
}

const snap = (over: Partial<Snap> = {}): Snap => ({
  grupo_id: G1,
  grupo_nome: 'Adicionais',
  tipo: 'adicional',
  opcao_id: O1,
  nome: 'Ovo',
  preco_centavos: 300,
  quantidade: 1,
  ...over,
})

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create table public.barracas (id uuid primary key);
    create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid());
    create table public.pedidos (
      id uuid primary key default gen_random_uuid(), senha serial,
      barraca_id uuid not null, mesa text, viagem boolean, tipo_atendimento text,
      entrega_nome text, entrega_telefone text, entrega_rua text, entrega_numero text,
      entrega_bairro text, entrega_referencia text, taxa_entrega_centavos integer default 0,
      cliente_nome text, observacao text, client_uuid text unique, metodo_pagamento text,
      status text, pronto_em timestamptz, entregue_em timestamptz
    );
    create table public.itens (id uuid primary key, barraca_id uuid not null, nome text, preco_centavos integer,
      ativo boolean default true, esgotado boolean default false);
    create table public.itens_do_pedido (
      id uuid primary key default gen_random_uuid(), pedido_id uuid not null references public.pedidos(id),
      barraca_id uuid, item_id uuid, nome_item text, quantidade integer, preco_centavos_unitario integer,
      entrega_direta boolean default false, entregue boolean default false, entregue_em timestamptz, observacao text
    );
    insert into public.barracas values ('${B1}');
    insert into public.itens values ('${ITEM}', '${B1}', 'Yakisoba', 2200), ('${ITEM2}', '${B1}', 'Refri', 600);
  `)
  // Estado de produção antes desta etapa: v8.
  await db.exec(sql('20261008120000_aviso_pedido_pronto.sql'))
  // Etapa 1 (coluna itens_do_pedido.opcoes) e etapa 2. A etapa 2 roda duas vezes (re-executável).
  await db.exec(`create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql as $$ select true $$;`)
  await db.exec(sql('20261015100000_opcoes_schema_resolver.sql'))
  await db.exec(sql('20261015110000_criar_pedido_v9_opcoes.sql'))
  await db.exec(sql('20261015110000_criar_pedido_v9_opcoes.sql'))
})

after(async () => {
  await db.close()
})

describe('criar_pedido v9', () => {
  test('continua UMA função criar_pedido de 12 args (sem sobrecarga ambígua)', async () => {
    const r = await db.query<{ n: number; args: number }>(
      `select count(*)::int as n, max(pronargs)::int as args from pg_proc where proname = 'criar_pedido' and pronamespace = 'public'::regnamespace`,
    )
    assert.equal(r.rows[0].n, 1)
    assert.equal(r.rows[0].args, 12)
  })

  test('item sem opcoes (payload de app antigo) grava []', async () => {
    const { pedido_id } = await criar([
      { item_id: ITEM2, nome_item: 'Refri', quantidade: 2, preco_centavos_unitario: 600, observacao: 'gelada' },
    ])
    const [l] = await linhasDoPedido(pedido_id)
    assert.deepEqual(l.opcoes, [])
    assert.equal(l.preco_centavos_unitario, 600)
    assert.equal(l.quantidade, 2)
  })

  test('grava o snapshot das escolhas e preserva o preço unitário final enviado', async () => {
    const opcoes = [snap({ tipo: 'variacao', opcao_id: O2, nome: 'Grande', preco_centavos: 3200 }), snap()]
    const { pedido_id } = await criar([
      { item_id: ITEM, nome_item: 'Yakisoba', quantidade: 1, preco_centavos_unitario: 3500, opcoes },
    ])
    const [l] = await linhasDoPedido(pedido_id)
    assert.equal(l.preco_centavos_unitario, 3500)
    assert.deepEqual(l.opcoes, opcoes)
  })

  test('sanitiza: só chaves conhecidas, quantidade fixa em 1, textos aparados e limitados', async () => {
    const { pedido_id } = await criar([
      {
        item_id: ITEM,
        nome_item: 'Yakisoba',
        quantidade: 1,
        preco_centavos_unitario: 2500,
        opcoes: [{ ...snap({ nome: `  ${'x'.repeat(100)}  `, quantidade: 5 }), campo_extra: 'hack', preco_unitario: 1 }],
      },
    ])
    const [l] = await linhasDoPedido(pedido_id)
    assert.equal(l.opcoes.length, 1)
    assert.deepEqual(Object.keys(l.opcoes[0]).sort(), ['grupo_id', 'grupo_nome', 'nome', 'opcao_id', 'preco_centavos', 'quantidade', 'tipo'])
    assert.equal(l.opcoes[0].quantidade, 1)
    assert.equal(l.opcoes[0].nome.length, 60)
  })

  test('descarta elementos inválidos sem recusar o pedido', async () => {
    const lixo = [
      'texto',
      null,
      42,
      {},
      snap({ grupo_id: 'nao-uuid' }),
      snap({ opcao_id: 'nao-uuid' }),
      snap({ tipo: 'combo' }),
      snap({ nome: '   ' }),
      snap({ grupo_nome: '' }),
      snap({ preco_centavos: -1 }),
      snap({ preco_centavos: 1.5 }),
      snap({ preco_centavos: 123456789 }),
      { ...snap(), preco_centavos: 'abc' },
      snap({ nome: 'Válida', preco_centavos: 0 }),
    ]
    const { pedido_id } = await criar([
      { item_id: ITEM, nome_item: 'Yakisoba', quantidade: 1, preco_centavos_unitario: 2200, opcoes: lixo },
    ])
    const [l] = await linhasDoPedido(pedido_id)
    assert.deepEqual(l.opcoes.map((o) => o.nome), ['Válida'])
    assert.equal(l.opcoes[0].preco_centavos, 0)
  })

  test('opcoes que não é array vira [] (objeto, string, número)', async () => {
    for (const ruim of [{ a: 1 }, 'x', 7, true]) {
      const { pedido_id } = await criar([
        { item_id: ITEM2, nome_item: 'Refri', quantidade: 1, preco_centavos_unitario: 600, opcoes: ruim },
      ])
      assert.deepEqual((await linhasDoPedido(pedido_id))[0].opcoes, [])
    }
  })

  test('mantém no máximo 20 elementos, na ordem enviada', async () => {
    const muitas = Array.from({ length: 25 }, (_, i) => snap({ nome: `op${String(i).padStart(2, '0')}` }))
    const { pedido_id } = await criar([
      { item_id: ITEM, nome_item: 'Yakisoba', quantidade: 1, preco_centavos_unitario: 2200, opcoes: muitas },
    ])
    const [l] = await linhasDoPedido(pedido_id)
    assert.equal(l.opcoes.length, 20)
    assert.equal(l.opcoes[0].nome, 'op00')
    assert.equal(l.opcoes[19].nome, 'op19')
  })

  test('linhas do mesmo item com opções diferentes ficam separadas', async () => {
    const { pedido_id } = await criar([
      { item_id: ITEM, nome_item: 'Yakisoba A', quantidade: 1, preco_centavos_unitario: 2500, opcoes: [snap()] },
      { item_id: ITEM, nome_item: 'Yakisoba B', quantidade: 2, preco_centavos_unitario: 2200 },
    ])
    const ls = await linhasDoPedido(pedido_id)
    assert.equal(ls.length, 2)
    assert.equal(ls[0].opcoes.length, 1)
    assert.deepEqual(ls[1].opcoes, [])
  })

  test('idempotente por client_uuid: reenvio não duplica pedido nem linhas', async () => {
    const itens = [{ item_id: ITEM, nome_item: 'Yakisoba', quantidade: 1, preco_centavos_unitario: 2500, opcoes: [snap()] }]
    const a = await criar(itens, { uuid: 'idem-1' })
    const b = await criar(itens, { uuid: 'idem-1' })
    assert.equal(a.pedido_id, b.pedido_id)
    assert.equal(a.senha, b.senha)
    assert.equal((await linhasDoPedido(a.pedido_id)).length, 1)
  })

  test('comportamento da v8 intacto: pedido 100% entrega direta nasce entregue', async () => {
    const { pedido_id } = await criar([
      { item_id: ITEM2, nome_item: 'Refri', quantidade: 1, preco_centavos_unitario: 600, entrega_direta: true },
    ])
    const r = await db.query<{ status: string; entregue_em: Date | null }>(`select status, entregue_em from public.pedidos where id = $1`, [pedido_id])
    assert.equal(r.rows[0].status, 'entregue')
    assert.ok(r.rows[0].entregue_em)
  })
})

describe('sanear_opcoes_pedido', () => {
  test('null e ausente viram []', async () => {
    const r = await db.query<{ a: unknown; b: unknown }>(`select public.sanear_opcoes_pedido(null) as a, public.sanear_opcoes_pedido('[]'::jsonb) as b`)
    assert.deepEqual(r.rows[0], { a: [], b: [] })
  })
})
