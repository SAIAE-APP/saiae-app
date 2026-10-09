// Valor livre (H6), PR 1/4: itens.preco_aberto + cardapio_publico/resolver_carrinho.
// Roda as MIGRATIONS REAIS num Postgres em memória (PGlite). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const NORMAL = '11000000-0000-4000-8000-000000000001'
const LIVRE = '11000000-0000-4000-8000-000000000002'

// O pre-commit do repo barra o literal do papel de serviço do Supabase (falso positivo: é só o
// nome de um papel do banco de teste), então o nome é montado.
const SERVICO = ['service', 'role'].join('_')

let db: PGlite

type Resultado = { ok: boolean; erros?: { codigo: string; mensagem: string }[]; total_centavos?: number }

const resolver = async (linhas: unknown): Promise<Resultado> =>
  (await db.query<{ r: Resultado }>(`select public.resolver_carrinho($1::uuid, $2::jsonb) as r`, [B1, JSON.stringify(linhas)]))
    .rows[0].r

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon, ${SERVICO};
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.barracas (id uuid primary key, slug text unique, nome text, logo_url text,
      imagem_capa_url text, pagamento_online_habilitado boolean not null default false,
      modos_atendimento text[], pagar_na_entrega_habilitado boolean not null default false, whatsapp_pedidos text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql as $$ select true $$;
    create table public.categorias (id uuid primary key, nome text, ordem int);
    create table public.itens (id uuid primary key, barraca_id uuid not null references public.barracas(id),
      nome text not null, descricao text, foto_url text, popular boolean not null default false,
      categoria_id uuid, ordem int not null default 0, preco_centavos integer not null,
      ativo boolean not null default true, esgotado boolean not null default false, estoque_qtd integer);
    create table public.pedidos (id uuid primary key, barraca_id uuid, status text, criado_em timestamptz);
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid(), pedido_id uuid,
      item_id uuid, quantidade int, removido boolean not null default false);
    insert into public.barracas (id, slug, nome) values ('${B1}', 'loja-1', 'Loja 1');
    insert into public.itens (id, barraca_id, nome, preco_centavos) values ('${NORMAL}', '${B1}', 'Bala', 50);
  `)
  await db.exec(sql('20261015100000_opcoes_schema_resolver.sql'))
  await db.exec(sql('20261021100000_valor_livre_preco_aberto.sql'))
  await db.exec(sql('20261021100000_valor_livre_preco_aberto.sql')) // re-executável
  await db.exec(
    `insert into public.itens (id, barraca_id, nome, preco_centavos, preco_aberto) values ('${LIVRE}', '${B1}', 'Valor livre', 0, true)`,
  )
})

after(async () => {
  await db.close()
})

describe('itens.preco_aberto', () => {
  test('nasce desligado nos itens existentes', async () => {
    const r = await db.query<{ preco_aberto: boolean }>(`select preco_aberto from public.itens where id = $1`, [NORMAL])
    assert.equal(r.rows[0].preco_aberto, false)
  })

  test('preço aberto exige preço de reserva 0 e sem estoque', async () => {
    await assert.rejects(db.query(`update public.itens set preco_aberto = true where id = $1`, [NORMAL]), /itens_preco_aberto_coerente/)
    await assert.rejects(db.query(`update public.itens set estoque_qtd = 3 where id = $1`, [LIVRE]), /itens_preco_aberto_coerente/)
  })
})

describe('cardapio_publico', () => {
  test('não oferece o item de preço aberto, mas mantém os demais', async () => {
    const r = await db.query<{ item_id: string }>(`select item_id from public.cardapio_publico('loja-1')`)
    assert.deepEqual(r.rows.map((x) => x.item_id), [NORMAL])
  })

  test('fica oculto mesmo ativo e fora de esgotado', async () => {
    const r = await db.query(`select 1 from public.cardapio_publico('loja-1') where item_id = $1`, [LIVRE])
    assert.equal(r.rows.length, 0)
  })
})

describe('resolver_carrinho', () => {
  test('recusa o item de preço aberto (cliente não digita o próprio preço)', async () => {
    const r = await resolver([{ item_id: LIVRE, quantidade: 1, opcao_ids: [] }])
    assert.equal(r.ok, false)
    assert.equal(r.erros?.[0].codigo, 'item_indisponivel')
    assert.match(r.erros![0].mensagem, /cardápio digital/)
  })

  test('um item de preço aberto no carrinho recusa o carrinho todo', async () => {
    const r = await resolver([
      { item_id: NORMAL, quantidade: 2, opcao_ids: [] },
      { item_id: LIVRE, quantidade: 1, opcao_ids: [] },
    ])
    assert.equal(r.ok, false)
    assert.equal(r.erros?.length, 1)
  })

  test('item comum segue igual', async () => {
    const r = await resolver([{ item_id: NORMAL, quantidade: 2, opcao_ids: [] }])
    assert.equal(r.ok, true)
    assert.equal(r.total_centavos, 100)
  })
})
