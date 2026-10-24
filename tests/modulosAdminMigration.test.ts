// Módulos pagos, tarefa 2: funções do superadmin. Migrations reais no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const B_LOJA = 'b1000000-0000-4000-8000-000000000001'
const B_LEGADO = 'b3000000-0000-4000-8000-000000000003' // sai-ae-uma-barraca: backfill com termo legado

let db: PGlite

async function como(uid: string | null) {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role authenticated`)
}
async function limpar() {
  await db.exec(`reset role; delete from public.modulos_barraca where barraca_id = '${B_LOJA}';
    delete from public.modulos_eventos where barraca_id = '${B_LOJA}'`)
}
const arg = (v: string | null) => (v === null ? 'null' : `'${v}'`)
async function definir(
  modulo: string, estado: string, origem = 'cortesia', teste: string | null = null, pago: string | null = null,
  termo: string | null = null, barraca = B_LOJA,
) {
  const r = await db.query<{ r: { estado: string } }>(
    `select public.admin_modulo_definir('${barraca}', '${modulo}', '${estado}', '${origem}', ${arg(teste)}, ${arg(pago)}, ${arg(termo)}) as r`)
  return r.rows[0].r.estado
}
async function pacote(origem: string, teste: string | null, pago: string | null, termo: string | null) {
  const r = await db.query<{ r: { estado: string } }>(
    `select public.admin_pacote_whatsapp('${B_LOJA}', '${origem}', ${arg(teste)}, ${arg(pago)}, ${arg(termo)}) as r`)
  return r.rows[0].r.estado
}
async function cobrada() {
  const r = await db.query<{ r: { estado: string } }>(`select public.admin_modulo_ativacao_cobrada('${B_LOJA}') as r`)
  return r.rows[0].r.estado
}
async function linhas(barraca = B_LOJA) {
  await db.exec('reset role')
  return (await db.query<Record<string, unknown>>(
    `select * from public.modulos_barraca where barraca_id = '${barraca}' order by modulo`)).rows
}
const FUTURO = '2099-01-01T00:00:00Z'

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema public to authenticated, anon, service_role;
    create table public.barracas (
      id uuid primary key default gen_random_uuid(), slug text,
      fiscal_habilitado boolean not null default false,
      ia_habilitada boolean not null default false
    );
    grant select, update on public.barracas to authenticated;
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.superadmins (usuario_id uuid primary key);
    create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql stable security definer as $$
      select exists (select 1 from public.usuarios_barracas where usuario_id = auth.uid() and barraca_id = p) $$;
    create function public.sou_superadmin() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.superadmins where usuario_id = auth.uid()) $$;
    create function public.barracas_ia_proteger() returns trigger language plpgsql as $$
      begin
        if current_user in ('authenticated', 'anon') and new.ia_habilitada is distinct from old.ia_habilitada then
          raise exception 'ia_use_a_tela';
        end if;
        return new;
      end $$;
    create trigger barracas_ia_proteger before update on public.barracas for each row execute function public.barracas_ia_proteger();
    insert into public.barracas (id, slug) values ('${B_LOJA}', 'loja'), ('${B_LEGADO}', 'sai-ae-uma-barraca');
    insert into public.usuarios_barracas values ('${DONO}', '${B_LOJA}', 'dono');
    insert into public.superadmins values ('${ADMIN}');
  `)
  await db.exec(sql('20261101100000_disparos_whatsapp.sql'))
  await db.exec(sql('20261103100000_modulos_barraca.sql'))
  await db.exec(sql('20261103110000_modulos_admin.sql'))
})

after(async () => {
  await db.close()
})

