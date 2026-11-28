// Gestão por IA (MCP), fatia 4: migration 20261129100000 rodando de verdade no PGlite, junto das anteriores.
// Cobre os tipos de proposta cupom, foto e cardápio, a trava de tipo no aplicar, o limite de chamadas e a purga.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { chaveNome } from '../src/lib/importarCardapio.ts'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const DONO = 'd0000000-0000-4000-8000-000000000001'
const OUTRO = 'd0000000-0000-4000-8000-000000000002'
const BARRACA = 'b1000000-0000-4000-8000-000000000001'
const BARRACA_2 = 'b2000000-0000-4000-8000-000000000002'
const TOKEN = 'a1000000-0000-4000-8000-000000000001'
const TOKEN_2 = 'a3000000-0000-4000-8000-000000000003'
const POKE = 'e1000000-0000-4000-8000-000000000001'
const SUSHI = 'e2000000-0000-4000-8000-000000000002'
const ESTRANHO = 'e3000000-0000-4000-8000-000000000003'
const UUID_PEND = 'f1000000-0000-4000-8000-000000000001'

type Json = Record<string, unknown>
let db: PGlite

async function rpc(papel: 'service_role' | 'authenticated' | 'anon', uid: string | null, chamada: string, params: unknown[] = []): Promise<Json> {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
  try {
    return (await db.query<{ r: Json }>(`select ${chamada} as r`, params)).rows[0].r
  } finally {
    await db.exec('reset role')
  }
}
const criar = (tipo: string, item: string | null, dados: Json, token = TOKEN) =>
  rpc('service_role', null, 'public.mcp_proposta_criar($1, $2, $3, $4::jsonb)', [token, tipo, item, JSON.stringify(dados)])
const aplicar = (proposta: string, esperado: string | null = null, token = TOKEN) =>
  rpc('service_role', null, 'public.mcp_proposta_aplicar($1, $2, $3)', [token, proposta, esperado])
