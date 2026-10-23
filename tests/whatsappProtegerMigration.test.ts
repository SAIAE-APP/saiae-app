// Revisão final: texto em branco recusado na RPC e colunas whatsapp_* só mudam pelas funções. PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ler = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')
const B1 = 'b1000000-0000-4000-8000-000000000001'
const DONO = 'a1000000-0000-4000-8000-000000000001'

describe('proteção das colunas whatsapp_*', () => {
  let db: PGlite
  const sql = ler('20261030120000_whatsapp_proteger.sql')

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth; grant usage on schema auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.barracas (id uuid primary key, nome text);
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
        select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
      grant usage on schema public to authenticated, anon, service_role;
      grant select, update on public.barracas to authenticated, service_role;
      insert into public.barracas values ('${B1}', 'B1');
      insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono');
    `)
    // as colunas de status entram pela migration própria; o create function da RPC de avisos vem antes
    await db.exec(`alter table public.barracas add column whatsapp_avisos jsonb`)
    await db.exec(ler('20261030100000_whatsapp_avisos.sql').split('CREATE OR REPLACE FUNCTION public.montar_evento_saida')[0])
    await db.exec(ler('20261030110000_whatsapp_status.sql'))
    await db.exec(sql)
    await db.exec(sql) // idempotente
    await db.exec(`select set_config('test.uid', '${DONO}', false); set role authenticated`)
  })
  after(async () => {
    await db.close()
  })

  const salvar = async (avisos: unknown) =>
    (await db.query<{ r: { estado: string } }>('select public.whatsapp_avisos_salvar($1, $2::jsonb) as r', [B1, JSON.stringify(avisos)])).rows[0].r.estado

  test('RPC recusa texto só com espaços e aceita texto normal e null', async () => {
    assert.equal(await salvar({ pronto: { ativo: true, texto: '   ' } }), 'dados_invalidos')
    assert.equal(await salvar({ pronto: { ativo: true, texto: '' } }), 'dados_invalidos')
    assert.equal(await salvar({ pronto: { ativo: true, texto: 'Oi {nome}' } }), 'ok')
    assert.equal(await salvar({ pronto: { ativo: true, texto: null } }), 'ok')
  })

  test('UPDATE direto das colunas whatsapp_* pelo usuário é recusado', async () => {
    await assert.rejects(db.exec(`update public.barracas set whatsapp_avisos = '{"x":1}'::jsonb where id = '${B1}'`), /whatsapp_use_a_tela/)
    await assert.rejects(db.exec(`update public.barracas set whatsapp_status_em = '2099-01-01' where id = '${B1}'`), /whatsapp_use_a_tela/)
    await assert.rejects(db.exec(`update public.barracas set whatsapp_status = 'caiu' where id = '${B1}'`), /whatsapp_use_a_tela/)
  })

  test('outras colunas seguem editáveis; a RPC continua gravando', async () => {
    await db.exec(`update public.barracas set nome = 'Novo' where id = '${B1}'`)
    assert.equal(await salvar({ pronto: { ativo: false, texto: null } }), 'ok')
  })

  test('papel de serviço continua podendo gravar o status', async () => {
    await db.exec('reset role; set role service_role')
    await db.exec(`update public.barracas set whatsapp_status = 'caiu' where id = '${B1}'`)
  })
})
