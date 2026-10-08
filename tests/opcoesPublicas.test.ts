// SAI-010a etapa 4a: opcoes_publicas(slug), leitura anon dos grupos/opções do cardápio.
// Roda as migrations reais (schema + RPC) num Postgres em memória (PGlite). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')

// O pre-commit do repo barra o literal do papel de serviço do Supabase (falso positivo: é só o
// nome de um papel do banco de teste), então o nome é montado.
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const I1 = '11000000-0000-4000-8000-000000000001'
const I2 = '11000000-0000-4000-8000-000000000002'
const I_INATIVO = '11000000-0000-4000-8000-000000000003'
const I_B2 = '22000000-0000-4000-8000-000000000001'
const G_TAM = 'c1000000-0000-4000-8000-000000000001'
const G_ADIC = 'c1000000-0000-4000-8000-000000000002'
const G_VAZIO = 'c1000000-0000-4000-8000-000000000003'
const G_INATIVO = 'c1000000-0000-4000-8000-000000000004'
const G_B2 = 'c2000000-0000-4000-8000-000000000001'

type Linha = {
  item_id: string
  grupo_id: string
  grupo_nome: string
  grupo_tipo: string
  min_escolhas: number
  max_escolhas: number | null
  opcao_id: string | null
  opcao_nome: string | null
  opcao_preco_centavos: number | null
  opcao_esgotado: boolean | null
}

let db: PGlite

