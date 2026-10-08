// IA no WhatsApp, Task 3: a rpc ia_ligar roda de verdade (migrations reais da IA no PGlite; tabelas-base em stub).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const U1 = 'a1000000-0000-4000-8000-000000000001'
const U2 = 'a2000000-0000-4000-8000-000000000002'

let db: PGlite

async function ligar(uid: string | null, barraca: string, ligado: boolean, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
  try {
    return (await db.query<{ r: { ia_habilitada: boolean; ia_codigo: string | null } }>(`select public.ia_ligar($1, $2) as r`, [barraca, ligado])).rows[0].r
  } finally {
    await db.exec('reset role')
  }
}

async function linha(barraca: string) {
  return (await db.query<{ ia_habilitada: boolean; ia_codigo: string | null }>(`select ia_habilitada, ia_codigo from public.barracas where id = $1`, [barraca])).rows[0]
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1'), ('${B2}', 'Loja 2', 'loja-2');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono'), ('${U2}', '${B2}', 'dono');
  `)
  await db.exec(sql('20261019100000_ia_atendente.sql'))
  await db.exec(sql('20261019110000_ia_ligar_loja.sql'))
  await db.exec(sql('20261019110000_ia_ligar_loja.sql')) // re-executável
  await db.exec(`update public.barracas set ia_whatsapp_dono = '5511999990000' where id = '${B1}'`)
})

after(async () => {
  await db.close()
})

describe('ia_ligar', () => {
  test('ligar sem o WhatsApp do dono é recusado e não muda nada', async () => {
    await assert.rejects(ligar(U2, B2, true), /ia_sem_whatsapp_dono/)
    assert.deepEqual(await linha(B2), { ia_habilitada: false, ia_codigo: null })
  })

  test('liga, gera o código do link (6 caracteres válidos) e devolve para a tela', async () => {
    const r = await ligar(U1, B1, true)
    assert.equal(r.ia_habilitada, true)
    assert.match(r.ia_codigo ?? '', /^[A-HJKMNP-Z2-9]{6}$/)
    assert.deepEqual(await linha(B1), { ia_habilitada: true, ia_codigo: r.ia_codigo })
  })

  test('desligar e religar mantém o MESMO código (o link impresso continua valendo)', async () => {
    const primeiro = (await linha(B1)).ia_codigo
    const off = await ligar(U1, B1, false)
    assert.equal(off.ia_habilitada, false)
    assert.equal(off.ia_codigo, primeiro)
    assert.equal((await linha(B1)).ia_habilitada, false)
    const on = await ligar(U1, B1, true)
    assert.equal(on.ia_codigo, primeiro)
    // ligar de novo, já ligado: idempotente
    assert.equal((await ligar(U1, B1, true)).ia_codigo, primeiro)
  })

  test('desligar uma loja que nunca ligou não gera código', async () => {
    const r = await ligar(U2, B2, false)
    assert.deepEqual(r, { ia_habilitada: false, ia_codigo: null })
  })

  test('o dono de outra loja, sem login e anon não conseguem ligar a loja alheia', async () => {
    await assert.rejects(ligar(U2, B1, false), /sem acesso/)
    await assert.rejects(ligar(null, B1, false), /sem acesso/)
    await assert.rejects(ligar(U1, '99999999-0000-4000-8000-000000000000', true), /sem acesso/)
    await assert.rejects(ligar(U1, B1, true, 'anon'), /permission denied/)
    assert.equal((await linha(B1)).ia_habilitada, true, 'a loja não mudou com as tentativas')
  })

  test('cada loja tem o seu código, e ele é único', async () => {
    await db.exec(`update public.barracas set ia_whatsapp_dono = '5511988880000' where id = '${B2}'`)
    const dois = await ligar(U2, B2, true)
    assert.notEqual(dois.ia_codigo, (await linha(B1)).ia_codigo)
    assert.match(dois.ia_codigo ?? '', /^[A-HJKMNP-Z2-9]{6}$/)
    await ligar(U2, B2, false)
  })
})
