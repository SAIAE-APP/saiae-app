// Fechar comanda: texto da migration + migration real (Task 2 + esta) rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ler = (arquivo: string) => readFileSync(new URL(`../supabase/migrations/${arquivo}`, import.meta.url), 'utf8')
const sqlComanda = ler('20261029100000_comanda_aberta.sql')
const sql = ler('20261029110000_fechar_comanda.sql')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO_B1 = 'a1000000-0000-4000-8000-000000000001'
const DONO_B2 = 'a2000000-0000-4000-8000-000000000002'
const NAO_EXISTE = 'c0000000-0000-4000-8000-000000000000'

describe('migration fechar comanda (texto)', () => {
  test('Rollback no topo', () => {
    assert.match(sql.split('\n').slice(0, 30).join('\n'), /Rollback:/)
  })

  test('security definer, search_path, grants e estados', () => {
    assert.match(sql, /security definer/)
    assert.match(sql, /set search_path = public, pg_temp/)
    assert.match(sql, /revoke all on function public\.fechar_comanda\(uuid, text, boolean\) from public, anon;/)
    assert.match(sql, /grant execute on function public\.fechar_comanda\(uuid, text, boolean\) to authenticated;/)
    for (const estado of ['ok', 'ja_fechada', 'metodo_invalido', 'sem_itens', 'sem_acesso', 'nao_autenticado']) {
      assert.match(sql, new RegExp(`'${estado}'`), estado)
    }
  })

  test('trava a comanda (for update) antes de mexer nos pedidos', () => {
    const corpo = sql.slice(sql.indexOf('create or replace function public.fechar_comanda'))
    const trava = corpo.search(/from public\.comandas[^;]*for update;/)
    const primeiroPedidos = corpo.search(/public\.pedidos/)
    assert.ok(trava > 0, 'select ... for update na comanda')
    assert.ok(trava < primeiroPedidos, 'comanda travada antes de qualquer acesso a pedidos')
    assert.doesNotMatch(corpo, /from public\.pedidos[^;]*for (update|share)/)
  })
})

