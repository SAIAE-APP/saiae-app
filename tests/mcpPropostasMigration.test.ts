// Gestão por IA (MCP): migrations 20261127100000, 20261127110000 e 20261128100000 rodando de verdade no PGlite
// (propostas de preço, esgotado e estoque; resumo de vendas). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const DONO = 'd0000000-0000-4000-8000-000000000001'
const OUTRO = 'd0000000-0000-4000-8000-000000000002'
const BARRACA = 'b1000000-0000-4000-8000-000000000001'
const BARRACA_2 = 'b2000000-0000-4000-8000-000000000002'
const TOKEN = 'a1000000-0000-4000-8000-000000000001'
const TOKEN_REVOGADO = 'a2000000-0000-4000-8000-000000000002'
const POKE = 'e1000000-0000-4000-8000-000000000001'
const SUSHI = 'e2000000-0000-4000-8000-000000000002'
const ESTRANHO = 'e3000000-0000-4000-8000-000000000003'
const ABERTO = 'e4000000-0000-4000-8000-000000000004'

type Json = Record<string, unknown>
let db: PGlite

async function rpc(papel: 'service_role' | 'authenticated', uid: string | null, chamada: string): Promise<Json> {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
  try {
    return (await db.query<{ r: Json }>(`select ${chamada} as r`)).rows[0].r
  } finally {
    await db.exec('reset role')
  }
}
const criar = (tipo: string, item: string, dados: Json, token = TOKEN) =>
  rpc('service_role', null, `public.mcp_proposta_criar('${token}', '${tipo}', '${item}', '${JSON.stringify(dados)}'::jsonb)`)
const aplicar = (proposta: string, token = TOKEN) => rpc('service_role', null, `public.mcp_proposta_aplicar('${token}', '${proposta}')`)
const decidir = (proposta: string, aprovar: boolean, uid = DONO) =>
  rpc('authenticated', uid, `public.mcp_proposta_decidir('${proposta}', ${aprovar})`)
const item = async (id: string) =>
  (await db.query<Json>(`select preco_centavos, esgotado, estoque_qtd, estoque_esgotado_auto from public.itens where id = '${id}'`)).rows[0]
