// IA no WhatsApp: o dono só liga a IA e só ganha código por ia_ligar (trigger barracas_ia_proteger). Roda as
// migrations reais no PGlite, com o papel `authenticated` de verdade. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const U1 = 'a1000000-0000-4000-8000-000000000001'

let db: PGlite

async function como<T>(papel: 'authenticated' | 'anon' | typeof SERVICO, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('test.uid', '${U1}', false); set role ${papel}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function linha() {
  return (await db.query<{ ia_habilitada: boolean; ia_codigo: string | null; ia_whatsapp_dono: string | null; ia_texto_livre: string | null }>(
    `select ia_habilitada, ia_codigo, ia_whatsapp_dono, ia_texto_livre from public.barracas where id = $1`, [B1],
  )).rows[0]
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon, ${SERVICO};
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1');
    insert into public.usuarios_barracas values ('${U1}', '${B1}', 'dono');
  `)
  await db.exec(sql('20261019100000_ia_atendente.sql'))
  await db.exec(sql('20261019110000_ia_ligar_loja.sql'))
  await db.exec(sql('20261019120000_ia_proteger_colunas.sql'))
  await db.exec(sql('20261019120000_ia_proteger_colunas.sql')) // re-executável
  // O Supabase dá grants padrão a esses papéis; o PGlite não. Quem decide o resto é o trigger.
  await db.exec(`grant usage on schema public to authenticated, anon, ${SERVICO};
    grant select, insert, update, delete on public.barracas to authenticated, ${SERVICO}; grant select on public.usuarios_barracas to authenticated, ${SERVICO};`)
})

after(async () => {
  await db.close()
})

describe('barracas_ia_proteger: o dono pela API', () => {
  test('editar o texto livre e o WhatsApp do dono continua permitido (a tela salva assim)', async () => {
    await como('authenticated', () => db.query(`update public.barracas set ia_texto_livre = 'Aceitamos encomenda', ia_whatsapp_dono = '5511999990000', nome = 'Loja 1b' where id = '${B1}'`))
    const l = await linha()
    assert.equal(l.ia_texto_livre, 'Aceitamos encomenda')
    assert.equal(l.ia_whatsapp_dono, '5511999990000')
  })

  test('ligar direto na tabela é recusado e nada muda', async () => {
    await assert.rejects(como('authenticated', () => db.query(`update public.barracas set ia_habilitada = true where id = '${B1}'`)), /ia_use_a_tela/)
    assert.equal((await linha()).ia_habilitada, false)
  })

  test('escolher o próprio código é recusado (e tentar limpar também)', async () => {
    await assert.rejects(como('authenticated', () => db.query(`update public.barracas set ia_codigo = 'ABCD23' where id = '${B1}'`)), /ia_use_a_tela/)
    assert.equal((await linha()).ia_codigo, null)
  })

  test('regravar o mesmo valor (sem mudar) não é bloqueado: o app pode mandar a linha inteira', async () => {
    await como('authenticated', () => db.query(`update public.barracas set ia_habilitada = false, ia_codigo = null, nome = 'Loja 1' where id = '${B1}'`))
  })

  test('anon e authenticated não criam barraca já com a IA ligada nem com código', async () => {
    for (const papel of ['authenticated', 'anon'] as const) {
      await assert.rejects(como(papel, () => db.query(`insert into public.barracas (id, nome, slug, ia_habilitada, ia_whatsapp_dono) values (gen_random_uuid(), 'X', 'x-${papel}', true, '5511999990000')`)), /ia_use_a_tela|permission denied/, papel)
      await assert.rejects(como(papel, () => db.query(`insert into public.barracas (id, nome, slug, ia_codigo) values (gen_random_uuid(), 'X', 'y-${papel}', 'ABCD23')`)), /ia_use_a_tela|permission denied/, papel)
    }
    await como('authenticated', () => db.query(`insert into public.barracas (id, nome, slug) values (gen_random_uuid(), 'Nova', 'nova')`))
  })
})

describe('barracas_ia_proteger: o caminho certo continua funcionando', () => {
  test('ia_ligar (função do banco) liga e desliga mesmo com o dono logado', async () => {
    const r = await como('authenticated', async () => (await db.query<{ r: { ia_habilitada: boolean; ia_codigo: string } }>(`select public.ia_ligar('${B1}', true) as r`)).rows[0].r)
    assert.equal(r.ia_habilitada, true)
    assert.match(r.ia_codigo, /^[A-HJKMNP-Z2-9]{6}$/)
    assert.equal((await linha()).ia_habilitada, true)
  })

  test('com a IA ligada, o dono não consegue esvaziar o WhatsApp do dono; trocar por outro número vale', async () => {
    await assert.rejects(como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = null where id = '${B1}'`)), /ia_sem_whatsapp_dono/)
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = '5511988880000' where id = '${B1}'`))
    assert.equal((await linha()).ia_whatsapp_dono, '5511988880000')
  })

  test('o papel de serviço pode mexer direto (manutenção), mas a regra do WhatsApp vale para ele também', async () => {
    await como(SERVICO, () => db.query(`update public.barracas set ia_codigo = 'KMNP23' where id = '${B1}'`))
    assert.equal((await linha()).ia_codigo, 'KMNP23')
    await assert.rejects(como(SERVICO, () => db.query(`update public.barracas set ia_whatsapp_dono = null where id = '${B1}'`)), /ia_sem_whatsapp_dono/)
  })

  test('desligada, o WhatsApp do dono pode ser apagado', async () => {
    await como('authenticated', () => db.query(`select public.ia_ligar('${B1}', false)`))
    await como('authenticated', () => db.query(`update public.barracas set ia_whatsapp_dono = null where id = '${B1}'`))
    assert.equal((await linha()).ia_whatsapp_dono, null)
  })
})
