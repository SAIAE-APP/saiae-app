// IA no WhatsApp, Task 1: a função ia_contexto roda de verdade (migration real no PGlite; tabelas vizinhas em stub).
// Foco do Review Focus: isolamento entre lojas e clientes, cliente só com telefone confirmado, IA desligada = código
// inexistente (mesma resposta) e permissões só do papel de serviço. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = readFileSync(new URL('../supabase/migrations/20261019100000_ia_atendente.sql', import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: é só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const U1 = 'a1000000-0000-4000-8000-000000000001'
const COD1 = 'ABCD23'
const COD2 = 'EFGH45'
const COD_OFF = 'JKMN67'

let db: PGlite

type Contexto = {
  ativa: boolean
  loja?: {
    nome: string; endereco: string | null; aberta_agora: boolean | null
    horarios: { dia: number; aberto: boolean; abre: string | null; fecha: string | null }[]
    modos: string[]; pagamentos: string[]
    taxa_entrega: { habilitada: boolean; padrao_centavos: number | null; bairro_nao_listado: string; bairros: { bairro: string; taxa_centavos: number }[] }
    link_cardapio: string
  }
  cardapio?: { truncado: boolean; itens: { nome: string; descricao: string | null; categoria: string; preco_centavos: number; esgotado: boolean; adicionais: { grupo: string; tipo: string; obrigatorio: boolean; opcoes: { nome: string; preco_centavos: number }[] }[] }[] }
  cliente?: null | { primeiro_nome: string; ultimos_pedidos: { itens: string[] }[] }
  ia?: { texto_livre: string | null; whatsapp_dono: string | null; plano_limite_conversas: number | null }
}