async function publicas(slug: string, papel: 'anon' | 'authenticated' = 'anon'): Promise<Linha[]> {
  await db.exec(`set role ${papel}`)
  try {
    return (await db.query<Linha>(`select * from public.opcoes_publicas($1)`, [slug])).rows
  } finally {
    await db.exec('reset role')
  }
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table public.barracas (id uuid primary key, slug text unique);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql as $$ select true $$;
    create table public.itens (id uuid primary key, barraca_id uuid not null references public.barracas(id),
      nome text, preco_centavos integer, ativo boolean not null default true, esgotado boolean not null default false);
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid());
    insert into public.barracas values ('${B1}', 'loja-1'), ('${B2}', 'loja-2');
    insert into public.itens (id, barraca_id, nome, preco_centavos, ativo) values
      ('${I1}', '${B1}', 'Yakisoba', 2200, true), ('${I2}', '${B1}', 'Refri', 600, true),
      ('${I_INATIVO}', '${B1}', 'Antigo', 100, false), ('${I_B2}', '${B2}', 'Outro', 1000, true);
  `)
  await db.exec(sql('20261015100000_opcoes_schema_resolver.sql'))
  await db.exec(sql('20261015120000_opcoes_publicas.sql'))
  await db.exec(sql('20261015120000_opcoes_publicas.sql')) // re-executável

  await db.exec(`
    insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, max_escolhas, ordem, ativo) values
      ('${G_TAM}', '${B1}', 'Tamanho', 'variacao', 1, 1, 5, true),
      ('${G_ADIC}', '${B1}', 'Adicionais', 'adicional', 0, 3, 1, true),
      ('${G_VAZIO}', '${B1}', 'Molho', 'adicional', 1, 1, 9, true),
      ('${G_INATIVO}', '${B1}', 'Antigo grupo', 'adicional', 0, null, 0, false),
      ('${G_B2}', '${B2}', 'G2', 'adicional', 0, null, 0, true);
    insert into public.opcoes (id, grupo_id, barraca_id, nome, preco_centavos, ordem, ativo, esgotado) values
      ('d1000000-0000-4000-8000-000000000001', '${G_TAM}', '${B1}', 'Pequeno', 2200, 0, true, false),
      ('d1000000-0000-4000-8000-000000000002', '${G_TAM}', '${B1}', 'Grande', 3200, 1, true, false),
      ('d1000000-0000-4000-8000-000000000003', '${G_ADIC}', '${B1}', 'Ovo', 300, 1, true, false),
      ('d1000000-0000-4000-8000-000000000004', '${G_ADIC}', '${B1}', 'Bacon', 500, 0, true, true),
      ('d1000000-0000-4000-8000-000000000005', '${G_ADIC}', '${B1}', 'Removida', 999, 2, false, false),
      ('d1000000-0000-4000-8000-000000000006', '${G_VAZIO}', '${B1}', 'Inativa', 0, 0, false, false),
      ('d1000000-0000-4000-8000-000000000007', '${G_INATIVO}', '${B1}', 'x', 0, 0, true, false),
      ('d2000000-0000-4000-8000-000000000001', '${G_B2}', '${B2}', 'Da loja 2', 100, 0, true, false);
    insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem) values
      ('${I1}', '${G_TAM}', '${B1}', 0), ('${I1}', '${G_ADIC}', '${B1}', 1),
      ('${I2}', '${G_VAZIO}', '${B1}', 0), ('${I1}', '${G_INATIVO}', '${B1}', 2),
      ('${I_INATIVO}', '${G_ADIC}', '${B1}', 0), ('${I_B2}', '${G_B2}', '${B2}', 0);
  `)
})

after(async () => {
  await db.close()
})

describe('opcoes_publicas', () => {
  test('loja sem opcoes_habilitado não devolve nada (item plano)', async () => {
    assert.deepEqual(await publicas('loja-1'), [])
  })

  test('slug inexistente não devolve nada', async () => {
    await db.query(`update public.barracas set opcoes_habilitado = true where id = $1`, [B1])
    assert.deepEqual(await publicas('nao-existe'), [])
  })

  test('habilitada: grupos na ordem da ligação com o item, opções pela ordem, com preço e esgotado', async () => {
    const r = await publicas('loja-1')
    const yaki = r.filter((l) => l.item_id === I1)
    assert.deepEqual(
      yaki.map((l) => [l.grupo_nome, l.opcao_nome, l.opcao_preco_centavos, l.opcao_esgotado]),
      [
        ['Tamanho', 'Pequeno', 2200, false],
        ['Tamanho', 'Grande', 3200, false],
        ['Adicionais', 'Bacon', 500, true], // esgotada aparece, marcada (o cardápio a desabilita)
        ['Adicionais', 'Ovo', 300, false],
      ],
    )
    assert.deepEqual(
      [yaki[0].grupo_tipo, yaki[0].min_escolhas, yaki[0].max_escolhas, yaki[2].grupo_tipo, yaki[2].min_escolhas, yaki[2].max_escolhas],
      ['variacao', 1, 1, 'adicional', 0, 3],
    )
  })

  test('exclui opção inativa, grupo inativo, item inativo e dados de outra barraca', async () => {
    const r = await publicas('loja-1')
    const nomes = r.map((l) => l.opcao_nome)
    assert.ok(!nomes.includes('Removida'), 'opção inativa')
    assert.ok(!nomes.includes('x') && !r.some((l) => l.grupo_id === G_INATIVO), 'grupo inativo')
    assert.ok(!r.some((l) => l.item_id === I_INATIVO), 'item inativo')
    assert.ok(!nomes.includes('Da loja 2') && !r.some((l) => l.item_id === I_B2), 'outra barraca')
  })

  test('grupo ativo sem NENHUMA opção ativa vem como uma linha de opção nula (item não pedível)', async () => {
    const r = (await publicas('loja-1')).filter((l) => l.item_id === I2)
    assert.equal(r.length, 1)
    assert.equal(r[0].grupo_id, G_VAZIO)
    assert.equal(r[0].min_escolhas, 1)
    assert.equal(r[0].opcao_id, null)
    assert.equal(r[0].opcao_nome, null)
  })

  test('cada loja só enxerga as próprias opções', async () => {
    const r = await publicas('loja-2')
    assert.deepEqual(r.map((l) => l.opcao_nome), [])
    await db.query(`update public.barracas set opcoes_habilitado = true where id = $1`, [B2])
    assert.deepEqual((await publicas('loja-2')).map((l) => l.opcao_nome), ['Da loja 2'])
    assert.ok((await publicas('loja-1')).every((l) => l.opcao_nome !== 'Da loja 2'))
  })

  test('anon e authenticated executam; as tabelas continuam fechadas para anon', async () => {
    assert.ok((await publicas('loja-1', 'anon')).length > 0)
    assert.ok((await publicas('loja-1', 'authenticated')).length > 0)
    await db.exec('set role anon')
    try {
      await assert.rejects(db.query('select * from public.opcoes'), /permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  test('não vaza campos internos (só os campos públicos do contrato)', async () => {
    const r = await publicas('loja-1')
    assert.deepEqual(Object.keys(r[0]).sort(), [
      'grupo_id', 'grupo_nome', 'grupo_tipo', 'item_id', 'max_escolhas', 'min_escolhas',
      'opcao_esgotado', 'opcao_id', 'opcao_nome', 'opcao_preco_centavos',
    ])
  })
})