const estado = async (id: string) => (await db.query<{ estado: string }>(`select estado from public.mcp_propostas where id = '${id}'`)).rows[0].estado
const aprovada = async (tipo: string, itemId: string, dados: Json) => {
  const c = await criar(tipo, itemId, dados)
  assert.equal(c.estado, 'ok', JSON.stringify(c))
  assert.equal((await decidir(c.proposta_id as string, true)).estado, 'ok')
  return c.proposta_id as string
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema extensions;
    grant usage on schema public to authenticated, anon, service_role;
    create table public.barracas (id uuid primary key, nome text, fuso text not null default 'America/Sao_Paulo');
    create table public.usuarios_barracas (barraca_id uuid, usuario_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable as
      $$ select exists (select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.itens (
      id uuid primary key, barraca_id uuid not null references public.barracas(id), nome text not null,
      preco_centavos integer not null default 0, preco_aberto boolean not null default false,
      esgotado boolean not null default false);
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
  await db.exec(sql('20261127100000_mcp_gestao.sql'))
  await db.exec(sql('20261127110000_mcp_aprovacao.sql'))
  await db.exec(sql('20261128100000_mcp_propostas_tipos.sql'))
  await db.exec(`
    insert into public.itens (id, barraca_id, nome, preco_centavos, preco_aberto, esgotado) values
      ('${POKE}', '${BARRACA}', 'Poke', 3800, false, false),
      ('${SUSHI}', '${BARRACA}', 'Sushi', 5000, false, false),
      ('${ABERTO}', '${BARRACA}', 'Livre', 0, true, false),
      ('${ESTRANHO}', '${BARRACA_2}', 'Alheio', 1000, false, false);
    insert into public.mcp_tokens (id, barraca_id, nome, token_hash, prefixo, criado_por) values
      ('${TOKEN}', '${BARRACA}', 'ChatGPT', 'h1', 'sae_aaaa', '${DONO}');
    insert into public.mcp_tokens (id, barraca_id, nome, token_hash, prefixo, criado_por, revogado_em) values
      ('${TOKEN_REVOGADO}', '${BARRACA}', 'Antigo', 'h2', 'sae_bbbb', '${DONO}', now());
  `)
})

after(async () => {
  await db.close()
})

describe('mcp propostas: preço (compatibilidade)', () => {
  test('propor, aprovar pelo dono e aplicar grava o preço e audita', async () => {
    const c = await criar('preco', POKE, { para: 3400 })
    assert.equal(c.estado, 'ok')
    assert.equal(c.de, 3800)
    assert.equal((await aplicar(c.proposta_id as string)).estado, 'aguardando_aprovacao')
    assert.equal((await item(POKE)).preco_centavos, 3800)
    assert.equal((await decidir(c.proposta_id as string, true)).estado, 'ok')
    const r = await aplicar(c.proposta_id as string)
    assert.equal(r.estado, 'ok')
    assert.equal(r.para, 3400)
    assert.equal((await item(POKE)).preco_centavos, 3400)
    assert.equal((await aplicar(c.proposta_id as string)).estado, 'ja_aplicada')
    const aud = await db.query<{ ferramenta: string }>(`select ferramenta from public.mcp_auditoria where argumentos ->> 'proposta_id' = '${c.proposta_id}'`)
    assert.ok(aud.rows.every((a) => a.ferramenta === 'alterar_preco_item'))
  })

  test('recusas: preço inválido, igual, preço aberto, item de outra barraca, token revogado, tipo desconhecido', async () => {
    assert.equal((await criar('preco', POKE, { para: 0 })).estado, 'preco_invalido')
    assert.equal((await criar('preco', POKE, { para: 12.5 })).estado, 'preco_invalido')
    assert.equal((await criar('preco', POKE, { para: '3400' })).estado, 'preco_invalido')
    assert.equal((await criar('preco', POKE, { para: 3400 })).estado, 'sem_mudanca')
    assert.equal((await criar('preco', ABERTO, { para: 100 })).estado, 'preco_aberto')
    assert.equal((await criar('preco', ESTRANHO, { para: 100 })).estado, 'item_nao_encontrado')
    assert.equal((await criar('preco', SUSHI, { para: 100 }, TOKEN_REVOGADO)).estado, 'token_invalido')
    assert.equal((await criar('apagar', SUSHI, { para: 100 })).estado, 'tipo_invalido')
  })

  test('só o dono da barraca decide; recusar não aplica; preço que mudou invalida', async () => {
    const c = await criar('preco', SUSHI, { para: 4500 })
    assert.equal((await decidir(c.proposta_id as string, true, OUTRO)).estado, 'sem_acesso')
    assert.equal((await decidir(c.proposta_id as string, false)).estado, 'ok')
    assert.equal((await aplicar(c.proposta_id as string)).estado, 'recusada')
    const d = await criar('preco', SUSHI, { para: 4600 })
    await decidir(d.proposta_id as string, true)
    await db.exec(`update public.itens set preco_centavos = 5100 where id = '${SUSHI}'`)
    assert.equal((await aplicar(d.proposta_id as string)).estado, 'preco_mudou')
    assert.equal((await item(SUSHI)).preco_centavos, 5100)
    await db.exec(`update public.itens set preco_centavos = 5000 where id = '${SUSHI}'`)
  })
})

describe('mcp propostas: esgotado', () => {
  test('marca esgotado como manual (auto = false) e depois volta a vender', async () => {
    const id = await aprovada('esgotado', SUSHI, { para: true })
    const r = await aplicar(id)
    assert.equal(r.estado, 'ok')
    assert.deepEqual(await item(SUSHI), { preco_centavos: 5000, esgotado: true, estoque_qtd: null, estoque_esgotado_auto: false })
    assert.equal((await criar('esgotado', SUSHI, { para: true })).estado, 'sem_mudanca')
    const volta = await aprovada('esgotado', SUSHI, { para: false })
    assert.equal((await aplicar(volta)).estado, 'ok')
    assert.equal((await item(SUSHI)).esgotado, false)
  })

  test('dados inválidos e dono ainda não aprovou', async () => {
    assert.equal((await criar('esgotado', SUSHI, { para: 'sim' })).estado, 'dados_invalidos')
    assert.equal((await criar('esgotado', SUSHI, {})).estado, 'dados_invalidos')
    const c = await criar('esgotado', SUSHI, { para: true })
    assert.equal((await aplicar(c.proposta_id as string)).estado, 'aguardando_aprovacao')
    assert.equal((await item(SUSHI)).esgotado, false)
    await decidir(c.proposta_id as string, false)
  })

  test('esgotado automático vira manual ao marcar; se o dono marcou à mão depois, a proposta antiga não reabre', async () => {
    await db.exec(`update public.itens set esgotado = true, estoque_esgotado_auto = true, estoque_qtd = 0 where id = '${POKE}'`)
    const marca = await aprovada('esgotado', POKE, { para: true })
    assert.equal((await aplicar(marca)).estado, 'ok')
    assert.deepEqual((await item(POKE)).estoque_esgotado_auto, false)
    // proposta para reabrir um esgotado automático, criada antes de o dono marcar à mão
    await db.exec(`update public.itens set esgotado = true, estoque_esgotado_auto = true where id = '${POKE}'`)
    const reabre = await aprovada('esgotado', POKE, { para: false })
    await db.exec(`update public.itens set estoque_esgotado_auto = false where id = '${POKE}'`)
    assert.equal((await aplicar(reabre)).estado, 'item_mudou')
    assert.equal((await item(POKE)).esgotado, true)
    await db.exec(`update public.itens set esgotado = false, estoque_esgotado_auto = false, estoque_qtd = null where id = '${POKE}'`)
  })
})

describe('mcp propostas: estoque', () => {
  test('liga o controle, repõe e baixa, grava o movimento e esgota sozinho em zero', async () => {
    const c1 = await criar('estoque', POKE, { delta: 10, motivo: 'reposição' })
    assert.equal(c1.estado, 'ok')
    await decidir(c1.proposta_id as string, true)
    const r1 = await aplicar(c1.proposta_id as string)
    assert.equal(r1.estado, 'ok')
    assert.equal(r1.estoque_qtd, 10)
    assert.equal((await item(POKE)).estoque_qtd, 10)
    const mov = (await db.query<Json>(`select delta, motivo, saldo_apos, observacao, criado_por from public.movimentos_estoque where item_id = '${POKE}'`)).rows
    assert.deepEqual(mov, [{ delta: 10, motivo: 'ajuste', saldo_apos: 10, observacao: 'Gestão por IA: reposição', criado_por: DONO }])
    assert.equal((await aplicar(c1.proposta_id as string)).estado, 'ja_aplicada')
    assert.equal((await item(POKE)).estoque_qtd, 10, 'aplicar de novo não repete o ajuste')

    const c2 = await criar('estoque', POKE, { delta: -10 })
    await decidir(c2.proposta_id as string, true)
    await aplicar(c2.proposta_id as string)
    assert.deepEqual(await item(POKE), { preco_centavos: 3400, esgotado: true, estoque_qtd: 0, estoque_esgotado_auto: true })
  })

  test('validação: delta zero, fracionado, texto, fora da faixa, motivo inválido; propostas de estoque aparecem na listagem', async () => {
    assert.equal((await criar('estoque', SUSHI, { delta: 0 })).estado, 'delta_invalido')
    assert.equal((await criar('estoque', SUSHI, { delta: 1.5 })).estado, 'delta_invalido')
    assert.equal((await criar('estoque', SUSHI, { delta: '5' })).estado, 'delta_invalido')
    assert.equal((await criar('estoque', SUSHI, { delta: 1000001 })).estado, 'delta_invalido')
    assert.equal((await criar('estoque', SUSHI, { delta: 5, motivo: 42 })).estado, 'dados_invalidos')
    const c = await criar('estoque', SUSHI, { delta: 5, motivo: '  quebra  ' })
    assert.equal(c.motivo, 'quebra')
    const lista = (await rpc('authenticated', DONO, `public.mcp_proposta_listar('${BARRACA}')`)) as unknown as Json[]
    const p = lista.find((x) => x.id === c.proposta_id)
    assert.ok(p)
    assert.equal(p.tipo, 'estoque')
    assert.deepEqual(p.payload, { delta: 5, motivo: 'quebra', controla: false })
    assert.deepEqual(await rpc('authenticated', OUTRO, `public.mcp_proposta_listar('${BARRACA}')`), [])
    await decidir(c.proposta_id as string, false)
  })

  test('ajuste que estoura a faixa na aplicação falha inteiro, sem gravar nada', async () => {
    await db.exec(`update public.itens set estoque_qtd = 999999 where id = '${SUSHI}'`)
    const id = await aprovada('estoque', SUSHI, { delta: 1 })
    await db.exec(`update public.itens set estoque_qtd = 1000000 where id = '${SUSHI}'`)
    const antes = (await db.query(`select count(*)::int as n from public.movimentos_estoque where item_id = '${SUSHI}'`)).rows[0]
    assert.equal((await aplicar(id)).estado, 'fora_da_faixa')
    assert.equal((await item(SUSHI)).estoque_qtd, 1000000)
    assert.deepEqual((await db.query(`select count(*)::int as n from public.movimentos_estoque where item_id = '${SUSHI}'`)).rows[0], antes)
    assert.equal(await estado(id), 'aprovada')
    await db.exec(`update public.itens set estoque_qtd = null where id = '${SUSHI}'`)
  })

  test('controle desligado depois da aprovação: a proposta antiga não religa o estoque', async () => {
    await db.exec(`update public.itens set estoque_qtd = 3 where id = '${SUSHI}'`)
    const id = await aprovada('estoque', SUSHI, { delta: -5 })
    await db.exec(`update public.itens set estoque_qtd = null, esgotado = false where id = '${SUSHI}'`)
    assert.equal((await aplicar(id)).estado, 'item_mudou')
    assert.deepEqual(await item(SUSHI), { preco_centavos: 5000, esgotado: false, estoque_qtd: null, estoque_esgotado_auto: false })
  })

  test('falha no meio da aplicação desfaz tudo (item, movimento, proposta) e o retry aplica uma vez só', async () => {
    await db.exec(`update public.itens set estoque_qtd = 4 where id = '${SUSHI}'`)
    const id = await aprovada('estoque', SUSHI, { delta: 6 })
    const movimentos = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.movimentos_estoque where item_id = '${SUSHI}'`)).rows[0].n
    const antes = await movimentos()
    await db.exec(`
      create function public._falha_auditoria() returns trigger language plpgsql as $$ begin raise exception 'falha forçada'; end $$;
      create trigger falha_auditoria before insert on public.mcp_auditoria for each row when (new.resultado like 'ok:%') execute function public._falha_auditoria();`)
    await rpc('service_role', null, `public.mcp_proposta_aplicar('${TOKEN}', '${id}')`).then(
      () => assert.fail('devia falhar'),
      (e) => assert.match(String(e.message), /falha forçada/),
    )
    await db.exec('reset role; drop trigger falha_auditoria on public.mcp_auditoria')
    assert.equal((await item(SUSHI)).estoque_qtd, 4)
    assert.equal(await movimentos(), antes)
    assert.equal(await estado(id), 'aprovada')
    assert.equal((await aplicar(id)).estado, 'ok')
    assert.equal((await aplicar(id)).estado, 'ja_aplicada')
    assert.equal((await item(SUSHI)).estoque_qtd, 10)
    assert.equal(await movimentos(), antes + 1)
    await db.exec(`update public.itens set estoque_qtd = null where id = '${SUSHI}'`)
  })

  test('mcp_estoque_ajustar não é executável por anon nem authenticated', async () => {
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${papel}`)
      await assert.rejects(db.query(`select public.mcp_estoque_ajustar('${BARRACA}', '${POKE}', '${DONO}', 1, 'x')`), /permission denied/)
      await db.exec('reset role')
    }
  })
})

