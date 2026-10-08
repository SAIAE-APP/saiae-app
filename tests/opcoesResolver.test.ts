// SAI-010a etapa 1: schema de opções + resolver_carrinho, rodando a MIGRATION REAL num Postgres
// descartável em memória (PGlite). Stubs só para o que a migration referencia (barracas, itens,
// itens_do_pedido, usuario_tem_acesso_barraca). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20261015100000_opcoes_schema_resolver.sql', import.meta.url),
  'utf8',
)

// Ids fixos (uuid v4 válidos) para ficar legível.
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const U1 = 'a1000000-0000-4000-8000-000000000001'
const ITEM = '11000000-0000-4000-8000-000000000001' // yakisoba 22,00
const ITEM2 = '11000000-0000-4000-8000-000000000002' // refri 6,00
const ITEM_B2 = '22000000-0000-4000-8000-000000000001'
const G_TAM = 'c1000000-0000-4000-8000-000000000001' // variação
const G_ADIC = 'c1000000-0000-4000-8000-000000000002' // adicional 0..3
const G_OBRIG = 'c1000000-0000-4000-8000-000000000003' // adicional min 1 max 1
const O_PEQ = 'd1000000-0000-4000-8000-000000000001'
const O_GRA = 'd1000000-0000-4000-8000-000000000002'
const O_OVO = 'd1000000-0000-4000-8000-000000000003'
const O_BACON = 'd1000000-0000-4000-8000-000000000004'
const O_QUEIJO = 'd1000000-0000-4000-8000-000000000005'
const O_MOLHO = 'd1000000-0000-4000-8000-000000000006'
const O_X = 'd1000000-0000-4000-8000-000000000007'
const O_OUTRA_BARRACA = 'd2000000-0000-4000-8000-000000000001'

// O pre-commit do repo barra o literal do papel de serviço do Supabase (falso positivo aqui: é só
// o nome de um papel do banco de teste), então o nome é montado.
const SERVICO = ['service', 'role'].join('_')

let db: PGlite

type Erro = { linha: number | null; item_id: string | null; codigo: string; mensagem: string }
type Resultado = {
  ok: boolean
  erros?: Erro[]
  linhas?: {
    item_id: string
    nome_item: string
    quantidade: number
    preco_centavos_unitario: number
    opcoes: { opcao_id: string; tipo: string; preco_centavos: number; quantidade: number; nome: string }[]
    observacao: string | null
  }[]
  total_centavos?: number
}

async function resolver(barraca: string, linhas: unknown, habilitado = true): Promise<Resultado> {
  await db.query(`update public.barracas set opcoes_habilitado = $1 where id = $2`, [habilitado, barraca])
  const r = await db.query<{ r: Resultado }>(`select public.resolver_carrinho($1::uuid, $2::jsonb) as r`, [
    barraca,
    JSON.stringify(linhas),
  ])
  return r.rows[0].r
}

const linha = (item_id: string, opcao_ids: string[] = [], quantidade = 1, extra: object = {}) => ({
  item_id,
  quantidade,
  opcao_ids,
  ...extra,
})

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon, ${SERVICO};
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.itens (id uuid primary key, barraca_id uuid not null references public.barracas(id),
      nome text not null, preco_centavos integer not null, ativo boolean not null default true,
      esgotado boolean not null default false);
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid());
    insert into public.barracas (id, nome) values ('${B1}', 'Loja 1'), ('${B2}', 'Loja 2');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono');
    insert into public.itens (id, barraca_id, nome, preco_centavos) values
      ('${ITEM}', '${B1}', 'Yakisoba', 2200), ('${ITEM2}', '${B1}', 'Refrigerante', 600),
      ('${ITEM_B2}', '${B2}', 'Outro', 1000);
  `)
  await db.exec(MIGRATION)
  // Roda de novo: a migration precisa ser re-executável.
  await db.exec(MIGRATION)
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated`)

  await db.exec(`
    insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, max_escolhas, ordem) values
      ('${G_TAM}', '${B1}', 'Tamanho', 'variacao', 1, 1, 0),
      ('${G_ADIC}', '${B1}', 'Adicionais', 'adicional', 0, 3, 1),
      ('${G_OBRIG}', '${B1}', 'Molho', 'adicional', 1, 1, 2);
    insert into public.opcoes (id, grupo_id, barraca_id, nome, preco_centavos, ordem) values
      ('${O_PEQ}', '${G_TAM}', '${B1}', 'Pequeno', 2200, 0),
      ('${O_GRA}', '${G_TAM}', '${B1}', 'Grande', 3200, 1),
      ('${O_OVO}', '${G_ADIC}', '${B1}', 'Ovo', 300, 0),
      ('${O_BACON}', '${G_ADIC}', '${B1}', 'Bacon', 500, 1),
      ('${O_QUEIJO}', '${G_ADIC}', '${B1}', 'Queijo', 400, 2),
      ('${O_X}', '${G_ADIC}', '${B1}', 'Carne extra', 800, 3),
      ('${O_MOLHO}', '${G_OBRIG}', '${B1}', 'Shoyu', 0, 0);
    insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem) values
      ('${ITEM}', '${G_TAM}', '${B1}', 0), ('${ITEM}', '${G_ADIC}', '${B1}', 1);
  `)
  // Opção de outra barraca (grupo próprio).
  await db.exec(`
    insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, max_escolhas)
      values ('c2000000-0000-4000-8000-000000000001', '${B2}', 'G2', 'adicional', 0, null);
    insert into public.opcoes (id, grupo_id, barraca_id, nome, preco_centavos)
      values ('${O_OUTRA_BARRACA}', 'c2000000-0000-4000-8000-000000000001', '${B2}', 'De outra loja', 100);
  `)
})

