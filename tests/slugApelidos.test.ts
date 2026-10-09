// H7: endereço do cardápio (slug) editável, com apelidos para sempre. Migration real no PGlite, com os papéis
// `authenticated` e `anon` de verdade. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const MIG = '20261020110000_slug_apelidos.sql'

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
const trocar = async (uid: string | null, barraca: string, novo: string | null) =>
  (await como(uid, 'authenticated', () =>
    db.query<{ r: { estado: string; slug?: string } }>('select public.barraca_trocar_slug($1, $2) as r', [barraca, novo]),
  )).rows[0].r
const slugDe = async (id: string) => (await db.query<{ slug: string }>('select slug from public.barracas where id = $1', [id])).rows[0].slug
const atual = async (s: string) =>
  (await como(null, 'anon', () => db.query<{ s: string | null }>('select public.barraca_slug_atual($1) as s', [s]))).rows[0].s
const liberarTroca = () => db.exec(`update public.barracas set slug_trocado_em = now() - interval '25 hours'`)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text not null);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.slug_reservado(p text) returns boolean language sql immutable as $$ select p = any (array['login','cadastro','e','api','admin','configurar']) $$;
    create function public.slug_disponivel(p_slug text) returns boolean language sql stable as $$ select not exists (select 1 from public.barracas where slug = p_slug) $$;
    insert into public.barracas values ('${B1}', 'D''Helena Cozinha Afetiva', 'restaurante-paulo'), ('${B2}', 'Outra', 'outra-loja');
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono'), ('${OPERADOR}', '${B1}', 'operador'), ('${OUTRO}', '${B2}', 'dono');
  `)
  await db.exec(sql(MIG))
  await db.exec(sql(MIG)) // re-executável
  await db.exec(`grant usage on schema public to authenticated, anon;
    grant select, update on public.barracas to authenticated;`)
})
after(async () => {
  await db.close()
})

describe('barraca_trocar_slug: quem pode', () => {
  test('só o dono; operador, dono de outra loja e anon não trocam; nada muda', async () => {
    assert.equal((await trocar(OPERADOR, B1, 'novo-nome')).estado, 'sem_acesso')
    assert.equal((await trocar(OUTRO, B1, 'novo-nome')).estado, 'sem_acesso')
    assert.equal((await trocar(DONO, 'ffffffff-0000-4000-8000-00000000ffff', 'novo-nome')).estado, 'sem_acesso')
    assert.equal((await trocar(null, B1, 'novo-nome')).estado, 'nao_autenticado')
    await assert.rejects(como(null, 'anon', () => db.query(`select public.barraca_trocar_slug('${B1}', 'novo-nome')`)), /permission denied/)
    assert.equal(await slugDe(B1), 'restaurante-paulo')
  })

  test('direto na tabela pela API é recusado (tem que passar pela função)', async () => {
    await assert.rejects(como(DONO, 'authenticated', () => db.query(`update public.barracas set slug = 'burlei' where id = '${B1}'`)), /slug_use_a_tela/)
    await como(DONO, 'authenticated', () => db.query(`update public.barracas set nome = 'D''Helena' where id = '${B1}'`)) // outras colunas seguem livres
    assert.equal(await slugDe(B1), 'restaurante-paulo')
  })
})

describe('barraca_trocar_slug: troca e apelido', () => {
  test('troca, guarda o slug antigo como apelido e o apelido resolve para o atual (QR impresso não quebra)', async () => {
    assert.deepEqual(await trocar(DONO, B1, 'dhelena-cozinha-afetiva'), { estado: 'ok', slug: 'dhelena-cozinha-afetiva' })
    assert.equal(await slugDe(B1), 'dhelena-cozinha-afetiva')
    assert.equal(await atual('restaurante-paulo'), 'dhelena-cozinha-afetiva')
    assert.equal(await atual('dhelena-cozinha-afetiva'), 'dhelena-cozinha-afetiva')
    assert.equal(await atual('  RESTAURANTE-PAULO '), 'dhelena-cozinha-afetiva')
    assert.equal(await atual('nao-existe'), null)
    assert.equal(await atual(''), null)
  })

  test('repetir o slug atual é ok e não gasta a troca do dia', async () => {
    assert.deepEqual(await trocar(DONO, B1, 'dhelena-cozinha-afetiva'), { estado: 'ok', slug: 'dhelena-cozinha-afetiva' })
  })

  test('1 troca por 24 h; depois dela libera', async () => {
    assert.equal((await trocar(DONO, B1, 'outro-nome')).estado, 'muito_cedo')
    assert.equal(await slugDe(B1), 'dhelena-cozinha-afetiva')
    await liberarTroca()
    assert.equal((await trocar(DONO, B1, 'outro-nome')).estado, 'ok')
    assert.equal(await atual('restaurante-paulo'), 'outro-nome', 'os dois apelidos seguem valendo')
    assert.equal(await atual('dhelena-cozinha-afetiva'), 'outro-nome')
  })

  test('voltar a um apelido próprio é permitido (e o atual vira apelido)', async () => {
    await liberarTroca()
    assert.deepEqual(await trocar(DONO, B1, 'restaurante-paulo'), { estado: 'ok', slug: 'restaurante-paulo' })
    assert.equal(await atual('outro-nome'), 'restaurante-paulo')
    const n = await db.query(`select 1 from public.barracas_slugs_antigos where barraca_id = '${B1}'`)
    assert.equal(n.rows.length, 2, 'dhelena-cozinha-afetiva e outro-nome; restaurante-paulo saiu da lista')
  })
})

describe('barraca_trocar_slug: validações', () => {
  test('formato, tamanho e reservados', async () => {
    await liberarTroca()
    for (const [novo, estado] of [
      ['Com Espaço', 'invalido'], ['ab', 'invalido'], ['-x-y', 'invalido'], ['a--b', 'invalido'], ['x'.repeat(41), 'invalido'],
      ['', 'invalido'], [null, 'invalido'], ['login', 'reservado'], ['API', 'reservado'],
    ] as const) {
      assert.equal((await trocar(DONO, B1, novo)).estado, estado, String(novo))
    }
    assert.equal(await slugDe(B1), 'restaurante-paulo')
  })

  test('slug ou apelido de OUTRA barraca está em uso e nunca é reaproveitado', async () => {
    assert.equal((await trocar(DONO, B1, 'outra-loja')).estado, 'em_uso')
    // a outra loja troca de nome; o slug velho dela vira apelido e ninguém mais pega
    assert.equal((await trocar(OUTRO, B2, 'loja-nova')).estado, 'ok')
    assert.equal((await trocar(DONO, B1, 'outra-loja')).estado, 'em_uso')
    await assert.rejects(db.query(`insert into public.barracas values ('c1000000-0000-4000-8000-000000000003', 'X', 'outra-loja')`), /Esse endereço já está em uso/)
    await assert.rejects(db.query(`update public.barracas set slug = 'outra-loja' where id = '${B1}'`), /Esse endereço já está em uso/)
  })

  test('no máximo 10 apelidos por barraca', async () => {
    for (let i = 1; i <= 12; i++) {
      await liberarTroca()
      const r = await trocar(OUTRO, B2, `loja-v${i}`)
      if (r.estado === 'limite_apelidos') {
        assert.ok(i >= 10, `limite chegou cedo demais (troca ${i})`)
        const n = await db.query(`select 1 from public.barracas_slugs_antigos where barraca_id = '${B2}'`)
        assert.equal(n.rows.length, 10)
        return
      }
      assert.equal(r.estado, 'ok')
    }
    assert.fail('o limite de 10 apelidos nunca apareceu')
  })
})

describe('segurança', () => {
  test('a tabela de apelidos não é lida nem escrita pela API; a barraca de outro dono não vira alvo', async () => {
    await assert.rejects(como(DONO, 'authenticated', () => db.query('select * from public.barracas_slugs_antigos')), /permission denied/)
    await assert.rejects(como(null, 'anon', () => db.query(`insert into public.barracas_slugs_antigos (slug, barraca_id) values ('x-y-z', '${B1}')`)), /permission denied/)
  })

  test('slug_disponivel (onboarding) passa a considerar os apelidos', async () => {
    const r = await como(DONO, 'authenticated', () => db.query<{ d: boolean }>(`select public.slug_disponivel('dhelena-cozinha-afetiva') as d`))
    assert.equal(r.rows[0].d, false, 'apelido ocupado')
    const livre = await como(DONO, 'authenticated', () => db.query<{ d: boolean }>(`select public.slug_disponivel('totalmente-livre') as d`))
    assert.equal(livre.rows[0].d, true)
  })

  test('só funções fechadas; aditiva', () => {
    const m = sql(MIG).replace(/\r\n/g, '\n')
    assert.match(m, /revoke all on function public\.barraca_trocar_slug\(uuid, text\) from public, anon;/)
    assert.match(m, /grant execute on function public\.barraca_trocar_slug\(uuid, text\) to authenticated;/)
    assert.match(m, /grant execute on function public\.barraca_slug_atual\(text\) to anon, authenticated;/)
    const codigo = m.split('\n').filter((l) => !l.startsWith('--')).join(' ')
    assert.doesNotMatch(codigo, /drop table|truncate|drop column/i)
  })
})
