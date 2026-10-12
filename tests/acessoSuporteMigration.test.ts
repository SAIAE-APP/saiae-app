// Acesso do suporte: migration real (tabelas, RLS, RPCs) rodando de verdade no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const DONO = 'a1000000-0000-4000-8000-000000000001'
const DONO_B2 = 'a4000000-0000-4000-8000-000000000004'
const SUPORTE_OK = 'a2000000-0000-4000-8000-000000000002'
const SUPORTE_FORA = 'a3000000-0000-4000-8000-000000000003'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec(`select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}

/** Volta pro superusuário padrão do PGlite (sem RLS) — usado só pra preparar
 * fixtures de teste (ex.: forçar um código como expirado), nunca pra
 * simular uma chamada de verdade do app (que é sempre authenticated/anon). */
async function comoSuperusuario() {
  await db.exec('reset role')
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, nome text, slug text, logo_url text);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    grant usage on schema public to authenticated;
    grant select on public.usuarios_barracas to authenticated;
    create function public.usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean language sql stable security definer set search_path to 'public','pg_temp'
      as $$ select exists(select 1 from usuarios_barracas where barraca_id = p_barraca_id and usuario_id = auth.uid()) $$;
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1', null), ('${B2}', 'Loja 2', 'loja-2', null);
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono'), ('${DONO_B2}', '${B2}', 'dono');
    insert into auth.users values ('${DONO}'), ('${DONO_B2}'), ('${SUPORTE_OK}'), ('${SUPORTE_FORA}');
    -- PGlite não traz a extensão pgcrypto (sem .control file no WASM); no banco
    -- real ela já está instalada (crypt()/gen_salt() de definir_senha_admin.sql
    -- dependem dela). Este stub só reproduz a assinatura digest(text,text)
    -- returns bytea pra rodar a mesma migration sem mudar nada nela — o teste
    -- confere IGUALDADE de hash, não o algoritmo exato.
    create function public.digest(data text, algo text) returns bytea language sql immutable
      as $$ select decode(md5(data), 'hex') $$;
  `)
  // mesma razão do stub acima: "create extension" não existe no PGlite.
  await db.exec(sql('20261023100000_acesso_suporte.sql').replace('create extension if not exists pgcrypto;', ''))
  // No Supabase real, toda tabela nova do schema public já nasce com select/
  // insert/update/delete pra authenticated/anon (privilégio padrão do
  // projeto); aqui no PGlite isso não existe sozinho, então replica só pra
  // acessos_suporte/codigos_suporte (as únicas que os testes abaixo leem
  // direto, fora de RPC) — mesmo padrão de tests/cuponsPainel.test.ts.
  await db.exec(`grant select on public.acessos_suporte, public.codigos_suporte to authenticated;`)
  await db.exec(`insert into public.usuarios_suporte (usuario_id) values ('${SUPORTE_OK}')`)
})

after(async () => {
  await db.close()
})

async function gerar(uid: string, barraca = B1) {
  await como(uid)
  return (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_gerar_codigo($1) as r`, [barraca])).rows[0].r
}

async function resgatar(uid: string, codigo: string) {
  await como(uid)
  return (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_resgatar_codigo($1) as r`, [codigo])).rows[0].r
}

async function temAcesso(uid: string, barraca = B1) {
  await como(uid)
  return (await db.query<{ v: boolean }>(`select public.usuario_tem_acesso_barraca($1) as v`, [barraca])).rows[0].v
}

