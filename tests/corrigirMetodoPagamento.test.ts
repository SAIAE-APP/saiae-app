// "Pagar depois", Fase 1: corrigir a forma de pagamento (só o dono, só antes da NFC-e). Migration real no PGlite, com o
// papel `authenticated` de verdade. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const MIG = '20261019170000_pagamento_depois.sql'

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const OPERADOR = 'a2000000-0000-4000-8000-000000000002'
const OUTRO = 'a3000000-0000-4000-8000-000000000003'

let db: PGlite

async function como<T>(uid: string | null, papel: 'authenticated' | 'anon', fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}
const corrigir = async (uid: string | null, pedido: string, metodo: string | null) =>
  (await como(uid, 'authenticated', () =>
    db.query<{ r: { estado: string; metodo?: string } }>('select public.corrigir_metodo_pagamento($1, $2) as r', [pedido, metodo]),
  )).rows[0].r
async function pedido(id: string, campos: { barraca?: string; metodo?: string | null; nfce?: string | null; status?: string } = {}) {
  await db.query(
    `insert into public.pedidos (id, barraca_id, status, metodo_pagamento, nfce_status) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set barraca_id = $2, status = $3, metodo_pagamento = $4, nfce_status = $5`,
    [id, campos.barraca ?? B1, campos.status ?? 'entregue', campos.metodo === undefined ? 'dinheiro' : campos.metodo, campos.nfce ?? null],
  )
}
const metodoDe = async (id: string) =>
  (await db.query<{ metodo_pagamento: string | null }>('select metodo_pagamento from public.pedidos where id = $1', [id])).rows[0].metodo_pagamento