describe('migration fechar comanda (PGlite)', () => {
  let db: PGlite

  async function como(uid: string | null) {
    await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'}`)
  }

  let n = 0
  /** Rodada de Mesa (como o criar_pedido, superusuário) com itens [preço, qtd, removido?]. Devolve id e comanda. */
  async function rodada(barraca: string, mesa: string, itens: [number, number, boolean?][]) {
    n += 1
    const r = await db.query<{ id: string; comanda_id: string }>(
      `insert into public.pedidos (barraca_id, mesa, tipo_atendimento, metodo_pagamento, client_uuid)
       values ($1, $2, 'mesa', 'na_entrega', $3) returning id, comanda_id`,
      [barraca, mesa, `f-${n}`],
    )
    for (const [preco, qtd, removido] of itens) {
      await db.query(
        `insert into public.itens_do_pedido (pedido_id, preco_centavos_unitario, quantidade, removido) values ($1, $2, $3, $4)`,
        [r.rows[0].id, preco, qtd, removido ?? false],
      )
    }
    return r.rows[0]
  }

  async function fechar(uid: string | null, comanda: string, metodo: string | null, cobrar: boolean | null = true) {
    await como(uid)
    try {
      const r = await db.query<{ r: Record<string, unknown> }>('select public.fechar_comanda($1, $2, $3) as r', [comanda, metodo, cobrar])
      return r.rows[0].r
    } finally {
      await db.exec('reset role')
    }
  }

  async function comanda(id: string) {
    const r = await db.query<Record<string, unknown>>(
      `select status, metodo_pagamento, taxa_servico_bps, taxa_servico_centavos, fechada_por, fechada_em is not null as fechada
         from public.comandas where id = $1`, [id])
    return r.rows[0]
  }

  async function pedido(id: string) {
    const r = await db.query<{ metodo_pagamento: string; metodo_definido_por: string | null; definido: boolean }>(
      `select metodo_pagamento, metodo_definido_por, metodo_definido_em is not null as definido from public.pedidos where id = $1`, [id])
    return r.rows[0]
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
      create table public.pedidos (
        id uuid primary key default gen_random_uuid(),
        barraca_id uuid not null references public.barracas(id) on delete cascade,
        mesa text, tipo_atendimento text, metodo_pagamento text, client_uuid text unique,
        status text not null default 'a_fazer',
        metodo_definido_em timestamptz, metodo_definido_por uuid
      );
      create table public.itens_do_pedido (
        id uuid primary key default gen_random_uuid(),
        pedido_id uuid not null references public.pedidos(id),
        preco_centavos_unitario integer not null, quantidade integer not null, removido boolean not null default false
      );
      -- Mesma condição do trigger SAI-001 (pedidos_evento_pago_na_entrega), registrando num log.
      create table public.eventos_teste (pedido_id uuid);
      create function public._trg_evento_teste() returns trigger language plpgsql as $$
        begin insert into public.eventos_teste values (new.id); return null; end $$;
      create trigger pedidos_evento_pago_na_entrega after update of metodo_pagamento on public.pedidos for each row
        when (old.metodo_pagamento = 'na_entrega' and new.metodo_pagamento is not null and new.metodo_pagamento <> 'na_entrega')
        execute function public._trg_evento_teste();
      grant usage on schema public to authenticated, anon;
      insert into public.barracas values ('${B1}', 'B1'), ('${B2}', 'B2');
      insert into public.usuarios_barracas values ('${DONO_B1}', '${B1}', 'dono'), ('${DONO_B2}', '${B2}', 'dono');
    `)
    await db.exec(sqlComanda)
    await db.exec(sql)
    await db.exec(sql) // idempotente
    await db.exec(`update public.barracas set comanda_aberta_habilitada = true, taxa_servico_habilitada = true`)
  })

  after(async () => {
    await db.close()
  })

  test('2 rodadas: ambas recebem o método, taxa = 10% do subtotal, comanda fechada', async () => {
    const r1 = await rodada(B1, '5', [[1500, 2]])
    const r2 = await rodada(B1, '05', [[1000, 1], [9999, 1, true]])
    assert.equal(r1.comanda_id, r2.comanda_id)
    const res = await fechar(DONO_B1, r1.comanda_id, 'pix')
    assert.deepEqual(res, { estado: 'ok', metodo: 'pix', subtotal_centavos: 4000, taxa_servico_centavos: 400, total_centavos: 4400 })
    for (const id of [r1.id, r2.id]) {
      assert.deepEqual(await pedido(id), { metodo_pagamento: 'pix', metodo_definido_por: DONO_B1, definido: true })
    }
    assert.deepEqual(await comanda(r1.comanda_id), {
      status: 'fechada', metodo_pagamento: 'pix', taxa_servico_bps: 1000, taxa_servico_centavos: 400, fechada_por: DONO_B1, fechada: true,
    })
    const ev = await db.query<{ c: number }>('select count(*)::int c from public.eventos_teste where pedido_id in ($1, $2)', [r1.id, r2.id])
    assert.equal(ev.rows[0].c, 2, 'evento SAI-001 dispara uma vez por rodada ao sair de na_entrega')

    // Repetir com o mesmo método (fila reenviando): ok idempotente, mesmos valores, nada muda.
    assert.deepEqual(await fechar(DONO_B1, r1.comanda_id, 'pix', false), res)
    const ev2 = await db.query<{ c: number }>('select count(*)::int c from public.eventos_teste where pedido_id in ($1, $2)', [r1.id, r2.id])
    assert.equal(ev2.rows[0].c, 2)

    // Outro método: ja_fechada, sem sobrescrever.
    assert.deepEqual(await fechar(DONO_B1, r1.comanda_id, 'dinheiro'), { estado: 'ja_fechada', metodo: 'pix' })
    assert.equal((await pedido(r1.id)).metodo_pagamento, 'pix')

    // A mesa ficou livre: o próximo lançamento abre outra comanda.
    const r3 = await rodada(B1, '5', [[100, 1]])
    assert.notEqual(r3.comanda_id, r1.comanda_id)
  })

  test('rodada cancelada no meio fica de fora (método e soma)', async () => {
    const a = await rodada(B1, '6', [[1000, 1]])
    const b = await rodada(B1, '6', [[5000, 1]])
    const c = await rodada(B1, '6', [[2345, 1]])
    await db.query(`update public.pedidos set status = 'cancelado' where id = $1`, [b.id])
    const res = await fechar(DONO_B1, a.comanda_id, 'credito')
    // 3345 * 10% = 334,5 -> 335 (metade sobe, igual a taxaServicoCentavos)
    assert.deepEqual(res, { estado: 'ok', metodo: 'credito', subtotal_centavos: 3345, taxa_servico_centavos: 335, total_centavos: 3680 })
    assert.equal((await pedido(b.id)).metodo_pagamento, 'na_entrega')
    assert.equal((await pedido(c.id)).metodo_pagamento, 'credito')
  })

  test('sem rodada ativa: sem_itens e a comanda continua aberta', async () => {
    const a = await rodada(B1, '7', [[1000, 1]])
    await db.query(`update public.pedidos set status = 'cancelado' where id = $1`, [a.id])
    assert.deepEqual(await fechar(DONO_B1, a.comanda_id, 'pix'), { estado: 'sem_itens' })
    assert.equal((await comanda(a.comanda_id)).status, 'aberta')
    // Comanda sem nenhum pedido.
    const vazia = await db.query<{ id: string }>(
      `insert into public.comandas (barraca_id, mesa, mesa_normalizada) values ($1, '8', '8') returning id`, [B1])
    assert.deepEqual(await fechar(DONO_B1, vazia.rows[0].id, 'pix'), { estado: 'sem_itens' })
  })

  test('taxa: não cobrar = 0; barraca sem taxa habilitada = 0; 0 bps = 0', async () => {
    const a = await rodada(B1, '10', [[1000, 1]])
    assert.deepEqual(await fechar(DONO_B1, a.comanda_id, 'dinheiro', false),
      { estado: 'ok', metodo: 'dinheiro', subtotal_centavos: 1000, taxa_servico_centavos: 0, total_centavos: 1000 })
    assert.equal((await comanda(a.comanda_id)).taxa_servico_bps, 0)

    const b = await rodada(B1, '11', [[1000, 1]])
    assert.equal((await fechar(DONO_B1, b.comanda_id, 'dinheiro', null)).taxa_servico_centavos, 0)

    await db.exec(`update public.barracas set taxa_servico_habilitada = false where id = '${B1}'`)
    const c = await rodada(B1, '12', [[1000, 1]])
    assert.equal((await fechar(DONO_B1, c.comanda_id, 'dinheiro', true)).taxa_servico_centavos, 0)

    await db.exec(`update public.barracas set taxa_servico_habilitada = true, taxa_servico_bps = 0 where id = '${B1}'`)
    const d = await rodada(B1, '13', [[1000, 1]])
    assert.equal((await fechar(DONO_B1, d.comanda_id, 'dinheiro', true)).taxa_servico_centavos, 0)

    // 1234 * 12,5% = 154,25 -> 154
    await db.exec(`update public.barracas set taxa_servico_bps = 1250 where id = '${B1}'`)
    const e = await rodada(B1, '14', [[1234, 1]])
    assert.equal((await fechar(DONO_B1, e.comanda_id, 'dinheiro', true)).taxa_servico_centavos, 154)
    await db.exec(`update public.barracas set taxa_servico_bps = 1000 where id = '${B1}'`)
  })

  test('outra barraca e comanda inexistente: mesma resposta sem_acesso, nada muda', async () => {
    const a = await rodada(B1, '20', [[1000, 1]])
    assert.deepEqual(await fechar(DONO_B2, a.comanda_id, 'pix'), { estado: 'sem_acesso' })
    assert.deepEqual(await fechar(DONO_B2, NAO_EXISTE, 'pix'), { estado: 'sem_acesso' })
    assert.equal((await comanda(a.comanda_id)).status, 'aberta')
    assert.equal((await pedido(a.id)).metodo_pagamento, 'na_entrega')
  })

  test('método inválido ou nulo, e sem login', async () => {
    const a = await rodada(B1, '21', [[1000, 1]])
    for (const m of ['na_entrega', 'gratis', 'cheque', '', null]) {
      assert.deepEqual(await fechar(DONO_B1, a.comanda_id, m), { estado: 'metodo_invalido' }, String(m))
    }
    await assert.rejects(fechar(null, a.comanda_id, 'pix'), /permission denied/)
    // Logado como authenticated sem uid (sessão estranha): nao_autenticado.
    await db.exec(`select set_config('test.uid', '', false); set role authenticated`)
    const r = await db.query<{ r: unknown }>('select public.fechar_comanda($1, $2, $3) as r', [a.comanda_id, 'pix', true])
    await db.exec('reset role')
    assert.deepEqual(r.rows[0].r, { estado: 'nao_autenticado' })
    assert.equal((await comanda(a.comanda_id)).status, 'aberta')
  })

  test('rodada que já tinha método definido (Histórico) não é sobrescrita, mas entra na soma', async () => {
    const a = await rodada(B1, '30', [[1000, 1]])
    const b = await rodada(B1, '30', [[2000, 1]])
    await db.query(`update public.pedidos set metodo_pagamento = 'dinheiro' where id = $1`, [a.id])
    const res = await fechar(DONO_B1, a.comanda_id, 'pix')
    assert.equal(res.subtotal_centavos, 3000)
    assert.equal((await pedido(a.id)).metodo_pagamento, 'dinheiro')
    assert.equal((await pedido(b.id)).metodo_pagamento, 'pix')
  })
})