describe('acesso do suporte', () => {
  test('só o dono gera código; outra conta recebe sem_acesso', async () => {
    assert.equal((await gerar(SUPORTE_FORA)).estado, 'sem_acesso')
    const r = await gerar(DONO)
    assert.equal(r.estado, 'ok')
    assert.match(r.codigo as string, /^[A-HJKMNP-Z2-9]{8}$/)
  })

  test('conta fora da allowlist e código errado dão o MESMO erro genérico', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    const foraDaLista = await resgatar(SUPORTE_FORA, codigo)
    const codigoErrado = await resgatar(SUPORTE_OK, 'ZZZZZZZZ')
    assert.deepEqual(foraDaLista, { estado: 'codigo_invalido' })
    assert.deepEqual(codigoErrado, { estado: 'codigo_invalido' })
  })

  test('allowlist resgata com sucesso, ganha acesso e usuario_tem_acesso_barraca passa a true', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal(await temAcesso(SUPORTE_OK), false)
    const r = await resgatar(SUPORTE_OK, codigo)
    assert.equal(r.estado, 'ok')
    assert.equal(r.barraca_id, B1)
    assert.equal(r.slug, 'loja-1')
    assert.equal(await temAcesso(SUPORTE_OK), true)
  })

  test('código já usado não resgata de novo (uso único)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('código expirado não resgata', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await comoSuperusuario()
    await db.exec(`update public.codigos_suporte set expira_em = now() - interval '1 minute' where codigo_hash = encode(digest('${codigo}', 'sha256'), 'hex')`)
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('código de uma barraca não resgata como se fosse de outra (sem confusão de loja)', async () => {
    // Testes anteriores já podem ter dado acesso de B1 a SUPORTE_OK (mesmo
    // db, estado acumulado — mesmo padrão de tests/iaLigarMigration.test.ts);
    // o que importa aqui é só que o código de B2 nunca dá acesso a B2 por acidente.
    assert.equal(await temAcesso(SUPORTE_OK, B2), false)
    const codigoB2 = (await gerar(DONO_B2, B2)).codigo as string
    const r = await resgatar(SUPORTE_OK, codigoB2)
    assert.equal(r.estado, 'ok')
    assert.equal(r.barraca_id, B2)
    assert.equal(await temAcesso(SUPORTE_OK, B2), true)
  })

  test('5 tentativas erradas bloqueiam; código certo na 6ª ainda falha; desbloqueia depois do intervalo', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    for (let i = 0; i < 5; i++) await resgatar(SUPORTE_OK, 'ZZZZZZZZ')
    const bloqueado = await resgatar(SUPORTE_OK, codigo)
    assert.equal(bloqueado.estado, 'bloqueado')

    // simula o intervalo já ter passado
    await comoSuperusuario()
    await db.exec(`update public.suporte_tentativas set bloqueado_ate = now() - interval '1 minute' where usuario_id = '${SUPORTE_OK}'`)
    const desbloqueado = await resgatar(SUPORTE_OK, codigo)
    assert.equal(desbloqueado.estado, 'ok')
  })

  test('dono encerra o acesso; usuario_tem_acesso_barraca volta a false; dono de OUTRA loja não pode encerrar', async () => {
    // Testes anteriores podem ter deixado outros acessos ativos de SUPORTE_OK
    // em B1 (mesmo db, estado acumulado) — encerra todos antes, pra este
    // teste só depender do acesso que ele mesmo cria.
    await comoSuperusuario()
    await db.exec(`update public.acessos_suporte set revogado_em = now() where barraca_id = '${B1}' and usuario_suporte_id = '${SUPORTE_OK}' and revogado_em is null`)

    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.equal(await temAcesso(SUPORTE_OK), true)

    await comoSuperusuario()
    const linha = await db.query<{ id: string }>(
      `select id from public.acessos_suporte where barraca_id = '${B1}' and usuario_suporte_id = '${SUPORTE_OK}' and revogado_em is null`,
    )
    assert.equal(linha.rows.length, 1, 'só deveria sobrar o acesso que este teste acabou de criar')
    const acessoId = linha.rows[0].id

    await como(DONO_B2)
    const negado = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(negado.estado, 'sem_acesso')
    assert.equal(await temAcesso(SUPORTE_OK), true, 'negado não deveria ter encerrado nada')

    await como(DONO)
    const ok = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(ok.estado, 'ok')
    assert.equal(await temAcesso(SUPORTE_OK), false)
  })

  test('suporte_meu_acesso e suporte_minhas_barracas refletem o acesso ativo', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await resgatar(SUPORTE_OK, codigo)
    await como(SUPORTE_OK)
    const meu = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_meu_acesso($1) as r`, [B1])).rows[0].r
    assert.equal(meu.ativo, true)
    const minhas = await db.query<{ barraca_id: string; slug: string }>(`select * from public.suporte_minhas_barracas()`)
    assert.ok(minhas.rows.some((l) => l.barraca_id === B1 && l.slug === 'loja-1'))
  })

  test('dono de outra loja não vê nem o código nem os acessos de suporte desta loja', async () => {
    await gerar(DONO)
    await como(DONO_B2)
    const codigos = await db.query(`select 1 from public.codigos_suporte`)
    assert.equal(codigos.rows.length, 0, 'ninguém lê codigos_suporte — nem policy nem grant de select')
    const acessos = await db.query(`select * from public.acessos_suporte where barraca_id = '${B1}'`)
    assert.equal(acessos.rows.length, 0, 'RLS só deixa o dono da própria loja ver')
  })

  test('suporte resgatado continua sem papel=dono em usuarios_barracas — fora, por construção, de apagar_barraca/trocar dono/assinatura', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await resgatar(SUPORTE_OK, codigo)
    const souDono = await db.query<{ v: boolean }>(
      `select exists(select 1 from public.usuarios_barracas where usuario_id = '${SUPORTE_OK}' and barraca_id = '${B1}' and papel = 'dono') as v`,
    )
    assert.equal(souDono.rows[0].v, false)
  })
})