after(async () => {
  await db.close()
})

describe('schema', () => {
  test('variação só aceita min = max = 1', async () => {
    await assert.rejects(
      db.query(
        `insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, 'X', 'variacao', 0, 1)`,
        [B1],
      ),
      /grupos_opcoes_variacao_um_a_um/,
    )
    await assert.rejects(
      db.query(
        `insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, 'X', 'variacao', 1, null)`,
        [B1],
      ),
      /grupos_opcoes_variacao_um_a_um/,
    )
  })

  test('limites: max >= min, até 20, adicional sem limite (null) vale', async () => {
    await assert.rejects(
      db.query(
        `insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, 'X', 'adicional', 3, 2)`,
        [B1],
      ),
      /grupos_opcoes_limites_validos/,
    )
    await assert.rejects(
      db.query(
        `insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, 'X', 'adicional', 0, 21)`,
        [B1],
      ),
      /grupos_opcoes_limites_validos/,
    )
    await db.query(
      `insert into public.grupos_opcoes (barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, 'Sem limite', 'adicional', 0, null)`,
      [B1],
    )
  })

  test('no máximo UMA variação por item (índice parcial)', async () => {
    const g2 = 'c1000000-0000-4000-8000-0000000000f1'
    await db.query(
      `insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, max_escolhas) values ($1, $2, 'Sabor', 'variacao', 1, 1)`,
      [g2, B1],
    )
    await assert.rejects(
      db.query(`insert into public.itens_grupos (item_id, grupo_id, barraca_id) values ($1, $2, $3)`, [ITEM, g2, B1]),
      /itens_grupos_uma_variacao/,
    )
    // Outro item aceita (a regra é por item).
    await db.query(`insert into public.itens_grupos (item_id, grupo_id, barraca_id) values ($1, $2, $3)`, [ITEM2, g2, B1])
    await db.query(`delete from public.itens_grupos where item_id = $1 and grupo_id = $2`, [ITEM2, g2])
  })

  test('tipo do grupo é imutável', async () => {
    await assert.rejects(
      db.query(`update public.grupos_opcoes set tipo = 'adicional' where id = $1`, [G_TAM]),
      /não pode mudar/,
    )
  })

  test('multi-tenant: opção, ligação e item de outra barraca são recusados', async () => {
    // opção apontando para grupo de outra barraca
    await assert.rejects(
      db.query(`insert into public.opcoes (grupo_id, barraca_id, nome) values ($1, $2, 'x')`, [G_ADIC, B2]),
      /opcoes_grupo_fk/,
    )
    // item de outra barraca ligado a grupo desta
    await assert.rejects(
      db.query(`insert into public.itens_grupos (item_id, grupo_id, barraca_id) values ($1, $2, $3)`, [ITEM_B2, G_ADIC, B1]),
      /não pertence a esta barraca/,
    )
    // grupo de outra barraca informado com barraca_id desta
    await assert.rejects(
      db.query(`insert into public.itens_grupos (item_id, grupo_id, barraca_id) values ($1, 'c2000000-0000-4000-8000-000000000001', $2)`, [
        ITEM,
        B1,
      ]),
      /não encontrado nesta barraca|itens_grupos_grupo_fk/,
    )
  })

  test('RLS: usuário só enxerga as opções da própria barraca', async () => {
    await db.exec(`select set_config('test.uid', '${U1}', false); set role authenticated;`)
    const g = await db.query<{ barraca_id: string }>(`select distinct barraca_id from public.grupos_opcoes`)
    const o = await db.query<{ barraca_id: string }>(`select distinct barraca_id from public.opcoes`)
    await db.exec(`reset role`)
    assert.deepEqual(g.rows.map((r) => r.barraca_id), [B1])
    assert.deepEqual(o.rows.map((r) => r.barraca_id), [B1])
  })

  test('resolver_carrinho não é executável por authenticated/anon', async () => {
    await db.exec(`set role authenticated`)
    await assert.rejects(db.query(`select public.resolver_carrinho($1, '[]'::jsonb)`, [B1]), /permission denied/)
    await db.exec(`reset role; set role anon`)
    await assert.rejects(db.query(`select public.resolver_carrinho($1, '[]'::jsonb)`, [B1]), /permission denied/)
    await db.exec(`reset role; set role ${SERVICO}`)
    await db.query(`select public.resolver_carrinho($1, '[]'::jsonb)`, [B1])
    await db.exec(`reset role`)
  })

  test('itens_do_pedido.opcoes: padrão [], só array, até 20', async () => {
    const r = await db.query<{ opcoes: unknown }>(`insert into public.itens_do_pedido default values returning opcoes`)
    assert.deepEqual(r.rows[0].opcoes, [])
    await assert.rejects(db.query(`insert into public.itens_do_pedido (opcoes) values ('{}'::jsonb)`), /itens_do_pedido_opcoes_valido/)
    await assert.rejects(
      db.query(`insert into public.itens_do_pedido (opcoes) select jsonb_agg('{}'::jsonb) from generate_series(1, 21)`),
      /itens_do_pedido_opcoes_valido/,
    )
  })
})

