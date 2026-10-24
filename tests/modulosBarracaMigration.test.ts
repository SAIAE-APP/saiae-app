// Módulos pagos, tarefa 1: tabela, vigência, espelho das flags e proteção. Migration real no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const OUTRO = 'a2000000-0000-4000-8000-000000000002'
const B_LOJA = 'b1000000-0000-4000-8000-000000000001' // loja do DONO
const B_OUTRA = 'b2000000-0000-4000-8000-000000000002' // loja do OUTRO
const B_SAIAE = 'b3000000-0000-4000-8000-000000000003'
const B_DHELENA = 'b4000000-0000-4000-8000-000000000004'
const B_QA = 'b5000000-0000-4000-8000-000000000005'
const B_NADA = 'b6000000-0000-4000-8000-000000000006'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

async function limpar(barraca = B_LOJA) {
  await db.exec(`reset role; delete from public.modulos_barraca where barraca_id = '${barraca}'`)
}

// insere e consulta na MESMA transação: now() é o mesmo, então o limite de 7 dias é testável exato.
async function vigente(
  modulo: string, estado: string, origem: string, pagoAte: string | null, testeAte: string | null = null,
) {
  return db.transaction(async (tx) => {
    await tx.exec('reset role')
    await tx.query('delete from public.modulos_barraca where barraca_id = $1', [B_LOJA])
    await tx.query(
      `insert into public.modulos_barraca (barraca_id, modulo, estado, origem, pago_ate, teste_ate)
       values ($1, $2, $3, $4, ${pagoAte ?? 'null'}, ${testeAte ?? 'null'})`,
      [B_LOJA, modulo, estado, origem],
    )
    return (await tx.query<{ v: boolean }>('select public.modulo_ativo($1, $2) as v', [B_LOJA, modulo])).rows[0].v
  })
}

