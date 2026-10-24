// Migration do bot de WhatsApp (integracao_cardapio + conversa_id): texto e execução no PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261031100000_integracao_v1_bot.sql', import.meta.url), 'utf8')
const B1 = 'b1000000-0000-4000-8000-000000000001'

describe('migration integracao_v1_bot (texto)', () => {
  test('Rollback no topo', () => {
    assert.match(sql.split('\n').slice(0, 6).join('\n'), /-- Rollback:/)
  })
  test('security definer, search_path fixo e grants só para service_role', () => {
    assert.match(sql, /security definer/i)
    assert.match(sql, /set search_path = public, pg_temp/i)
    assert.match(sql, /revoke all on function public\.integracao_cardapio\(uuid\) from public, anon, authenticated/i)
    assert.match(sql, /grant execute on function public\.integracao_cardapio\(uuid\) to service_role/i)
  })
})

describe('migration integracao_v1_bot (PGlite)', () => {
  let db: PGlite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardapio = async (id: string): Promise<any> => (await db.query<{ r: unknown }>('select public.integracao_cardapio($1) as r', [id])).rows[0].r

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create table public.barracas (id uuid primary key, nome text, slug text, modos_atendimento text[], pagar_na_entrega_habilitado boolean,
        pagamento_online_habilitado boolean, perfil_cliente_obrigatorio boolean, ia_habilitada boolean, ia_whatsapp_dono text,
        ia_whatsapp_dono_confirmado_em timestamptz, bloquear_fora_do_horario boolean, fuso text, opcoes_habilitado boolean not null default false);
      create table public.horarios_funcionamento (barraca_id uuid, dia_semana int, aberto boolean, hora_abertura text, hora_fechamento text);
      create table public.categorias (id uuid primary key, barraca_id uuid, nome text, ordem int default 0);
      create table public.itens (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, descricao text, preco_centavos int,
        categoria_id uuid, ativo boolean default true, esgotado boolean default false, preco_aberto boolean default false, ordem int default 0);
      create table public.grupos_opcoes (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, tipo text, min_escolhas int,
        max_escolhas int, ordem int default 0, ativo boolean default true);
      create table public.opcoes (id uuid primary key default gen_random_uuid(), grupo_id uuid, barraca_id uuid, nome text, preco_centavos int,
        ordem int default 0, ativo boolean default true, esgotado boolean default false);
      create table public.itens_grupos (item_id uuid, grupo_id uuid, barraca_id uuid, ordem int default 0);
      create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid());
      grant usage on schema public to service_role, authenticated, anon;
      insert into public.barracas (id, nome, slug, modos_atendimento, ia_habilitada) values ('${B1}', 'Loja', 'loja', '{retirada}', true);
      insert into public.categorias values ('c1000000-0000-4000-8000-000000000001', '${B1}', 'Pratos', 0);
      insert into public.itens (id, barraca_id, nome, preco_centavos, categoria_id) values
        ('a1000000-0000-4000-8000-000000000001', '${B1}', 'Yakisoba', 3000, 'c1000000-0000-4000-8000-000000000001');
      insert into public.itens (barraca_id, nome, preco_centavos, ativo) values ('${B1}', 'Inativo', 100, false);
      insert into public.itens (barraca_id, nome, preco_centavos, preco_aberto) values ('${B1}', 'Aberto', 0, true);
      insert into public.itens (barraca_id, nome, preco_centavos, esgotado) values ('${B1}', 'Esgotado', 500, true);
      insert into public.grupos_opcoes (id, barraca_id, nome, tipo, min_escolhas, max_escolhas)
        values ('90000000-0000-4000-8000-000000000001', '${B1}', 'Extras', 'adicional', 0, 2);
      insert into public.opcoes (grupo_id, barraca_id, nome, preco_centavos) values ('90000000-0000-4000-8000-000000000001', '${B1}', 'Ovo', 200);
      insert into public.opcoes (grupo_id, barraca_id, nome, preco_centavos, ativo)
        values ('90000000-0000-4000-8000-000000000001', '${B1}', 'Oculta', 1, false);
      insert into public.itens_grupos values ('a1000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '${B1}', 0);
      grant select on all tables in schema public to service_role;
    `)
    await db.exec(sql)
    await db.exec(sql) // idempotente
    await db.exec('set role service_role')
  })
  after(async () => {
    await db.close()
  })

  test('conversa_id nasce nulo e recusa texto vazio ou enorme', async () => {
    await db.exec('reset role')
    await db.exec('insert into public.pagamentos_pendentes default values')
    assert.equal((await db.query<{ c: string | null }>('select conversa_id as c from public.pagamentos_pendentes')).rows[0].c, null)
    await assert.rejects(db.exec(`update public.pagamentos_pendentes set conversa_id = ''`))
    await assert.rejects(db.exec(`update public.pagamentos_pendentes set conversa_id = repeat('x', 201)`))
    await db.exec(`update public.pagamentos_pendentes set conversa_id = 'sessao:1'`)
    await db.exec('set role service_role')
  })

  test('barraca inexistente devolve null', async () => {
    assert.equal(await cardapio('c0000000-0000-4000-8000-000000000000'), null)
  })

  test('itens ativos, sem preço aberto; esgotado marcado; grupos fora quando opcoes_habilitado é falso', async () => {
    const r = await cardapio(B1)
    assert.equal(r.loja.slug, 'loja')
    assert.deepEqual(r.itens.map((i: { nome: string }) => i.nome).sort(), ['Esgotado', 'Yakisoba'])
    const y = r.itens.find((i: { nome: string }) => i.nome === 'Yakisoba')
    assert.equal(y.categoria, 'Pratos')
    assert.equal(y.preco_centavos, 3000)
    assert.deepEqual(y.grupos, [])
    assert.equal(r.itens.find((i: { nome: string }) => i.nome === 'Esgotado').esgotado, true)
  })

  test('com opcoes_habilitado devolve grupos e só opções ativas', async () => {
    await db.exec('reset role')
    await db.exec('update public.barracas set opcoes_habilitado = true')
    await db.exec('set role service_role')
    const y = (await cardapio(B1)).itens.find((i: { nome: string }) => i.nome === 'Yakisoba')
    assert.equal(y.grupos.length, 1)
    assert.equal(y.grupos[0].nome, 'Extras')
    assert.deepEqual(
      y.grupos[0].opcoes.map((o: { nome: string; preco_adicional_centavos: number }) => [o.nome, o.preco_adicional_centavos]),
      [['Ovo', 200]],
    )
  })

  test('authenticated e anon não executam', async () => {
    for (const papel of ['authenticated', 'anon']) {
      await db.exec(`set role ${papel}`)
      await assert.rejects(cardapio(B1), /permission denied/i, papel)
    }
    await db.exec('set role service_role')
  })
})