describe('funções do admin', () => {
  test('não-superadmin recebe nao_autorizado em todas', async () => {
    await limpar()
    await como(DONO)
    assert.equal(await definir('whatsapp_avisos', 'ativo'), 'nao_autorizado')
    assert.equal(await cobrada(), 'nao_autorizado')
    assert.equal(await pacote('cortesia', null, null, 't1'), 'nao_autorizado')
    // listar devolve conjunto vazio (função de tabela não tem jsonb para devolver nao_autorizado)
    assert.equal((await db.query(`select * from public.admin_modulos_listar('${B_LOJA}')`)).rows.length, 0)
    assert.equal((await linhas()).length, 0)
    await como(null)
    assert.equal(await definir('whatsapp_avisos', 'ativo'), 'nao_autorizado')
  })

  test('anon não executa', async () => {
    await db.exec('reset role; set role anon')
    await assert.rejects(definir('whatsapp_avisos', 'ativo'), /permission denied/)
  })

  test('definir fiscal ativo sem termo devolve termo_obrigatorio e não grava', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await definir('fiscal', 'ativo'), 'termo_obrigatorio')
    assert.equal(await definir('fiscal', 'teste', 'cortesia', FUTURO), 'termo_obrigatorio')
    assert.equal((await linhas()).length, 0)
  })

  test('definir fiscal com termo grava termo_aceito_em e ativado_em', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await definir('fiscal', 'ativo', 'cortesia', null, null, 'v1'), 'ok')
    const [l] = await linhas()
    assert.equal(l.termo_versao, 'v1')
    assert.ok(l.termo_aceito_em)
    assert.ok(l.ativado_em)
    assert.equal(l.estado, 'ativo')
  })

  test('definir fiscal em loja que já tem termo_versao legado não exige termo novo', async () => {
    await limpar()
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem, termo_versao, termo_aceito_em)
      values ('${B_LOJA}', 'fiscal', 'suspenso', 'cortesia', 'legado-2026-10-24', now())`)
    await como(ADMIN)
    assert.equal(await definir('fiscal', 'ativo'), 'ok')
    const [l] = await linhas()
    assert.equal(l.termo_versao, 'legado-2026-10-24')
    assert.equal(l.estado, 'ativo')
    await limpar()
  })

  test('ativar whatsapp_disparos com avisos inativo devolve dependencia', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await definir('whatsapp_disparos', 'ativo', 'cortesia', null, null, 'v1'), 'dependencia')
    assert.equal(await definir('whatsapp_avisos', 'suspenso'), 'ok')
    assert.equal(await definir('whatsapp_disparos', 'teste', 'cortesia', FUTURO, null, 'v1'), 'dependencia')
    assert.equal((await linhas()).filter((l) => l.modulo === 'whatsapp_disparos').length, 0)
    assert.equal(await definir('whatsapp_avisos', 'ativo'), 'ok')
    assert.equal(await definir('whatsapp_disparos', 'ativo', 'cortesia', null, null, 'v1'), 'ok')
  })

  test('suspender avisos não é bloqueado por ter disparos ativo (disparos passa a não vigente)', async () => {
    await como(ADMIN)
    assert.equal(await definir('whatsapp_avisos', 'suspenso'), 'ok')
    assert.equal(await definir('whatsapp_avisos', 'cancelado'), 'ok')
    const v = await db.query<{ v: boolean }>(`select public.modulo_ativo('${B_LOJA}', 'whatsapp_disparos') as v`)
    assert.equal(v.rows[0].v, false)
    await limpar()
  })

  test('pago ativo sem p_pago_ate devolve invalido', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await definir('whatsapp_avisos', 'ativo', 'pago'), 'invalido')
    assert.equal(await definir('whatsapp_avisos', 'teste', 'cortesia'), 'invalido') // teste sem teste_ate
    assert.equal(await definir('outro', 'ativo'), 'invalido')
    assert.equal(await definir('whatsapp_avisos', 'ligado'), 'invalido')
    assert.equal(await definir('whatsapp_avisos', 'ativo', 'doacao'), 'invalido')
    assert.equal((await linhas()).length, 0)
    assert.equal(await definir('whatsapp_avisos', 'ativo', 'pago', null, FUTURO), 'ok')
  })

  test('todo definir grava uma linha em modulos_eventos com ator, de e para', async () => {
    await limpar(); await como(ADMIN)
    await definir('whatsapp_bot', 'ativo')
    await definir('whatsapp_bot', 'suspenso')
    await definir('fiscal', 'ativo') // recusado: não grava evento
    await db.exec('reset role')
    const ev = (await db.query<{ ator: string; de: { estado: string } | null; para: { estado: string } }>(
      `select ator, de, para from public.modulos_eventos where barraca_id = '${B_LOJA}' and modulo = 'whatsapp_bot' order by id`)).rows
    assert.equal(ev.length, 2)
    assert.equal(ev[0].ator, ADMIN)
    assert.equal(ev[0].de, null)
    assert.equal(ev[0].para.estado, 'ativo')
    assert.equal(ev[1].de?.estado, 'ativo')
    assert.equal(ev[1].para.estado, 'suspenso')
    const n = await db.query(`select 1 from public.modulos_eventos where barraca_id = '${B_LOJA}' and modulo = 'fiscal'`)
    assert.equal(n.rows.length, 0)
  })

  test('pacote cria as 3 linhas ou nenhuma', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await pacote('cortesia', null, null, null), 'termo_obrigatorio') // disparos exige termo
    assert.equal(await pacote('pago', null, null, 't1'), 'invalido') // pago sem pago_ate
    assert.equal((await linhas()).length, 0)
    assert.equal(await pacote('cortesia', null, null, 't1'), 'ok')
    let ls = await linhas()
    assert.deepEqual(ls.map((l) => l.modulo), ['whatsapp_avisos', 'whatsapp_bot', 'whatsapp_disparos'])
    assert.ok(ls.every((l) => l.estado === 'ativo'))
    await limpar(); await como(ADMIN)
    assert.equal(await pacote('cortesia', FUTURO, null, 't1'), 'ok')
    ls = await linhas()
    assert.ok(ls.every((l) => l.estado === 'teste'))
    await db.exec('reset role')
    assert.equal((await db.query(`select 1 from public.modulos_eventos where barraca_id = '${B_LOJA}'`)).rows.length, 3)
  })

  test('ativacao_cobrada só aceita fiscal', async () => {
    await limpar(); await como(ADMIN)
    assert.equal(await cobrada(), 'invalido') // sem linha de fiscal
    await definir('fiscal', 'ativo', 'cortesia', null, null, 'v1')
    assert.equal(await cobrada(), 'ok')
    assert.ok((await linhas())[0].ativacao_cobrada_em)
    await definir('whatsapp_avisos', 'ativo')
    await db.exec('reset role')
    const outros = await db.query(`select 1 from public.modulos_barraca where barraca_id = '${B_LOJA}' and modulo <> 'fiscal' and ativacao_cobrada_em is not null`)
    assert.equal(outros.rows.length, 0)
  })

  test('listar devolve 4 linhas', async () => {
    await limpar(); await como(ADMIN)
    await definir('whatsapp_avisos', 'ativo')
    const r = (await db.query<{ modulo: string; estado: string; vigente: boolean }>(
      `select * from public.admin_modulos_listar('${B_LOJA}') order by modulo`)).rows
    assert.deepEqual(r.map((x) => x.modulo), ['fiscal', 'whatsapp_avisos', 'whatsapp_bot', 'whatsapp_disparos'])
    assert.deepEqual(r.map((x) => x.estado), ['inativo', 'ativo', 'inativo', 'inativo'])
    assert.deepEqual(r.map((x) => x.vigente), [false, true, false, false])
    await limpar()
  })
})