const decidir = (proposta: string, aprovar: boolean, uid = DONO) => rpc('authenticated', uid, 'public.mcp_proposta_decidir($1, $2)', [proposta, aprovar])
const aprovar = async (tipo: string, item: string | null, dados: Json) => {
  const c = await criar(tipo, item, dados)
  assert.equal(c.estado, 'ok', JSON.stringify(c))
  assert.equal((await decidir(c.proposta_id as string, true)).estado, 'ok')
  return c.proposta_id as string
}
const linhas = async (consulta: string, params: unknown[] = []) => (await db.query<Json>(consulta, params)).rows

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema extensions;
    grant usage on schema public to authenticated, anon, service_role;
    create table public.barracas (id uuid primary key, nome text, fuso text not null default 'America/Sao_Paulo', cupons_habilitado boolean not null default false);
    create table public.usuarios_barracas (barraca_id uuid, usuario_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable as
      $$ select exists (select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.categorias (id uuid primary key default gen_random_uuid(), barraca_id uuid not null references public.barracas(id),
      nome text not null, ordem integer not null default 0);
    create table public.itens (
      id uuid primary key default gen_random_uuid(), barraca_id uuid not null references public.barracas(id), nome text not null,
      preco_centavos integer not null default 0, preco_aberto boolean not null default false, esgotado boolean not null default false,
      categoria_id uuid references public.categorias(id), descricao text, ativo boolean not null default true, ordem integer not null default 0,
      foto_url text);
    create table public.cupons (
      id uuid primary key default gen_random_uuid(),
      barraca_id uuid not null references public.barracas(id) on delete cascade,
      codigo text not null check (codigo ~ '^[A-Z0-9_-]{3,20}$'),
      tipo text not null check (tipo in ('percentual', 'fixo')),
      valor integer not null check (valor > 0),
      inicio_em timestamptz, fim_em timestamptz,
      limite_usos integer check (limite_usos is null or limite_usos > 0),
      uma_por_cliente boolean not null default false,
      pedido_minimo_centavos integer not null default 0 check (pedido_minimo_centavos >= 0),
      ativo boolean not null default true,
      criado_em timestamptz not null default now(),
      constraint cupons_percentual_ate_100 check (tipo <> 'percentual' or valor <= 100),
      constraint cupons_janela check (fim_em is null or inicio_em is null or fim_em > inicio_em),
      constraint cupons_barraca_codigo_unico unique (barraca_id, codigo));
    create table public.pedidos (
      id uuid primary key default gen_random_uuid(), barraca_id uuid not null, status text not null default 'a_fazer',
      criado_em timestamptz not null default now(), taxa_entrega_centavos integer default 0, desconto_cupom_centavos integer default 0);
    create table public.itens_do_pedido (
      id uuid primary key default gen_random_uuid(), pedido_id uuid, barraca_id uuid, item_id uuid, nome text,
      quantidade integer not null default 1, preco_centavos_unitario integer not null default 0, removido boolean not null default false);
    insert into auth.users values ('${DONO}'), ('${OUTRO}');
    insert into public.barracas (id, nome) values ('${BARRACA}', 'Kawashima'), ('${BARRACA_2}', 'Outra');
    insert into public.usuarios_barracas values ('${BARRACA}', '${DONO}', 'dono'), ('${BARRACA_2}', '${OUTRO}', 'dono');
  `)
  await db.exec(sql('20261010110000_estoque_por_item.sql'))
  for (const m of ['20261127100000_mcp_gestao.sql', '20261127110000_mcp_aprovacao.sql', '20261128100000_mcp_propostas_tipos.sql', '20261129100000_mcp_cupom_foto_cardapio.sql']) {
    await db.exec(sql(m))
  }
  await db.exec(`
    insert into public.itens (id, barraca_id, nome, preco_centavos) values
      ('${POKE}', '${BARRACA}', 'Poke', 3800), ('${SUSHI}', '${BARRACA}', 'Sushi', 5000), ('${ESTRANHO}', '${BARRACA_2}', 'Alheio', 1000);
    insert into public.mcp_tokens (id, barraca_id, nome, token_hash, prefixo, criado_por) values
      ('${TOKEN}', '${BARRACA}', 'ChatGPT', 'h1', 'sae_aaaa', '${DONO}'),
      ('${TOKEN_2}', '${BARRACA_2}', 'Outro', 'h3', 'sae_cccc', '${OUTRO}');
  `)
})
after(async () => {
  await db.close()
})

describe('mcp cupom', () => {
  const base = { codigo: 'promo10', tipo_desconto: 'percentual', valor: 10 }

  test('propor, aprovar e aplicar cria o cupom PAUSADO, com janela no fuso da barraca', async () => {
    const c = await criar('cupom', null, { ...base, codigo: ' promo10 ', valido_de: '2099-01-01', valido_ate: '2099-12-31', limite_usos: 50, pedido_minimo_centavos: 3000 })
    assert.equal(c.estado, 'ok', JSON.stringify(c))
    assert.equal(c.nome, 'PROMO10')
    assert.equal(await (await linhas('select count(*)::int as n from public.cupons')).at(0)?.n, 0, 'propor não cria cupom')
    assert.equal((await aplicar(c.proposta_id as string, 'cupom')).estado, 'aguardando_aprovacao')
    await decidir(c.proposta_id as string, true)
    const r = await aplicar(c.proposta_id as string, 'cupom')
    assert.equal(r.estado, 'ok', JSON.stringify(r))
    assert.equal(r.ativo, false)
    assert.equal(r.cupons_habilitado, false)
    const [cupom] = await linhas(`select codigo, tipo, valor, ativo, uma_por_cliente, limite_usos, pedido_minimo_centavos,
      to_char(inicio_em at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') as ini, to_char(fim_em at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') as fim
      from public.cupons where barraca_id = '${BARRACA}'`)
    assert.deepEqual(cupom, {
      codigo: 'PROMO10', tipo: 'percentual', valor: 10, ativo: false, uma_por_cliente: false, limite_usos: 50, pedido_minimo_centavos: 3000,
      ini: '2099-01-01 03:00:00.000', fim: '2100-01-01 02:59:59.999',
    })
    assert.equal((await aplicar(c.proposta_id as string, 'cupom')).estado, 'ja_aplicada')
    assert.equal((await linhas(`select count(*)::int as n from public.cupons where barraca_id = '${BARRACA}'`))[0].n, 1)
    const aud = await linhas(`select ferramenta from public.mcp_auditoria where argumentos ->> 'proposta_id' = '${c.proposta_id}'`)
    assert.ok(aud.length >= 3 && aud.every((a) => a.ferramenta === 'criar_cupom'))
  })

  test('código repetido é recusado ao propor e na aplicação; outra barraca pode usar o mesmo código', async () => {
    assert.equal((await criar('cupom', null, base)).estado, 'codigo_existe')
    const outra = await criar('cupom', null, { ...base, codigo: 'ABRIL5' })
    const concorrente = await criar('cupom', null, { ...base, codigo: 'ABRIL5' })
    await decidir(outra.proposta_id as string, true)
    await decidir(concorrente.proposta_id as string, true)
    assert.equal((await aplicar(outra.proposta_id as string, 'cupom')).estado, 'ok')
    assert.equal((await aplicar(concorrente.proposta_id as string, 'cupom')).estado, 'codigo_existe')
    assert.equal((await criar('cupom', null, base, TOKEN_2)).estado, 'ok')
  })

  test('fuso inválido na barraca cai em America/Sao_Paulo; validade vencida entre propor e aplicar é recusada', async () => {
    await db.query(`update public.barracas set fuso = 'Nao/Existe' where id = '${BARRACA}'`)
    const c = await criar('cupom', null, { ...base, codigo: 'FUSOERR', valido_ate: '2099-12-31' })
    assert.equal(c.estado, 'ok', JSON.stringify(c))
    await decidir(c.proposta_id as string, true)
    // simula a virada de dia: a validade da proposta já ficou no passado quando o dono aprovou
    await db.query(`update public.mcp_propostas set payload = jsonb_set(payload, '{valido_ate}', '"2021-01-01"') where id = '${c.proposta_id}'`)
    const r = await aplicar(c.proposta_id as string, 'cupom')
    assert.equal(r.estado, 'cupom_vencido', JSON.stringify(r))
    assert.equal((await linhas(`select count(*)::int as n from public.cupons where codigo = 'FUSOERR'`))[0].n, 0)
    await db.query(`update public.barracas set fuso = 'America/Sao_Paulo' where id = '${BARRACA}'`)
  })

  test('aplicar sem tipo esperado (formato antigo) só vale para preço, esgotado e estoque', async () => {
    const c = await criar('cupom', null, { ...base, codigo: 'LEGADO1' })
    await decidir(c.proposta_id as string, true)
    assert.equal((await aplicar(c.proposta_id as string, null)).estado, 'tipo_incorreto')
    assert.equal((await linhas(`select count(*)::int as n from public.cupons where codigo = 'LEGADO1'`))[0].n, 0)
    assert.equal((await aplicar(c.proposta_id as string, 'cupom')).estado, 'ok')
  })

  test('validação: código, tipo, valor, limite, mínimo e datas', async () => {
    const v = async (dados: Json) => (await criar('cupom', null, { ...base, codigo: 'VALIDO1', ...dados })).estado
    for (const codigo of ['ab', 'a b', 'ação', 'x'.repeat(21), '', 7]) assert.equal(await v({ codigo }), 'codigo_invalido', String(codigo))
    assert.equal(await v({ tipo_desconto: 'gratis' }), 'dados_invalidos')
    for (const valor of [0, 101, 5.5, '10', -1, null]) assert.equal(await v({ valor }), 'valor_invalido', String(valor))
    assert.equal(await v({ tipo_desconto: 'fixo', valor: 100000000 }), 'valor_invalido')
    for (const limite_usos of [0, 1000001, 1.5, '3']) assert.equal(await v({ limite_usos }), 'limite_invalido', String(limite_usos))
    for (const pedido_minimo_centavos of [-1, 2.5, '100']) assert.equal(await v({ pedido_minimo_centavos }), 'minimo_invalido', String(pedido_minimo_centavos))
    for (const valido_de of ['2026-02-31', 'amanha', '01/12/2099', 20990101, '2019-12-31']) assert.equal(await v({ valido_de }), 'data_invalida', String(valido_de))
    assert.equal(await v({ valido_ate: '2020-01-01' }), 'data_invalida', 'já venceu')
    assert.equal(await v({ valido_de: '2099-06-01', valido_ate: '2099-05-31' }), 'janela_invalida')
    assert.equal(await v({ tipo_desconto: 'percentual', valor: 100 }), 'ok', '100% é permitido (regra existente)')
  })

  test('aplicar com outro tipo esperado é recusado e não cria nada', async () => {
    const id = await aprovar('cupom', null, { ...base, codigo: 'TIPOERRADO' })
    assert.equal((await aplicar(id, 'preco')).estado, 'tipo_incorreto')
    assert.equal((await aplicar(id, 'foto')).estado, 'tipo_incorreto')
    assert.equal((await linhas(`select count(*)::int as n from public.cupons where codigo = 'TIPOERRADO'`))[0].n, 0)
    assert.equal((await aplicar(id, 'cupom')).estado, 'ok')
  })

  test('só o dono decide e a proposta não vaza para outra barraca', async () => {
    const c = await criar('cupom', null, { ...base, codigo: 'SOMEU' })
    assert.equal((await decidir(c.proposta_id as string, true, OUTRO)).estado, 'sem_acesso')
    assert.equal((await aplicar(c.proposta_id as string, 'cupom', TOKEN_2)).estado, 'nao_encontrada')
    const lista = (await rpc('authenticated', DONO, `public.mcp_proposta_listar('${BARRACA}')`)) as unknown as Json[]
    const p = lista.find((x) => x.id === c.proposta_id)
    assert.ok(p)
    assert.equal(p.tipo, 'cupom')
    assert.equal(p.item_nome, null)
    await decidir(c.proposta_id as string, false)
  })
})

describe('mcp foto', () => {
  const caminhos = (barraca = BARRACA, item = POKE, ext = 'jpg') => ({
    pendente: `${barraca}/pendente/${UUID_PEND}.${ext}`,
    destino: `${barraca}/${item}-0123456789abcdef.${ext}`,
    destino_url: `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${barraca}/${item}-0123456789abcdef.${ext}`,
    bytes: 120000, largura: 800, altura: 600,
  })

  test('propor guarda caminhos, aprovar libera o preparo e aplicar troca a foto e devolve a antiga', async () => {
    await db.exec(`update public.itens set foto_url = 'https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${BARRACA}/${POKE}-antiga.jpg' where id = '${POKE}'`)
    const c = await criar('foto', POKE, caminhos())
    assert.equal(c.estado, 'ok', JSON.stringify(c))
    assert.equal(c.tinha_foto, true)
    assert.equal((await rpc('service_role', null, 'public.mcp_foto_preparar($1, $2)', [TOKEN, c.proposta_id])).estado, 'aguardando_aprovacao')
    await decidir(c.proposta_id as string, true)
    const prep = await rpc('service_role', null, 'public.mcp_foto_preparar($1, $2)', [TOKEN, c.proposta_id])
    assert.deepEqual([prep.estado, prep.pendente, prep.destino], ['ok', caminhos().pendente, caminhos().destino])
    const r = await aplicar(c.proposta_id as string, 'foto')
    assert.equal(r.estado, 'ok', JSON.stringify(r))
    assert.equal(r.foto_antiga_url, `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${BARRACA}/${POKE}-antiga.jpg`)
    assert.equal((await linhas(`select foto_url from public.itens where id = '${POKE}'`))[0].foto_url, caminhos().destino_url)
    assert.equal((await aplicar(c.proposta_id as string, 'foto')).estado, 'ja_aplicada')
    assert.equal((await rpc('service_role', null, 'public.mcp_foto_preparar($1, $2)', [TOKEN, c.proposta_id])).estado, 'ja_aplicada')
  })

  test('foto antiga usada por outro item não é devolvida para apagar; item que mudou invalida', async () => {
    const compartilhada = `https://x.supabase.co/storage/v1/object/public/cardapio-fotos/${BARRACA}/${SUSHI}-comum.jpg`
    await db.exec(`update public.itens set foto_url = '${compartilhada}' where id in ('${POKE}', '${SUSHI}')`)
    const a = await aprovar('foto', SUSHI, { ...caminhos(BARRACA, SUSHI, 'png') })
    const r = await aplicar(a, 'foto')
    assert.equal(r.estado, 'ok')
    assert.equal(r.foto_antiga_url, null)
    const b = await aprovar('foto', POKE, { ...caminhos(BARRACA, POKE, 'webp') })
    await db.exec(`update public.itens set foto_url = 'https://x/outra.jpg' where id = '${POKE}'`)
    assert.equal((await aplicar(b, 'foto')).estado, 'item_mudou')
  })

  test('caminhos de outra barraca, de outro item, extensão trocada, url que não termina no destino e tamanhos absurdos são recusados', async () => {
    const ok = caminhos()
    const casos: Json[] = [
      { ...ok, pendente: `${BARRACA_2}/pendente/${UUID_PEND}.jpg` },
      { ...ok, pendente: `${BARRACA}/outra/${UUID_PEND}.jpg` },
      { ...ok, pendente: `${BARRACA}/pendente/../${UUID_PEND}.jpg` },
      { ...ok, destino: `${BARRACA}/${SUSHI}-0123456789abcdef.jpg` },
      { ...ok, destino: `${BARRACA}/${POKE}-0123456789abcdef.png` },
      { ...ok, destino_url: 'https://x.supabase.co/storage/v1/object/public/cardapio-fotos/outro.jpg' },
      { ...ok, destino_url: ok.destino_url.replace('https', 'http') },
      { ...ok, destino_url: `${ok.destino_url} ` },
      { ...ok, bytes: 5242881 }, { ...ok, bytes: 0 }, { ...ok, largura: 8001 }, { ...ok, altura: 0 }, { ...ok, bytes: '10' },
    ]
    for (const dados of casos) assert.equal((await criar('foto', POKE, dados)).estado, 'dados_invalidos', JSON.stringify(dados))
    assert.equal((await criar('foto', ESTRANHO, ok)).estado, 'item_nao_encontrado')
    assert.equal((await criar('foto', null, ok)).estado, 'item_nao_encontrado')
  })

  test('limpeza: lista só arquivo pendente que já não serve, uma vez só, e só da barraca do token', async () => {
    const recusada = await criar('foto', SUSHI, { ...caminhos(BARRACA, SUSHI, 'jpg'), pendente: `${BARRACA}/pendente/f2000000-0000-4000-8000-000000000002.jpg` })
    const viva = await criar('foto', SUSHI, { ...caminhos(BARRACA, SUSHI, 'jpg'), pendente: `${BARRACA}/pendente/f3000000-0000-4000-8000-000000000003.jpg` })
    await decidir(recusada.proposta_id as string, false)
    const lista = (await rpc('service_role', null, 'public.mcp_fotos_limpar_listar($1)', [TOKEN])) as unknown as Array<{ id: string; pendente: string }>
    const ids = lista.map((x) => x.id)
    assert.ok(ids.includes(recusada.proposta_id as string))
    assert.ok(!ids.includes(viva.proposta_id as string), 'proposta ainda pendente não é limpa')
    assert.deepEqual(await rpc('service_role', null, 'public.mcp_fotos_limpar_listar($1)', [TOKEN_2]), [])
    await rpc('service_role', null, 'public.mcp_fotos_limpar_marcar($1, $2::uuid[])', [TOKEN_2, `{${ids.join(',')}}`]).catch(() => null)
    assert.ok(((await rpc('service_role', null, 'public.mcp_fotos_limpar_listar($1)', [TOKEN])) as unknown as Json[]).length >= 1, 'outro token não marca')
    await rpc('service_role', null, 'public.mcp_fotos_limpar_marcar($1, $2::uuid[])', [TOKEN, `{${ids.join(',')}}`])
    assert.deepEqual(await rpc('service_role', null, 'public.mcp_fotos_limpar_listar($1)', [TOKEN]), [])
    await decidir(viva.proposta_id as string, false)
  })

  test('limpeza devolve destino só de proposta não aplicada e sem uso, e a foto antiga só de aplicada que ninguém usa mais', async () => {
    const lista = async () => (await rpc('service_role', null, 'public.mcp_fotos_limpar_listar($1)', [TOKEN])) as unknown as Array<{ id: string; destino: string | null; antiga: string | null }>
    const marcar = async (ids: string[]) => rpc('service_role', null, 'public.mcp_fotos_limpar_marcar($1, $2::uuid[])', [TOKEN, `{${ids.join(',')}}`])
    await marcar((await lista()).map((x) => x.id))
    await db.query(`update public.itens set foto_url = null where id = '${SUSHI}'`)
    const recusada = await criar('foto', SUSHI, caminhos(BARRACA, SUSHI, 'png'))
    await decidir(recusada.proposta_id as string, false)
    const l1 = await lista()
    assert.equal(l1.find((x) => x.id === recusada.proposta_id)?.destino, caminhos(BARRACA, SUSHI, 'png').destino)
    // se um item já aponta para esse destino (aplicação concorrente), ele NÃO é devolvido
    await db.query(`update public.itens set foto_url = $1 where id = '${SUSHI}'`, [caminhos(BARRACA, SUSHI, 'png').destino_url])
    assert.equal((await lista()).find((x) => x.id === recusada.proposta_id)?.destino ?? null, null)
    await marcar([recusada.proposta_id as string])
    // aplicada: destino nunca; antiga só quando nenhum item a usa
    const nova = await criar('foto', SUSHI, caminhos(BARRACA, SUSHI, 'jpg'))
    await decidir(nova.proposta_id as string, true)
    assert.equal((await aplicar(nova.proposta_id as string, 'foto')).estado, 'ok')
    const l2 = (await lista()).find((x) => x.id === nova.proposta_id)
    assert.equal(l2?.destino ?? null, null)
    assert.equal(l2?.antiga, caminhos(BARRACA, SUSHI, 'png').destino_url)
    await db.query(`update public.itens set foto_url = $1 where id = '${POKE}'`, [caminhos(BARRACA, SUSHI, 'png').destino_url])
    assert.equal((await lista()).find((x) => x.id === nova.proposta_id)?.antiga ?? null, null, 'foto antiga ainda usada por outro item fica')
    await marcar([nova.proposta_id as string])
  })
})