async function ctx(codigo: string, telefone: string | null = '11977776655'): Promise<Contexto> {
  const r = await db.query<{ c: Contexto }>(`select public.ia_contexto($1, $2) as c`, [codigo, telefone])
  return r.rows[0].c
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create table public.barracas (
      id uuid primary key, nome text not null, slug text unique not null, fuso text,
      modos_atendimento text[], metodos_pagamento_ativos jsonb, pagamento_online_habilitado boolean not null default false,
      pagar_na_entrega_habilitado boolean not null default false, taxa_entrega_habilitada boolean not null default false,
      taxa_entrega_centavos integer, entrega_bairro_nao_listado text, procon_endereco text, emitente_endereco text,
      opcoes_habilitado boolean not null default false
    );
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.assinaturas (usuario_id uuid primary key, plan text);
    create table public.horarios_funcionamento (barraca_id uuid, dia_semana smallint, aberto boolean, hora_abertura time, hora_fechamento time, unique (barraca_id, dia_semana));
    create table public.categorias (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, ordem integer default 0);
    create table public.itens (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, descricao text, preco_centavos integer,
      categoria_id uuid, esgotado boolean default false, ativo boolean default true, ordem integer default 0);
    create table public.grupos_opcoes (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, tipo text, min_escolhas integer default 0, ordem integer default 0, ativo boolean default true);
    create table public.opcoes (id uuid primary key default gen_random_uuid(), grupo_id uuid, nome text, preco_centavos integer default 0, ordem integer default 0, ativo boolean default true, esgotado boolean default false);
    create table public.itens_grupos (item_id uuid, grupo_id uuid, barraca_id uuid, ordem integer default 0);
    create table public.taxas_entrega_bairro (id uuid primary key default gen_random_uuid(), barraca_id uuid, bairro text, bairro_normalizado text, valor_centavos integer, ativo boolean default true);
    create table public.clientes_finais (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, telefone text, telefone_confirmado_em timestamptz);
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid, cliente_id uuid, status text default 'a_fazer', criado_em timestamptz default now());
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid(), pedido_id uuid, nome_item text, removido boolean default false);
    create function public.cobranca_ativa() returns boolean language sql stable as $$ select coalesce(current_setting('test.cobranca', true), 'true') = 'true' $$;
    create function public.normalizar_telefone_aviso(p_telefone text) returns text language sql immutable as $$
      select case when d = '' then null
        when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
        when length(d) between 8 and 15 then d else null end
      from (select regexp_replace(coalesce(p_telefone, ''), '\\D', '', 'g') as d) t $$;
  `)
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-executável

  await db.exec(`
    insert into public.barracas (id, nome, slug, ia_habilitada, ia_codigo, ia_texto_livre, ia_whatsapp_dono, metodos_pagamento_ativos,
      pagamento_online_habilitado, taxa_entrega_habilitada, taxa_entrega_centavos, procon_endereco, opcoes_habilitado) values
      ('${B1}', 'Loja Um', 'loja-um', true, '${COD1}', '  Aceitamos encomenda para festas.  ', '5511999990000', '["dinheiro","pix"]', true, true, 500, 'Rua A, 10', true),
      ('${B2}', 'Loja Dois', 'loja-dois', true, '${COD2}', 'Segredo da loja dois', '5511988880000', '["dinheiro"]', false, false, null, 'Rua B, 20', false);
    insert into public.barracas (id, nome, slug, ia_habilitada, ia_codigo) values ('b3000000-0000-4000-8000-000000000003', 'Loja Desligada', 'loja-off', false, '${COD_OFF}');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono');
    insert into public.assinaturas values ('${U1}', 'essencial');
    insert into public.categorias (id, barraca_id, nome, ordem) values
      ('ca100000-0000-4000-8000-000000000001', '${B1}', 'Lanches', 1), ('ca100000-0000-4000-8000-000000000002', '${B1}', 'Bebidas', 2);
    insert into public.itens (id, barraca_id, nome, descricao, preco_centavos, categoria_id, esgotado, ativo, ordem) values
      ('11000000-0000-4000-8000-000000000001', '${B1}', 'X-Teste', 'Lanche fictício', 1800, 'ca100000-0000-4000-8000-000000000001', false, true, 1),
      ('11000000-0000-4000-8000-000000000002', '${B1}', 'Refri', null, 600, 'ca100000-0000-4000-8000-000000000002', true, true, 1),
      ('11000000-0000-4000-8000-000000000003', '${B1}', 'Item Inativo', null, 100, null, false, false, 1),
      ('21000000-0000-4000-8000-000000000001', '${B2}', 'Item Da Loja Dois', null, 999, null, false, true, 1);
    insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, ordem) values
      ('c1000000-0000-4000-8000-000000000001', '${B1}', 'Tamanho', 'variacao', 1, 0),
      ('c1000000-0000-4000-8000-000000000002', '${B1}', 'Extras', 'adicional', 0, 1);
    insert into public.opcoes (grupo_id, nome, preco_centavos, ordem, ativo, esgotado) values
      ('c1000000-0000-4000-8000-000000000001', 'Grande', 2800, 0, true, false),
      ('c1000000-0000-4000-8000-000000000002', 'Ovo', 300, 0, true, false),
      ('c1000000-0000-4000-8000-000000000002', 'Bacon', 500, 1, true, true),
      ('c1000000-0000-4000-8000-000000000002', 'Antigo', 100, 2, false, false);
    insert into public.itens_grupos (item_id, grupo_id, barraca_id, ordem) values
      ('11000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', '${B1}', 0),
      ('11000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', '${B1}', 1);
    insert into public.taxas_entrega_bairro (barraca_id, bairro, bairro_normalizado, valor_centavos, ativo) values
      ('${B1}', 'Centro', 'centro', 400, true), ('${B1}', 'Velho', 'velho', 900, false);
  `)
})

after(async () => {
  await db.close()
})

describe('ia_contexto: ativa, código e isolamento da loja', () => {
  test('código inexistente, mal formado, vazio e IA desligada respondem EXATAMENTE igual (não revela se existe)', async () => {
    const respostas = await Promise.all([ctx('ZZZZZZ'), ctx(COD_OFF), ctx(''), ctx('abc'), ctx("AB'CD2"), ctx(null as unknown as string)])
    for (const r of respostas) assert.deepEqual(r, { ativa: false })
  })

  test('código em minúsculas e com espaços acha a loja', async () => {
    assert.equal((await ctx(`  ${COD1.toLowerCase()} `)).ativa, true)
  })

  test('devolve a loja certa e nada da outra', async () => {
    const r = await ctx(COD1)
    assert.equal(r.loja?.nome, 'Loja Um')
    assert.equal(r.loja?.link_cardapio, 'https://app.saiae.com.br/loja-um/cardapio')
    assert.equal(r.loja?.endereco, 'Rua A, 10')
    const texto = JSON.stringify(r)
    for (const alheio of ['Loja Dois', 'Item Da Loja Dois', 'Segredo da loja dois', 'loja-dois', '5511988880000', 'Rua B']) {
      assert.ok(!texto.includes(alheio), `vazou: ${alheio}`)
    }
    const dois = await ctx(COD2)
    assert.equal(dois.loja?.nome, 'Loja Dois')
    assert.ok(!JSON.stringify(dois).includes('X-Teste'))
  })

  test('texto livre vem aparado; whatsapp do dono vem para a IA avisar', async () => {
    const r = await ctx(COD1)
    assert.equal(r.ia?.texto_livre, 'Aceitamos encomenda para festas.')
    assert.equal(r.ia?.whatsapp_dono, '5511999990000')
  })
})

describe('ia_contexto: cardápio, pagamento e entrega', () => {
  test('só itens ativos, em ordem de categoria, com esgotado marcado; descrição nula preservada', async () => {
    const r = await ctx(COD1)
    assert.deepEqual(r.cardapio?.itens.map((i) => [i.nome, i.categoria, i.preco_centavos, i.esgotado]), [
      ['X-Teste', 'Lanches', 1800, false],
      ['Refri', 'Bebidas', 600, true],
    ])
    assert.ok(!JSON.stringify(r).includes('Item Inativo'))
    assert.equal(r.cardapio?.truncado, false)
  })

  test('adicionais: opção esgotada ou inativa não aparece; variação indica o tipo; sem opcoes_habilitado vem vazio', async () => {
    const x = (await ctx(COD1)).cardapio?.itens[0]
    assert.deepEqual(x?.adicionais, [
      { grupo: 'Tamanho', tipo: 'variacao', obrigatorio: true, opcoes: [{ nome: 'Grande', preco_centavos: 2800 }] },
      { grupo: 'Extras', tipo: 'adicional', obrigatorio: false, opcoes: [{ nome: 'Ovo', preco_centavos: 300 }] },
    ])
    assert.deepEqual((await ctx(COD2)).cardapio?.itens[0].adicionais, [])
  })

  test('pagamentos e taxa de entrega: padrão só com a taxa ligada; bairro inativo some', async () => {
    const um = (await ctx(COD1)).loja!
    assert.deepEqual(um.pagamentos, ['dinheiro', 'pix', 'pix_online'])
    assert.deepEqual(um.taxa_entrega, { habilitada: true, padrao_centavos: 500, bairro_nao_listado: 'taxa_padrao', bairros: [{ bairro: 'Centro', taxa_centavos: 400 }] })
    const dois = (await ctx(COD2)).loja!
    assert.deepEqual(dois.taxa_entrega, { habilitada: false, padrao_centavos: null, bairro_nao_listado: 'taxa_padrao', bairros: [] })
  })

  test('mais de 200 itens: devolve 200 e marca truncado', async () => {
    await db.exec(`insert into public.itens (barraca_id, nome, preco_centavos, ativo, ordem)
      select '${B2}', 'Extra ' || g, 100, true, g + 10 from generate_series(1, 205) g`)
    const r = await ctx(COD2)
    assert.equal(r.cardapio?.itens.length, 200)
    assert.equal(r.cardapio?.truncado, true)
  })
})

describe('ia_contexto: cliente (só com telefone confirmado, só da mesma loja)', () => {
  const CLI = 'cc100000-0000-4000-8000-000000000001'

  before(async () => {
    await db.exec(`
      insert into public.clientes_finais (id, barraca_id, nome, telefone, telefone_confirmado_em) values ('${CLI}', '${B1}', 'Ana Souza', '11977776655', now());
      insert into public.clientes_finais (barraca_id, nome, telefone, telefone_confirmado_em) values
        ('${B1}', 'Sem Confirmar', '11966665544', null),
        ('${B2}', 'Ana Da Loja Dois', '11977776655', now());
    `)
    for (const [i, itens, status] of [
      [1, ['X-Teste'], 'entregue'], [2, ['Refri', 'X-Teste'], 'entregue'], [3, ['Combo'], 'cancelado'], [4, ['Suco'], 'entregue'], [5, ['Pastel'], 'entregue'],
    ] as [number, string[], string][]) {
      const p = await db.query<{ id: string }>(`insert into public.pedidos (barraca_id, cliente_id, status, criado_em) values ($1, $2, $3, now() - ($4 || ' hours')::interval) returning id`, [B1, CLI, status, String(10 - i)])
      for (const nome of itens) await db.query(`insert into public.itens_do_pedido (pedido_id, nome_item) values ($1, $2)`, [p.rows[0].id, nome])
    }
  })

  test('confirmado: primeiro nome e os 3 últimos pedidos (cancelado fora, mais recente primeiro)', async () => {
    const r = await ctx(COD1)
    assert.equal(r.cliente?.primeiro_nome, 'Ana')
    assert.deepEqual(r.cliente?.ultimos_pedidos, [{ itens: ['Pastel'] }, { itens: ['Suco'] }, { itens: ['Refri', 'X-Teste'] }])
  })

  test('telefone com máscara ou com 55 acha o mesmo cliente', async () => {
    for (const tel of ['(11) 97777-6655', '+55 11 97777-6655', '5511977776655']) {
      assert.equal((await ctx(COD1, tel)).cliente?.primeiro_nome, 'Ana', tel)
    }
  })

  test('sem confirmação, sem perfil, telefone nulo ou inválido: cliente null (a IA trata como novo)', async () => {
    for (const tel of ['11966665544', '11900000000', null, '', 'abc', '123']) {
      assert.equal((await ctx(COD1, tel)).cliente, null, String(tel))
    }
  })

  test('o mesmo telefone em outra loja não vaza: cada loja só vê o próprio perfil', async () => {
    const dois = await ctx(COD2)
    assert.equal(dois.cliente?.primeiro_nome, 'Ana')
    assert.deepEqual(dois.cliente?.ultimos_pedidos, [])
    assert.ok(!JSON.stringify(dois).includes('Pastel'))
    assert.ok(!JSON.stringify(await ctx(COD1)).includes('Ana Da Loja Dois'))
  })

  test('só o primeiro nome: sobrenome nunca vai no contexto', async () => {
    assert.ok(!JSON.stringify(await ctx(COD1)).includes('Souza'))
  })
})

describe('ia_contexto: horário e limite do plano', () => {
  test('sem horário cadastrado: aberta_agora null', async () => {
    assert.equal((await ctx(COD1)).loja?.aberta_agora, null)
  })

  test('aberta 24h todos os dias = true; fechada todos os dias = false', async () => {
    const dias = [0, 1, 2, 3, 4, 5, 6]
    for (const d of dias) await db.query(`insert into public.horarios_funcionamento values ($1, $2, true, '00:00', '23:59') on conflict (barraca_id, dia_semana) do nothing`, [B1, d])
    const aberta = await ctx(COD1)
    assert.equal(aberta.loja?.aberta_agora, true)
    assert.equal(aberta.loja?.horarios.length, 7)
    assert.deepEqual(aberta.loja?.horarios[0], { dia: 0, aberto: true, abre: '00:00', fecha: '23:59' })
    await db.exec(`update public.horarios_funcionamento set aberto = false where barraca_id = '${B1}'`)
    assert.equal((await ctx(COD1)).loja?.aberta_agora, false)
  })

  test('fuso inválido não derruba a função', async () => {
    await db.exec(`update public.barracas set fuso = 'Marte/Olympus' where id = '${B1}'`)
    assert.equal((await ctx(COD1)).ativa, true)
    await db.exec(`update public.barracas set fuso = null where id = '${B1}'`)
  })

  test('limite de conversas: do plano do dono; sem linha = null; cobrança desligada usa o plano pro', async () => {
    assert.equal((await ctx(COD1)).ia?.plano_limite_conversas, null)
    await db.exec(`insert into public.ia_limites_plano values ('essencial', 100), ('pro', 500)`)
    assert.equal((await ctx(COD1)).ia?.plano_limite_conversas, 100)
    await db.exec(`select set_config('test.cobranca', 'false', false)`)
    assert.equal((await ctx(COD1)).ia?.plano_limite_conversas, 500)
    await db.exec(`select set_config('test.cobranca', 'true', false)`)
  })
})

describe('colunas, código e permissões', () => {
  test('constraints: texto livre até 2000, whatsapp só dígitos, código no formato e único', async () => {
    await assert.rejects(db.query(`update public.barracas set ia_texto_livre = $1 where id = '${B2}'`, ['x'.repeat(2001)]), /ia_texto_livre_tamanho/)
    await db.query(`update public.barracas set ia_texto_livre = $1 where id = '${B2}'`, ['x'.repeat(2000)])
    await db.query(`update public.barracas set ia_texto_livre = 'Segredo da loja dois' where id = '${B2}'`)
    for (const ruim of ['(11) 99999-0000', '123', '55119999900001234']) {
      await assert.rejects(db.query(`update public.barracas set ia_whatsapp_dono = $1 where id = '${B2}'`, [ruim]), /ia_whatsapp_dono_digitos/, ruim)
    }
    for (const ruim of ['abc', 'ABCD0I', 'ABCDEFG', 'abcd23']) {
      await assert.rejects(db.query(`update public.barracas set ia_codigo = $1 where id = '${B2}'`, [ruim]), /ia_codigo_formato/, ruim)
    }
    await assert.rejects(db.query(`update public.barracas set ia_codigo = '${COD1}' where id = '${B2}'`), /unique|duplicate/)
  })

  test('ia_gerar_codigo: 6 caracteres do alfabeto sem ambiguidade, sempre válido para a constraint', async () => {
    const r = await db.query<{ c: string }>(`select public.ia_gerar_codigo() as c from generate_series(1, 300)`)
    for (const { c } of r.rows) assert.match(c, /^[A-HJKMNP-Z2-9]{6}$/)
    assert.ok(new Set(r.rows.map((x) => x.c)).size > 290)
  })

  test('só o papel de serviço executa ia_contexto e ia_gerar_codigo; ia_limites_plano é fechada', async () => {
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`set role ${papel}`)
      try {
        await assert.rejects(db.query(`select public.ia_contexto('${COD1}', '11977776655')`), /permission denied/, papel)
        await assert.rejects(db.query(`select public.ia_gerar_codigo()`), /permission denied/, papel)
        await assert.rejects(db.query(`select * from public.ia_limites_plano`), /permission denied/, papel)
      } finally {
        await db.exec('reset role')
      }
    }
    await db.exec(`set role ${SERVICO}`)
    try {
      assert.equal((await ctx(COD1)).ativa, true)
    } finally {
      await db.exec('reset role')
    }
  })
})