async function flags(barraca: string) {
  await db.exec('reset role')
  return (await db.query<{ f: boolean; d: boolean; i: boolean }>(
    `select fiscal_habilitado f, whatsapp_disparos_habilitado d, ia_habilitada i from public.barracas where id = '${barraca}'`,
  )).rows[0]
}

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
    -- mesmo desenho de barracas_ia_proteger (20261019150000), só a parte que o teste exercita
    create function public.barracas_ia_proteger() returns trigger language plpgsql as $$
      begin
        if current_user in ('authenticated', 'anon') and new.ia_habilitada is distinct from old.ia_habilitada then
          raise exception 'ia_use_a_tela';
        end if;
        return new;
      end $$;
    create trigger barracas_ia_proteger before update on public.barracas for each row execute function public.barracas_ia_proteger();

    insert into public.barracas (id, slug) values
      ('${B_LOJA}', 'loja'), ('${B_OUTRA}', 'outra'), ('${B_SAIAE}', 'sai-ae-uma-barraca'),
      ('${B_DHELENA}', 'dhelenarestaurante'), ('${B_QA}', 'qa-teste-varredura'), ('${B_NADA}', 'sem-modulo');
    update public.barracas set fiscal_habilitado = true where id = '${B_DHELENA}';
    update public.barracas set fiscal_habilitado = true, ia_habilitada = true where id = '${B_NADA}';
    insert into public.usuarios_barracas values ('${DONO}', '${B_LOJA}', 'dono'), ('${OUTRO}', '${B_OUTRA}', 'dono');
    insert into public.superadmins values ('${ADMIN}');
  `)
  // colunas e proteção reais dos disparos
  await db.exec(sql('20261101100000_disparos_whatsapp.sql'))
  await db.exec(sql('20261103100000_modulos_barraca.sql'))
})

after(async () => {
  await db.close()
})

describe('vigência', () => {
  test('modulo_ativo: sem linha é falso', async () => {
    await limpar()
    assert.equal((await db.query<{ v: boolean }>(`select public.modulo_ativo('${B_LOJA}', 'fiscal') as v`)).rows[0].v, false)
  })

  test('cortesia ativa com pago_ate nulo é verdadeira', async () => {
    assert.equal(await vigente('fiscal', 'ativo', 'cortesia', null), true)
  })

  test('pago ativo: pago_ate há 6 dias e 7 dias é verdadeiro; há 8 dias é falso', async () => {
    assert.equal(await vigente('fiscal', 'ativo', 'pago', `now() - interval '6 days'`), true)
    assert.equal(await vigente('fiscal', 'ativo', 'pago', `now() - interval '7 days'`), true)
    assert.equal(await vigente('fiscal', 'ativo', 'pago', `now() - interval '8 days'`), false)
  })

  test('teste vigente é verdadeiro e teste vencido é falso', async () => {
    assert.equal(await vigente('fiscal', 'teste', 'cortesia', null, `now() + interval '1 day'`), true)
    assert.equal(await vigente('fiscal', 'teste', 'cortesia', null, `now() - interval '1 second'`), false)
  })

  test('suspenso e cancelado são falsos', async () => {
    assert.equal(await vigente('fiscal', 'suspenso', 'cortesia', null), false)
    assert.equal(await vigente('fiscal', 'cancelado', 'cortesia', null), false)
  })

  test('whatsapp_disparos é falso quando whatsapp_avisos não está vigente', async () => {
    await limpar()
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem, termo_versao)
      values ('${B_LOJA}', 'whatsapp_disparos', 'ativo', 'cortesia', 't')`)
    const ativo = async () =>
      (await db.query<{ v: boolean }>(`select public.modulo_ativo('${B_LOJA}', 'whatsapp_disparos') as v`)).rows[0].v
    assert.equal(await ativo(), false)
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem)
      values ('${B_LOJA}', 'whatsapp_avisos', 'ativo', 'cortesia')`)
    assert.equal(await ativo(), true)
    await db.exec(`update public.modulos_barraca set estado = 'suspenso' where barraca_id = '${B_LOJA}' and modulo = 'whatsapp_avisos'`)
    assert.equal(await ativo(), false)
    await limpar()
  })
})

describe('tabela e RLS', () => {
  test('check: ativo pago sem pago_ate é rejeitado; modulo fora da lista é rejeitado', async () => {
    await limpar()
    await assert.rejects(
      db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values ('${B_LOJA}', 'fiscal', 'ativo', 'pago')`),
      /modulos_barraca_pago_exige_data/,
    )
    await assert.rejects(
      db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values ('${B_LOJA}', 'outro', 'ativo', 'cortesia')`),
      /modulos_barraca_modulo_check/,
    )
  })

  test('RLS: dono lê só os módulos da própria loja e não consegue insert/update/delete', async () => {
    await limpar(); await limpar(B_OUTRA)
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values
      ('${B_LOJA}', 'fiscal', 'ativo', 'cortesia'), ('${B_OUTRA}', 'fiscal', 'ativo', 'cortesia')`)
    await como(DONO)
    const rows = (await db.query<{ barraca_id: string }>('select barraca_id from public.modulos_barraca')).rows
    assert.deepEqual(rows.map((r) => r.barraca_id), [B_LOJA])
    await assert.rejects(db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values ('${B_LOJA}', 'whatsapp_bot', 'ativo', 'cortesia')`), /permission denied/)
    await assert.rejects(db.exec(`update public.modulos_barraca set estado = 'cancelado'`), /permission denied/)
    await assert.rejects(db.exec(`delete from public.modulos_barraca`), /permission denied/)
    await limpar(); await limpar(B_OUTRA)
  })

  test('modulos_ativos devolve só os vigentes e {} para quem não tem acesso', async () => {
    await limpar()
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem, teste_ate) values
      ('${B_LOJA}', 'whatsapp_avisos', 'ativo', 'cortesia', null),
      ('${B_LOJA}', 'whatsapp_bot', 'suspenso', 'cortesia', null),
      ('${B_LOJA}', 'fiscal', 'teste', 'cortesia', now() + interval '2 days')`)
    const lista = async () =>
      (await db.query<{ v: string[] }>(`select public.modulos_ativos('${B_LOJA}') as v`)).rows[0].v
    await como(DONO)
    assert.deepEqual(await lista(), ['fiscal', 'whatsapp_avisos'])
    await como(OUTRO)
    assert.deepEqual(await lista(), [])
    await como(ADMIN)
    assert.deepEqual(await lista(), ['fiscal', 'whatsapp_avisos'])
    await como(null, 'anon')
    await assert.rejects(lista(), /permission denied/)
    await limpar()
  })
})