describe('mcp cardápio', () => {
  const it = (nome: string, preco: number, categoria: string | null = null, descricao: string | null = null) => ({ nome, preco_centavos: preco, categoria, descricao })

  test('a chave de nome do SQL concorda com a do app', async () => {
    for (const t of ['  Pastéis  Fritos ', 'ÇÃO', 'Açaí', 'São João', 'ÁÉÍÓÚ àèìòù âêîôû ãõ ü ñ', 'X', 'Café   com  leite', 'Café São', 'CAFÉ']) {
      const r = (await db.query<{ r: string }>('select public._mcp_chave_nome($1) as r', [t])).rows[0].r
      assert.equal(r, chaveNome(t), t)
    }
  })

  test('propor devolve o resumo, não grava nada, e aplicar cria categorias e itens só do que falta', async () => {
    await db.exec(`
      insert into public.categorias (id, barraca_id, nome, ordem) values ('c1000000-0000-4000-8000-000000000001', '${BARRACA}', 'Pastéis', 4);
      insert into public.itens (barraca_id, nome, preco_centavos, categoria_id, ordem) values
        ('${BARRACA}', 'Pastel de carne', 850, 'c1000000-0000-4000-8000-000000000001', 9),
        ('${BARRACA}', 'Suco', 500, null, 10),
        ('${BARRACA_2}', 'Pastel de queijo', 100, null, 1);`)
    const itens = [
      it('PASTEL DE CARNE', 900, 'Pasteis'), // já existe (sem acento/maiúscula): pulado
      it('Pastel de queijo', 800, 'pastéis', 'Queijo'), // categoria existente
      it('pastel de queijo ', 950, 'Pastéis'), // repetido no envio: vale o primeiro
      it('Caldo de cana', 700, 'Bebidas', 'Gelado'), // categoria nova
      it('Água', 300, 'bebidas'),
      it('Suco', 500, 'Sem categoria'), // sem categoria e já existe
      it('Brigadeiro', 400),
      it('Dado "estranho"', 100, 'Doces'),
    ]
    const antes = (await linhas(`select count(*)::int as n from public.itens where barraca_id = '${BARRACA}'`))[0].n
    const c = await criar('cardapio', null, { itens })
    assert.equal(c.estado, 'ok', JSON.stringify(c))
    assert.deepEqual([c.total, c.a_criar, c.categorias_novas], [8, 5, ['Bebidas', 'Doces']])
    assert.equal((c.amostra as Json[]).length, 5)
    assert.equal((await linhas(`select count(*)::int as n from public.itens where barraca_id = '${BARRACA}'`))[0].n, antes)
    assert.equal((await aplicar(c.proposta_id as string, 'cardapio')).estado, 'aguardando_aprovacao')

    const lista = (await rpc('authenticated', DONO, `public.mcp_proposta_listar('${BARRACA}')`)) as unknown as Json[]
    const p = lista.find((x) => x.id === c.proposta_id) as { payload: Json }
    assert.equal(p.payload.a_criar, 5)
    assert.equal('itens' in p.payload, false, 'a listagem não devolve os itens inteiros')

    await decidir(c.proposta_id as string, true)
    const r = await aplicar(c.proposta_id as string, 'cardapio')
    assert.equal(r.estado, 'ok', JSON.stringify(r))
    assert.deepEqual([r.criados, r.categorias_criadas, r.pulados], [5, 2, 0])
    const novos = await linhas(`select i.nome, i.preco_centavos, i.descricao, i.ativo, i.ordem, c.nome as categoria, c.ordem as cat_ordem
      from public.itens i left join public.categorias c on c.id = i.categoria_id
      where i.barraca_id = '${BARRACA}' and i.ordem > 10 order by i.ordem`)
    assert.deepEqual(novos, [
      { nome: 'Pastel de queijo', preco_centavos: 800, descricao: 'Queijo', ativo: true, ordem: 11, categoria: 'Pastéis', cat_ordem: 4 },
      { nome: 'Caldo de cana', preco_centavos: 700, descricao: 'Gelado', ativo: true, ordem: 12, categoria: 'Bebidas', cat_ordem: 5 },
      { nome: 'Água', preco_centavos: 300, descricao: null, ativo: true, ordem: 13, categoria: 'Bebidas', cat_ordem: 5 },
      { nome: 'Brigadeiro', preco_centavos: 400, descricao: null, ativo: true, ordem: 14, categoria: null, cat_ordem: null },
      { nome: 'Dado "estranho"', preco_centavos: 100, descricao: null, ativo: true, ordem: 15, categoria: 'Doces', cat_ordem: 6 },
    ])
    // item que já existia não foi tocado
    assert.deepEqual((await linhas(`select preco_centavos from public.itens where barraca_id = '${BARRACA}' and nome = 'Pastel de carne'`)), [{ preco_centavos: 850 }])
    // aplicar de novo não duplica; propor a mesma lista de novo não tem o que criar
    assert.equal((await aplicar(c.proposta_id as string, 'cardapio')).estado, 'ja_aplicada')
    assert.equal((await criar('cardapio', null, { itens })).estado, 'sem_mudanca')
    assert.equal((await linhas(`select count(*)::int as n from public.itens where barraca_id = '${BARRACA}'`))[0].n, antes + 5)
    assert.equal((await linhas(`select count(*)::int as n from public.itens where barraca_id = '${BARRACA_2}'`))[0].n, 2)
  })

  test('o que já existia ao propor nunca entra na aplicação, mesmo se o item for apagado depois (só o que o dono viu é criado)', async () => {
    const c = await criar('cardapio', null, { itens: [it('Item velho do dono', 500, null), it('Item novo da IA', 100, null)] })
    assert.equal(c.estado, 'ok')
    await db.query(`insert into public.itens (barraca_id, nome, preco_centavos, ativo, ordem) values ('${BARRACA}', 'Item velho do dono', 500, true, 999)`)
    const c2 = await criar('cardapio', null, { itens: [it('Item velho do dono', 500, null), it('Item novo B', 100, null)] })
    assert.equal(c2.a_criar, 1)
    await db.query(`delete from public.itens where barraca_id = '${BARRACA}' and nome = 'Item velho do dono'`)
    await decidir(c2.proposta_id as string, true)
    const r = await aplicar(c2.proposta_id as string, 'cardapio')
    assert.equal(r.criados, 1, JSON.stringify(r))
    assert.equal((await linhas(`select count(*)::int as n from public.itens where barraca_id = '${BARRACA}' and nome = 'Item velho do dono'`))[0].n, 0)
    await decidir(c.proposta_id as string, false)
  })

  test('na aplicação, o que o dono cadastrou depois da proposta é pulado (repetível, nunca duplica)', async () => {
    const c = await criar('cardapio', null, { itens: [it('Tapioca', 1000, 'Lanches'), it('Cuscuz', 900, 'Lanches')] })
    await decidir(c.proposta_id as string, true)
    await db.exec(`insert into public.categorias (barraca_id, nome, ordem) values ('${BARRACA}', 'LANCHES', 50);
      insert into public.itens (barraca_id, nome, preco_centavos, categoria_id, ordem)
        select '${BARRACA}', 'tapioca', 111, id, 99 from public.categorias where nome = 'LANCHES' and barraca_id = '${BARRACA}'`)
    const r = await aplicar(c.proposta_id as string, 'cardapio')
    assert.deepEqual([r.estado, r.criados, r.categorias_criadas, r.pulados], ['ok', 1, 0, 1])
    assert.equal((await linhas(`select count(*)::int as n from public.categorias where barraca_id = '${BARRACA}' and public._mcp_chave_nome(nome) = 'lanches'`))[0].n, 1)
    assert.deepEqual(await linhas(`select preco_centavos from public.itens where barraca_id = '${BARRACA}' and nome = 'tapioca'`), [{ preco_centavos: 111 }])
  })

  test('validação: limite de 300, vazio, campos inválidos e nada que o servidor não conheça', async () => {
    const muitos = Array.from({ length: 301 }, (_, i) => it(`Item ${i}`, 100))
    assert.equal((await criar('cardapio', null, { itens: muitos })).estado, 'dados_invalidos')
    assert.equal((await criar('cardapio', null, { itens: [] })).estado, 'dados_invalidos')
    assert.equal((await criar('cardapio', null, { itens: 'x' })).estado, 'dados_invalidos')
    for (const ruim of [
      { nome: '', preco_centavos: 100 }, { nome: 'x'.repeat(81), preco_centavos: 100 }, { nome: 'A', preco_centavos: 0 },
      { nome: 'A', preco_centavos: 12.5 }, { nome: 'A', preco_centavos: '100' }, { nome: 'A', preco_centavos: 100000000 },
      { nome: 'A', preco_centavos: 100, categoria: 'c'.repeat(61) }, { nome: 'A', preco_centavos: 100, descricao: 'd'.repeat(301) },
      { nome: 'A', preco_centavos: 100, categoria: 5 }, { nome: 7, preco_centavos: 100 }, 'texto', null,
    ]) {
      assert.equal((await criar('cardapio', null, { itens: [ruim] })).estado, 'dados_invalidos', JSON.stringify(ruim))
    }
    const exato = Array.from({ length: 300 }, (_, i) => it(`Lote ${i}`, 100 + i, 'Lote'))
    const c = await criar('cardapio', null, { itens: exato })
    assert.equal(c.estado, 'ok', JSON.stringify(c))
    assert.equal(c.a_criar, 300)
    const id = c.proposta_id as string
    await decidir(id, true)
    const r = await aplicar(id, 'cardapio')
    assert.deepEqual([r.estado, r.criados, r.categorias_criadas], ['ok', 300, 1])
    // campos extras são descartados do que fica guardado
    const e = await criar('cardapio', null, { itens: [{ ...it('Extra', 100), id: 'x', barraca_id: BARRACA_2, ativo: false }] })
    const [guardado] = await linhas(`select payload from public.mcp_propostas where id = '${e.proposta_id}'`)
    assert.deepEqual((guardado.payload as { itens: Json[] }).itens, [{ categoria: null, nome: 'Extra', preco_centavos: 100, descricao: null }])
    await decidir(e.proposta_id as string, false)
  })
})