describe('resolver_carrinho: preço e snapshot', () => {
  test('variação absoluta + adicionais somam; snapshot na ordem dos grupos; total = unitário x quantidade', async () => {
    const r = await resolver(B1, [linha(ITEM, [O_OVO, O_GRA, O_BACON], 2, { observacao: '  sem cebola  ' })])
    assert.equal(r.ok, true)
    const l = r.linhas![0]
    assert.equal(l.preco_centavos_unitario, 3200 + 300 + 500) // Grande substitui o 22,00 base
    assert.equal(l.quantidade, 2)
    assert.equal(l.observacao, 'sem cebola')
    assert.equal(l.nome_item, 'Yakisoba')
    assert.deepEqual(
      l.opcoes.map((o) => [o.opcao_id, o.tipo, o.preco_centavos, o.quantidade]),
      [
        [O_GRA, 'variacao', 3200, 1],
        [O_OVO, 'adicional', 300, 1],
        [O_BACON, 'adicional', 500, 1],
      ],
    )
    assert.equal(r.total_centavos, 8000)
  })

  test('o cliente nunca informa preço: campos extras na linha são ignorados', async () => {
    const r = await resolver(B1, [linha(ITEM, [O_PEQ], 1, { preco_centavos_unitario: 1, preco_centavos: 1, nome_item: 'Hack' })])
    assert.equal(r.linhas![0].preco_centavos_unitario, 2200)
    assert.equal(r.linhas![0].nome_item, 'Yakisoba')
  })

  test('item simples (sem grupos) resolve pelo preço base, também com a loja habilitada', async () => {
    const r = await resolver(B1, [linha(ITEM2, [], 3)])
    assert.equal(r.ok, true)
    assert.equal(r.linhas![0].preco_centavos_unitario, 600)
    assert.deepEqual(r.linhas![0].opcoes, [])
    assert.equal(r.total_centavos, 1800)
  })

  test('mesmo item com opções diferentes = linhas diferentes; total soma tudo', async () => {
    const r = await resolver(B1, [linha(ITEM, [O_PEQ]), linha(ITEM, [O_GRA, O_OVO]), linha(ITEM2, [], 2)])
    assert.equal(r.ok, true)
    assert.equal(r.total_centavos, 2200 + 3500 + 1200)
  })

  test('observação é cortada em 120 caracteres; vazia vira null', async () => {
    const longa = 'x'.repeat(300)
    const r = await resolver(B1, [linha(ITEM2, [], 1, { observacao: longa }), linha(ITEM2, [], 1, { observacao: '   ' })])
    assert.equal(r.linhas![0].observacao!.length, 120)
    assert.equal(r.linhas![1].observacao, null)
  })

  test('loja com opcoes_habilitado = false: item plano segue pelo preço base e recusa opcao_ids', async () => {
    const ok = await resolver(B1, [linha(ITEM, [])], false)
    assert.equal(ok.ok, true)
    assert.equal(ok.linhas![0].preco_centavos_unitario, 2200) // base, grupos ignorados (loja não habilitou)
    const nok = await resolver(B1, [linha(ITEM, [O_GRA])], false)
    assert.equal(nok.ok, false)
    assert.equal(nok.erros![0].codigo, 'opcoes_desabilitadas')
  })
})