describe('mcp_resumo_vendas', () => {
  const resumo = (data: string | null) => rpc('service_role', null, `public.mcp_resumo_vendas('${TOKEN}', ${data ? `'${data}'::date` : 'null'})`)
  const pedido = async (barraca: string, status: string, quando: string, taxa: number, desconto: number, itens: Array<[string, number, number, boolean?]>) => {
    const id = (await db.query<{ id: string }>(
      `insert into public.pedidos (barraca_id, status, criado_em, taxa_entrega_centavos, desconto_cupom_centavos)
       values ('${barraca}', '${status}', ${quando}, ${taxa}, ${desconto}) returning id`)).rows[0].id
    for (const [nome, qtd, preco, removido] of itens) {
      await db.query(`insert into public.itens_do_pedido (pedido_id, barraca_id, nome, quantidade, preco_centavos_unitario, removido)
        values ('${id}', '${barraca}', '${nome}', ${qtd}, ${preco}, ${removido === true})`)
    }
  }

  test('soma só pedidos não cancelados do dia no fuso da barraca; taxa e cupom à parte; item removido fora', async () => {
    // Dia-base relativo ao relógio do banco (a RPC só aceita até 366 dias atrás), sempre no fuso de São Paulo.
    const dia = (await db.query<{ d: string }>(`select ((now() at time zone 'America/Sao_Paulo')::date - 3)::text as d`)).rows[0].d
    const em = (offsetDias: number, hora: string) =>
      `(((('${dia}'::date + ${offsetDias})::timestamp + interval '${hora}') at time zone 'America/Sao_Paulo'))`
    await pedido(BARRACA, 'pronto', em(0, '00:00'), 500, 100, [['Poke', 2, 3800], ['Suco', 1, 800, true]]) // primeiro instante do dia
    await pedido(BARRACA, 'a_fazer', em(0, '23:59'), 0, 0, [['Poke', 1, 3800], ['Sushi', 3, 1000]]) // último minuto do dia
    await pedido(BARRACA, 'cancelado', em(0, '12:00'), 900, 0, [['Poke', 9, 3800]])
    await pedido(BARRACA, 'pronto', em(1, '00:00'), 0, 0, [['Poke', 1, 3800]]) // início do dia seguinte: fora
    await pedido(BARRACA, 'pronto', em(-1, '23:59'), 0, 0, [['Poke', 1, 3800]]) // fim do dia anterior: fora
    await pedido(BARRACA_2, 'pronto', em(0, '12:00'), 700, 0, [['Alheio', 5, 1000]])
    const r = await resumo(dia)
    assert.equal(r.estado, 'ok')
    assert.equal(r.pedidos, 2)
    assert.equal(r.itens_centavos, 2 * 3800 + 3800 + 3 * 1000)
    assert.equal(r.taxa_entrega_centavos, 500)
    assert.equal(r.desconto_cupom_centavos, 100)
    assert.equal(r.ticket_medio_itens_centavos, Math.floor((2 * 3800 + 3800 + 3000) / 2))
    assert.deepEqual(r.mais_vendidos, [{ nome: 'Poke', quantidade: 3 }, { nome: 'Sushi', quantidade: 3 }])
    // dia sem pedidos, dentro da janela de 366 dias
    const dois = (await db.query<{ d: string }>(`select ('${dia}'::date - 2)::text as d`)).rows[0].d
    const sem = await resumo(dois)
    assert.deepEqual([sem.pedidos, sem.itens_centavos, sem.ticket_medio_itens_centavos, sem.mais_vendidos], [0, 0, 0, []])
  })

  test('data futura ou muito antiga é recusada; token revogado e anon não leem', async () => {
    assert.equal((await resumo('2099-01-01')).estado, 'data_invalida')
    assert.equal((await resumo('2000-01-01')).estado, 'data_invalida')
    assert.equal((await resumo(null)).estado, 'ok')
    assert.equal((await rpc('service_role', null, `public.mcp_resumo_vendas('${TOKEN_REVOGADO}', null)`)).estado, 'token_invalido')
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${papel}`)
      await assert.rejects(db.query(`select public.mcp_resumo_vendas('${TOKEN}', null)`), /permission denied/)
      await db.exec('reset role')
    }
  })
})