const P = (n: number) => `c${n}000000-0000-4000-8000-00000000000${n}`

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.pedidos (id uuid primary key, barraca_id uuid, status text, metodo_pagamento text, nfce_status text);
    insert into public.barracas values ('${B1}'), ('${B2}');
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono'), ('${OPERADOR}', '${B1}', 'operador'), ('${OUTRO}', '${B2}', 'dono');
  `)
  await db.exec(sql('20261010100000_definir_metodo_pagamento.sql'))
  await db.exec(sql(MIG))
  await db.exec(sql(MIG)) // re-executável
  await db.exec(`grant usage on schema public to authenticated, anon;
    grant select on public.pedidos, public.usuarios_barracas, public.barracas to authenticated;
    grant select on public.pedidos_metodo_historico to authenticated;`)
})
after(async () => {
  await db.close()
})

describe('interruptor por barraca', () => {
  test('nasce desligado em toda barraca (o app não muda sem ligar)', async () => {
    const r = await db.query<{ pagamento_depois_habilitado: boolean }>('select pagamento_depois_habilitado from public.barracas')
    assert.equal(r.rows.length, 2)
    assert.ok(r.rows.every((x) => x.pagamento_depois_habilitado === false))
  })
})

describe('corrigir_metodo_pagamento: quem pode', () => {
  test('o dono corrige uma forma já definida (definir_metodo_pagamento nunca sobrescreveria)', async () => {
    await pedido(P(1), { metodo: 'pix' })
    const r = await como(DONO, 'authenticated', () => db.query<{ r: { estado: string } }>(`select public.definir_metodo_pagamento('${P(1)}', 'dinheiro') as r`))
    assert.equal(r.rows[0].r.estado, 'ja_definido')
    assert.deepEqual(await corrigir(DONO, P(1), 'dinheiro'), { estado: 'ok', metodo: 'dinheiro' })
    assert.equal(await metodoDe(P(1)), 'dinheiro')
  })

  test('operador (não é o dono), usuário de outra barraca e anon NÃO corrigem; nada muda', async () => {
    await pedido(P(2), { metodo: 'pix' })
    assert.equal((await corrigir(OPERADOR, P(2), 'dinheiro')).estado, 'sem_acesso')
    assert.equal((await corrigir(OUTRO, P(2), 'dinheiro')).estado, 'sem_acesso')
    assert.equal((await corrigir(DONO, 'ffffffff-0000-4000-8000-00000000ffff', 'dinheiro')).estado, 'sem_acesso', 'inexistente = mesma resposta')
    assert.equal(await metodoDe(P(2)), 'pix')
    await assert.rejects(
      como(null, 'anon', () => db.query(`select public.corrigir_metodo_pagamento('${P(2)}', 'dinheiro')`)),
      /permission denied/,
    )
    assert.equal((await corrigir(null, P(2), 'dinheiro')).estado, 'nao_autenticado')
  })
})

describe('corrigir_metodo_pagamento: o que pode ser trocado', () => {
  test('método inválido ou "na_entrega"/"gratis" como destino são recusados', async () => {
    await pedido(P(3), { metodo: 'pix' })
    for (const m of ['misto', 'na_entrega', 'gratis', 'cheque', '', null]) {
      assert.equal((await corrigir(DONO, P(3), m)).estado, 'metodo_invalido', String(m))
    }
    assert.equal(await metodoDe(P(3)), 'pix')
  })

  test('repetir o mesmo método é ok e não registra de novo (idempotente)', async () => {
    await pedido(P(4), { metodo: 'pix' })
    assert.equal((await corrigir(DONO, P(4), 'credito')).estado, 'ok')
    assert.equal((await corrigir(DONO, P(4), 'credito')).estado, 'ok')
    const h = await db.query('select 1 from public.pedidos_metodo_historico where pedido_id = $1', [P(4)])
    assert.equal(h.rows.length, 1)
  })

  test('cancelado e grátis não mudam', async () => {
    await pedido(P(5), { metodo: 'pix', status: 'cancelado' })
    assert.equal((await corrigir(DONO, P(5), 'dinheiro')).estado, 'cancelado')
    await pedido(P(6), { metodo: 'gratis' })
    assert.equal((await corrigir(DONO, P(6), 'dinheiro')).estado, 'nao_corrigivel')
    assert.equal(await metodoDe(P(6)), 'gratis')
  })

  test('pedido "a receber" (na_entrega) também pode ser fechado pela correção', async () => {
    await pedido(P(7), { metodo: 'na_entrega' })
    assert.equal((await corrigir(DONO, P(7), 'debito')).estado, 'ok')
    assert.equal(await metodoDe(P(7)), 'debito')
  })
})

describe('corrigir_metodo_pagamento: a NFC-e trava', () => {
  test('sem nota, com erro ou rejeitada: pode corrigir', async () => {
    let n = 10
    for (const nfce of [null, 'erro', 'erro_autorizacao']) {
      const id = P(n++ - 9)
      await pedido(id, { metodo: 'pix', nfce })
      assert.equal((await corrigir(DONO, id, 'dinheiro')).estado, 'ok', String(nfce))
    }
  })

  test('autorizada, em processamento ou status desconhecido: travado, e a forma fica como estava', async () => {
    let n = 1
    for (const nfce of ['autorizado', 'processando_autorizacao', 'cancelado', 'desconhecido']) {
      const id = `d${n}000000-0000-4000-8000-00000000000${n}`
      n++
      await pedido(id, { metodo: 'pix', nfce })
      const r = await corrigir(DONO, id, 'dinheiro')
      assert.deepEqual(r, { estado: 'nfce_emitida', metodo: 'pix' }, nfce)
      assert.equal(await metodoDe(id), 'pix')
    }
  })
})

describe('registro de quem e quando', () => {
  test('grava quem corrigiu, quando e o histórico (antes → depois); só quem tem acesso à barraca lê', async () => {
    await pedido(P(8), { metodo: 'pix' })
    await corrigir(DONO, P(8), 'dinheiro')
    await corrigir(DONO, P(8), 'debito')
    const p = (await db.query<{ por: string; em: Date | null; antes: string }>(
      `select metodo_corrigido_por as por, metodo_corrigido_em as em, metodo_pagamento as antes from public.pedidos where id = $1`, [P(8)],
    )).rows[0]
    assert.equal(p.por, DONO)
    assert.ok(p.em)
    const h = await como(DONO, 'authenticated', () =>
      db.query<{ metodo_antes: string; metodo_depois: string; por: string }>(
        'select metodo_antes, metodo_depois, por from public.pedidos_metodo_historico where pedido_id = $1 order by em, metodo_depois', [P(8)]),
    )
    assert.deepEqual(h.rows.map((x) => [x.metodo_antes, x.metodo_depois]).sort(), [['dinheiro', 'debito'], ['pix', 'dinheiro']].sort())
    assert.ok(h.rows.every((x) => x.por === DONO))
    const outro = await como(OUTRO, 'authenticated', () => db.query('select 1 from public.pedidos_metodo_historico'))
    assert.equal(outro.rows.length, 0, 'dono de outra loja não vê')
    await assert.rejects(como(DONO, 'authenticated', () => db.query(`insert into public.pedidos_metodo_historico (pedido_id, barraca_id, metodo_depois) values ('${P(8)}', '${B1}', 'x')`)), /permission denied/)
  })
})

describe('segurança da migration', () => {
  const m = sql(MIG).replace(/\r\n/g, '\n')
  test('só authenticated executa; aditiva', () => {
    assert.match(m, /revoke all on function public\.corrigir_metodo_pagamento\(uuid, text\) from public, anon;/)
    assert.match(m, /grant execute on function public\.corrigir_metodo_pagamento\(uuid, text\) to authenticated;/)
    const semComentarios = m.split(/\r?\n/).filter((l) => !l.startsWith('--'))
    assert.doesNotMatch(semComentarios.join(' '), /drop table|truncate|drop column/i)
  })
})