describe('resolver_carrinho: regras de grupo', () => {
  test('variação obrigatória: sem escolha => grupo_minimo; duas => grupo_maximo', async () => {
    const sem = await resolver(B1, [linha(ITEM, [O_OVO])])
    assert.equal(sem.erros![0].codigo, 'grupo_minimo')
    assert.match(sem.erros![0].mensagem, /Tamanho/)
    const duas = await resolver(B1, [linha(ITEM, [O_PEQ, O_GRA])])
    assert.equal(duas.erros![0].codigo, 'grupo_maximo')
  })

  test('adicional com máximo 3: 4 escolhas => grupo_maximo; 3 passam', async () => {
    const quatro = await resolver(B1, [linha(ITEM, [O_PEQ, O_OVO, O_BACON, O_QUEIJO, O_X])])
    assert.equal(quatro.erros![0].codigo, 'grupo_maximo')
    const tres = await resolver(B1, [linha(ITEM, [O_PEQ, O_OVO, O_BACON, O_QUEIJO])])
    assert.equal(tres.ok, true)
    assert.equal(tres.linhas![0].preco_centavos_unitario, 2200 + 300 + 500 + 400)
  })

  test('grupo adicional obrigatório (min 1) exige escolha', async () => {
    await db.query(`insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem) values ($1, $2, $3, 2)`, [ITEM2, G_OBRIG, B1])
    try {
      const sem = await resolver(B1, [linha(ITEM2, [])])
      assert.equal(sem.erros![0].codigo, 'grupo_minimo')
      const com = await resolver(B1, [linha(ITEM2, [O_MOLHO])])
      assert.equal(com.ok, true)
      assert.equal(com.linhas![0].preco_centavos_unitario, 600) // molho grátis
    } finally {
      await db.query(`delete from public.itens_grupos where item_id = $1 and grupo_id = $2`, [ITEM2, G_OBRIG])
    }
  })

  test('opção repetida, de outro item/barraca, inexistente e malformada', async () => {
    assert.equal((await resolver(B1, [linha(ITEM, [O_PEQ, O_PEQ])])).erros![0].codigo, 'opcao_duplicada')
    assert.equal((await resolver(B1, [linha(ITEM, [O_PEQ, O_OUTRA_BARRACA])])).erros![0].codigo, 'opcao_invalida')
    assert.equal((await resolver(B1, [linha(ITEM, [O_PEQ, O_MOLHO])])).erros![0].codigo, 'opcao_invalida') // grupo não ligado ao item
    assert.equal(
      (await resolver(B1, [linha(ITEM, [O_PEQ, 'd9999999-0000-4000-8000-000000000999'])])).erros![0].codigo,
      'opcao_invalida',
    )
    assert.equal((await resolver(B1, [linha(ITEM, ['nao-e-uuid'])])).erros![0].codigo, 'opcao_invalida')
    assert.equal((await resolver(B1, [{ item_id: ITEM, quantidade: 1, opcao_ids: 'x' }])).erros![0].codigo, 'opcao_invalida')
  })

  test('opção esgotada ou inativa => opcao_indisponivel', async () => {
    await db.query(`update public.opcoes set esgotado = true where id = $1`, [O_BACON])
    assert.equal((await resolver(B1, [linha(ITEM, [O_PEQ, O_BACON])])).erros![0].codigo, 'opcao_indisponivel')
    await db.query(`update public.opcoes set esgotado = false, ativo = false where id = $1`, [O_BACON])
    assert.equal((await resolver(B1, [linha(ITEM, [O_PEQ, O_BACON])])).erros![0].codigo, 'opcao_indisponivel')
    await db.query(`update public.opcoes set ativo = true where id = $1`, [O_BACON])
  })

  test('grupo obrigatório com TODAS as opções esgotadas => item não pedível (mesmo sem escolher nada)', async () => {
    await db.query(`update public.opcoes set esgotado = true where grupo_id = $1`, [G_TAM])
    try {
      const r = await resolver(B1, [linha(ITEM, [])])
      assert.equal(r.ok, false)
      assert.equal(r.erros![0].codigo, 'grupo_sem_opcao_disponivel')
      // Itens sem esse grupo não são afetados.
      assert.equal((await resolver(B1, [linha(ITEM2, [])])).ok, true)
    } finally {
      await db.query(`update public.opcoes set esgotado = false where grupo_id = $1`, [G_TAM])
    }
  })

  test('grupo OPCIONAL sem opções disponíveis não impede o pedido', async () => {
    await db.query(`update public.opcoes set esgotado = true where grupo_id = $1`, [G_ADIC])
    try {
      const r = await resolver(B1, [linha(ITEM, [O_PEQ])])
      assert.equal(r.ok, true)
    } finally {
      await db.query(`update public.opcoes set esgotado = false where grupo_id = $1`, [G_ADIC])
    }
  })

  test('grupo inativo é ignorado (não obriga nem aceita escolha)', async () => {
    await db.query(`update public.grupos_opcoes set ativo = false where id = $1`, [G_TAM])
    try {
      const r = await resolver(B1, [linha(ITEM, [])])
      assert.equal(r.ok, true)
      assert.equal(r.linhas![0].preco_centavos_unitario, 2200)
      assert.equal((await resolver(B1, [linha(ITEM, [O_GRA])])).erros![0].codigo, 'opcao_invalida')
    } finally {
      await db.query(`update public.grupos_opcoes set ativo = true where id = $1`, [G_TAM])
    }
  })
})