describe('mcp limite de chamadas e purga', () => {
  const limite = (token: string, min = 60, dia = 2000) => rpc('service_role', null, 'public.mcp_limite_registrar($1, $2, $3)', [token, min, dia])

  test('60 por minuto e 2000 por dia por token; recusa não gasta a cota do dia; um token não afeta o outro', async () => {
    for (let i = 1; i <= 60; i++) assert.equal((await limite(TOKEN)).estado, 'ok', `chamada ${i}`)
    const r = await limite(TOKEN)
    assert.equal(r.estado, 'limite_minuto')
    assert.ok((r.retry_em as number) >= 1 && (r.retry_em as number) <= 60)
    assert.equal((await limite(TOKEN_2)).estado, 'ok')
    const [dia] = await linhas(`select n from public.mcp_uso where token_id = '${TOKEN}' and tipo = 'dia'`)
    assert.equal(dia.n, 60, 'só as 60 aceitas contam no dia')
  })

  test('limite diário', async () => {
    await db.exec(`delete from public.mcp_uso where token_id = '${TOKEN_2}'`)
    for (let i = 0; i < 3; i++) assert.equal((await limite(TOKEN_2, 100, 3)).estado, 'ok')
    const r = await limite(TOKEN_2, 100, 3)
    assert.equal(r.estado, 'limite_dia')
    assert.ok((r.retry_em as number) >= 1 && (r.retry_em as number) <= 86400)
  })

  test('token revogado depois da validação inicial não é admitido nem gasta cota', async () => {
    await db.exec(`delete from public.mcp_uso where token_id = '${TOKEN_2}'`)
    await db.exec(`update public.mcp_tokens set revogado_em = now() where id = '${TOKEN_2}'`)
    assert.equal((await limite(TOKEN_2)).estado, 'token_invalido')
    assert.equal((await linhas(`select count(*)::int as n from public.mcp_uso where token_id = '${TOKEN_2}'`))[0].n, 0)
    await db.exec(`update public.mcp_tokens set revogado_em = null where id = '${TOKEN_2}'`)
  })

  test('quem não é service_role não conta nem purga', async () => {
    for (const papel of ['anon', 'authenticated'] as const) {
      await assert.rejects(rpc(papel, DONO, 'public.mcp_limite_registrar($1, 60, 2000)', [TOKEN]), /permission denied/)
      await assert.rejects(rpc(papel, DONO, 'public.mcp_auditoria_purgar(90)'), /permission denied/)
    }
  })

  test('purga: apaga auditoria e propostas decididas antigas, mantém as recentes e a foto ainda não limpa; mínimo de 30 dias', async () => {
    await db.exec(`
      insert into public.mcp_auditoria (barraca_id, token_id, ferramenta, resultado, criado_em) values
        ('${BARRACA}', '${TOKEN}', 'velha', 'x', now() - interval '91 days'),
        ('${BARRACA}', '${TOKEN}', 'recente', 'x', now() - interval '89 days');
      insert into public.mcp_propostas (barraca_id, token_id, item_id, tipo, preco_de, preco_para, estado, criado_em) values
        ('${BARRACA}', '${TOKEN}', '${POKE}', 'preco', 100, 200, 'aplicada', now() - interval '100 days'),
        ('${BARRACA}', '${TOKEN}', '${POKE}', 'preco', 100, 300, 'recusada', now() - interval '10 days');
      insert into public.mcp_propostas (barraca_id, token_id, item_id, tipo, payload, estado, criado_em) values
        ('${BARRACA}', '${TOKEN}', '${POKE}', 'foto', '{"pendente":"a","destino":"b","destino_url":"c"}', 'recusada', now() - interval '100 days'),
        ('${BARRACA}', '${TOKEN}', '${POKE}', 'foto', '{"pendente":"a","destino":"b","destino_url":"c","limpo_em":"2026-01-01"}', 'recusada', now() - interval '100 days');
      insert into public.mcp_uso (token_id, tipo, janela, n) values ('${TOKEN}', 'min', now() - interval '3 days', 5);`)
    assert.equal((await rpc('service_role', null, 'public.mcp_auditoria_purgar(29)')).estado, 'dias_invalido')
    assert.equal((await rpc('service_role', null, 'public.mcp_auditoria_purgar(null)')).estado, 'dias_invalido')
    const r = await rpc('service_role', null, 'public.mcp_auditoria_purgar(90)')
    assert.equal(r.estado, 'ok')
    assert.equal(r.propostas, 2, 'a aplicada antiga e a foto já limpa')
    assert.equal((await linhas(`select count(*)::int as n from public.mcp_auditoria where ferramenta = 'velha'`))[0].n, 0)
    assert.equal((await linhas(`select count(*)::int as n from public.mcp_auditoria where ferramenta = 'recente'`))[0].n, 1)
    assert.equal((await linhas(`select count(*)::int as n from public.mcp_propostas where tipo = 'foto' and criado_em < now() - interval '99 days'`))[0].n, 1)
    assert.equal((await linhas(`select count(*)::int as n from public.mcp_uso where janela < now() - interval '2 days'`))[0].n, 0)
  })
})