describe('espelho e proteção', () => {
  test('espelho: ativar fiscal liga fiscal_habilitado; suspender desliga; desligar bot força ia_habilitada=false mas ativar bot nunca liga ia_habilitada', async () => {
    await limpar()
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values ('${B_LOJA}', 'fiscal', 'ativo', 'cortesia')`)
    assert.equal((await flags(B_LOJA)).f, true)
    await db.exec(`update public.modulos_barraca set estado = 'suspenso' where barraca_id = '${B_LOJA}' and modulo = 'fiscal'`)
    assert.equal((await flags(B_LOJA)).f, false)

    // ativar bot não liga a IA
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values ('${B_LOJA}', 'whatsapp_bot', 'ativo', 'cortesia')`)
    assert.equal((await flags(B_LOJA)).i, false)
    // IA ligada por quem tem o direito (dono do banco); suspender o bot desliga
    await db.exec(`update public.barracas set ia_habilitada = true where id = '${B_LOJA}'`)
    assert.equal((await flags(B_LOJA)).i, true)
    await db.exec(`update public.modulos_barraca set estado = 'suspenso' where barraca_id = '${B_LOJA}' and modulo = 'whatsapp_bot'`)
    assert.equal((await flags(B_LOJA)).i, false)
    // reativar o bot de novo não religa
    await db.exec(`update public.modulos_barraca set estado = 'ativo' where barraca_id = '${B_LOJA}' and modulo = 'whatsapp_bot'`)
    assert.equal((await flags(B_LOJA)).i, false)

    // disparos segue avisos
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem) values
      ('${B_LOJA}', 'whatsapp_avisos', 'ativo', 'cortesia'), ('${B_LOJA}', 'whatsapp_disparos', 'ativo', 'cortesia')`)
    assert.equal((await flags(B_LOJA)).d, true)
    await db.exec(`delete from public.modulos_barraca where barraca_id = '${B_LOJA}' and modulo = 'whatsapp_avisos'`)
    assert.equal((await flags(B_LOJA)).d, false)
    await limpar()
    assert.deepEqual(await flags(B_LOJA), { f: false, d: false, i: false })
  })

  test("authenticated não consegue mudar fiscal_habilitado, ia_habilitada nem whatsapp_disparos_habilitado por update direto (exceção 'fiscal_use_o_modulo' para fiscal)", async () => {
    await como(DONO)
    await assert.rejects(db.exec(`update public.barracas set fiscal_habilitado = true where id = '${B_LOJA}'`), /fiscal_use_o_modulo/)
    await assert.rejects(db.exec(`update public.barracas set ia_habilitada = true where id = '${B_LOJA}'`), /ia_use_a_tela/)
    await assert.rejects(db.exec(`update public.barracas set whatsapp_disparos_habilitado = true where id = '${B_LOJA}'`), /disparos_use_a_tela/)
  })
})

describe('backfill', () => {
  test("backfill: sai-ae-uma-barraca recebe avisos, disparos e bot; dhelenarestaurante recebe avisos e disparos e NÃO recebe fiscal; qa-teste-varredura recebe os quatro; todos origem cortesia, estado ativo, termo_versao 'legado-2026-10-24'", async () => {
    await db.exec('reset role')
    const por = async (id: string) =>
      (await db.query<{ modulo: string }>(`select modulo from public.modulos_barraca where barraca_id = '${id}' order by modulo`)).rows.map((r) => r.modulo)
    assert.deepEqual(await por(B_SAIAE), ['whatsapp_avisos', 'whatsapp_bot', 'whatsapp_disparos'])
    assert.deepEqual(await por(B_DHELENA), ['whatsapp_avisos', 'whatsapp_disparos'])
    assert.deepEqual(await por(B_QA), ['fiscal', 'whatsapp_avisos', 'whatsapp_bot', 'whatsapp_disparos'])
    assert.deepEqual(await por(B_NADA), [])
    const fora = await db.query(
      `select 1 from public.modulos_barraca where (origem <> 'cortesia' or estado <> 'ativo' or termo_versao is distinct from 'legado-2026-10-24')
        and barraca_id in ('${B_SAIAE}', '${B_DHELENA}', '${B_QA}')`)
    assert.equal(fora.rows.length, 0)
    // espelho do backfill: dhelena perdeu o fiscal sem token; loja sem módulo perde flags antigas
    assert.deepEqual(await flags(B_DHELENA), { f: false, d: true, i: false })
    assert.deepEqual(await flags(B_QA), { f: true, d: true, i: false })
    assert.deepEqual(await flags(B_NADA), { f: false, d: false, i: false })
  })
})