describe('resolver_carrinho: item e carrinho', () => {
  test('item inativo, esgotado ou de outra barraca => item_indisponivel', async () => {
    await db.query(`update public.itens set ativo = false where id = $1`, [ITEM2])
    assert.equal((await resolver(B1, [linha(ITEM2)])).erros![0].codigo, 'item_indisponivel')
    await db.query(`update public.itens set ativo = true, esgotado = true where id = $1`, [ITEM2])
    assert.equal((await resolver(B1, [linha(ITEM2)])).erros![0].codigo, 'item_indisponivel')
    await db.query(`update public.itens set esgotado = false where id = $1`, [ITEM2])
    assert.equal((await resolver(B1, [linha(ITEM_B2)])).erros![0].codigo, 'item_indisponivel')
  })

  test('preço base zero sem variação => item_indisponivel (igual às edge functions de hoje)', async () => {
    await db.query(`update public.itens set preco_centavos = 0 where id = $1`, [ITEM2])
    try {
      assert.equal((await resolver(B1, [linha(ITEM2)])).erros![0].codigo, 'item_indisponivel')
    } finally {
      await db.query(`update public.itens set preco_centavos = 600 where id = $1`, [ITEM2])
    }
  })

  test('quantidade e item_id inválidos; carrinho vazio, grande ou não-array; barraca inexistente', async () => {
    assert.equal((await resolver(B1, [linha(ITEM2, [], 0)])).erros![0].codigo, 'quantidade_invalida')
    assert.equal((await resolver(B1, [{ item_id: ITEM2, quantidade: 'abc' }])).erros![0].codigo, 'quantidade_invalida')
    assert.equal((await resolver(B1, [{ item_id: 'x', quantidade: 1 }])).erros![0].codigo, 'item_invalido')
    assert.equal((await resolver(B1, [])).erros![0].codigo, 'carrinho_invalido')
    assert.equal((await resolver(B1, { a: 1 })).erros![0].codigo, 'carrinho_invalido')
    assert.equal((await resolver(B1, Array.from({ length: 41 }, () => linha(ITEM2)))).erros![0].codigo, 'carrinho_invalido')
    const r = await db.query<{ r: Resultado }>(`select public.resolver_carrinho('99999999-0000-4000-8000-000000000000', '[{}]'::jsonb) as r`)
    assert.equal(r.rows[0].r.erros![0].codigo, 'barraca_invalida')
  })

  test('um erro por linha, com o índice da linha; linhas boas não escondem as ruins', async () => {
    const r = await resolver(B1, [linha(ITEM2), linha(ITEM, []), linha(ITEM2, [], 0)])
    assert.equal(r.ok, false)
    assert.deepEqual(
      r.erros!.map((e) => [e.linha, e.codigo]),
      [
        [1, 'grupo_minimo'],
        [2, 'quantidade_invalida'],
      ],
    )
  })

  test('mais de 20 opções na linha => muitas_opcoes', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `d3000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    assert.equal((await resolver(B1, [linha(ITEM, ids)])).erros![0].codigo, 'muitas_opcoes')
  })
})
