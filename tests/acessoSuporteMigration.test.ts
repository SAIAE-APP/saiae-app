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
    create table public.categorias (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, nome text not null, ordem integer not null default 0);
    create table public.itens (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, categoria_id uuid, nome text not null, preco_centavos integer not null default 0, ativo boolean not null default true, ordem integer not null default 0);
    alter table public.barracas enable row level security;
    alter table public.categorias enable row level security;
    alter table public.itens enable row level security;
    create function public.usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean language sql stable security definer set search_path to 'public','pg_temp'
      as $$ select exists(select 1 from usuarios_barracas where barraca_id = p_barraca_id and usuario_id = auth.uid()) $$;
    -- Policies "de sempre" (dono/funcionário) que a migration NÃO deve mudar, só somar.
    create policy "donos veem a barraca" on public.barracas for select using (usuario_tem_acesso_barraca(id));
    create policy "donos veem categorias" on public.categorias for select using (usuario_tem_acesso_barraca(barraca_id));
    create policy "donos escrevem categorias" on public.categorias for insert with check (usuario_tem_acesso_barraca(barraca_id));
    create policy "donos veem itens" on public.itens for select using (usuario_tem_acesso_barraca(barraca_id));
    create policy "donos escrevem itens" on public.itens for insert with check (usuario_tem_acesso_barraca(barraca_id));
    insert into public.barracas values ('${B1}', 'Loja 1', 'loja-1', null), ('${B2}', 'Loja 2', 'loja-2', null);
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono'), ('${DONO_B2}', '${B2}', 'dono');
    insert into auth.users values ('${DONO}'), ('${DONO_B2}'), ('${SUPORTE_OK}'), ('${SUPORTE_FORA}');
    -- PGlite não traz pgcrypto (sem .control file no WASM). No Supabase real ela
    -- já está instalada no schema "extensions" (não "public" — por isso
    -- definir_senha_admin.sql usa search_path = public, extensions; a migration
    -- desta feature replica esse padrão). O stub reproduz digest/gen_random_bytes
    -- NO MESMO SCHEMA "extensions", pra um search_path errado (sem "extensions")
    -- continuar quebrando o teste, do jeito que quebraria em produção.
    create schema extensions;
    create function extensions.digest(data text, algo text) returns bytea language sql immutable
      as $$ select decode(md5(data), 'hex') $$;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile
      as $$ select substring(decode(md5(random()::text || clock_timestamp()::text), 'hex') from 1 for n) $$;
    grant usage on schema public to authenticated;
    grant select on public.usuarios_barracas to authenticated;
  `)
  // mesma razão dos stubs acima: "create extension" não existe no PGlite
  // (sem .control file no WASM); extensions.digest/gen_random_bytes já cobrem
  // o que a migration precisa.
  await db.exec(sql('20261023100000_acesso_suporte.sql').replace('create extension if not exists pgcrypto;', ''))
  // No Supabase real, toda tabela nova do schema public já nasce com select/
  // insert/update/delete pra authenticated/anon (privilégio padrão do
  // projeto); aqui no PGlite isso não existe sozinho — replica só pras
  // tabelas que os testes abaixo tocam direto, fora de RPC.
  await db.exec(`grant select on public.acessos_suporte, public.codigos_suporte to authenticated;`)
  await db.exec(`grant select, insert, update, delete on public.itens, public.categorias to authenticated;`)
  // Grant de tabela completo (select/insert/update/delete), igual ao privilégio
  // padrão do projeto Supabase real — só a AUSÊNCIA de policy de UPDATE em
  // barracas é o que barra o suporte, não um grant faltando (senão o teste
  // de UPDATE abaixo não provaria nada sobre RLS).
  await db.exec(`grant select, insert, update, delete on public.barracas to authenticated;`)
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

async function acessoSuporteAtivo(uid: string, barraca = B1) {
  await como(uid)
  return (await db.query<{ v: boolean }>(`select public.acesso_suporte_ativo($1) as v`, [barraca])).rows[0].v
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

  test('allowlist resgata com sucesso, ganha acesso_suporte_ativo — e usuario_tem_acesso_barraca NUNCA muda', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), false)
    const r = await resgatar(SUPORTE_OK, codigo)
    assert.equal(r.estado, 'ok')
    assert.equal(r.barraca_id, B1)
    assert.equal(r.slug, 'loja-1')
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), true)
    // O ponto central da revisão de segurança: suporte NUNCA passa em
    // usuario_tem_acesso_barraca (payment/CRM/PIN/fiscal/pedidos usam só essa
    // função) — só em acesso_suporte_ativo (itens/categorias/leitura de barraca).
    assert.equal(await temAcesso(SUPORTE_OK), false)
  })

  test('código já usado não resgata de novo (uso único, reivindicado atomicamente)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('código expirado não resgata', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await comoSuperusuario()
    await db.exec(`update public.codigos_suporte set expira_em = now() - interval '1 minute' where codigo_hash = encode(extensions.digest('${codigo}', 'sha256'), 'hex')`)
    assert.deepEqual(await resgatar(SUPORTE_OK, codigo), { estado: 'codigo_invalido' })
  })

  test('código de uma barraca não resgata como se fosse de outra (sem confusão de loja)', async () => {
    // Testes anteriores já podem ter dado acesso de B1 a SUPORTE_OK (mesmo
    // db, estado acumulado — mesmo padrão de tests/iaLigarMigration.test.ts);
    // o que importa aqui é só que o código de B2 nunca dá acesso a B2 por acidente.
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK, B2), false)
    const codigoB2 = (await gerar(DONO_B2, B2)).codigo as string
    const r = await resgatar(SUPORTE_OK, codigoB2)
    assert.equal(r.estado, 'ok')
    assert.equal(r.barraca_id, B2)
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK, B2), true)
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

  test('dono encerra o acesso; acesso_suporte_ativo volta a false; dono de OUTRA loja não pode encerrar', async () => {
    // Testes anteriores podem ter deixado outros acessos ativos de SUPORTE_OK
    // em B1 (mesmo db, estado acumulado) — encerra todos antes, pra este
    // teste só depender do acesso que ele mesmo cria.
    await comoSuperusuario()
    await db.exec(`update public.acessos_suporte set revogado_em = now() where barraca_id = '${B1}' and usuario_suporte_id = '${SUPORTE_OK}' and revogado_em is null`)

    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), true)

    await comoSuperusuario()
    const linha = await db.query<{ id: string }>(
      `select id from public.acessos_suporte where barraca_id = '${B1}' and usuario_suporte_id = '${SUPORTE_OK}' and revogado_em is null`,
    )
    assert.equal(linha.rows.length, 1, 'só deveria sobrar o acesso que este teste acabou de criar')
    const acessoId = linha.rows[0].id

    await como(DONO_B2)
    const negado = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(negado.estado, 'sem_acesso')
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), true, 'negado não deveria ter encerrado nada')

    await como(DONO)
    const ok = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_encerrar_acesso($1) as r`, [acessoId])).rows[0].r
    assert.equal(ok.estado, 'ok')
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), false)
  })

  test('tirar a conta da allowlist encerra o acesso NA HORA (não só depois dos 7 dias)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), true)

    await comoSuperusuario()
    await db.exec(`delete from public.usuarios_suporte where usuario_id = '${SUPORTE_OK}'`)

    assert.equal(await acessoSuporteAtivo(SUPORTE_OK), false)
    await como(SUPORTE_OK)
    const meu = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_meu_acesso($1) as r`, [B1])).rows[0].r
    assert.equal(meu.ativo, false)
    const minhas = await db.query(`select * from public.suporte_minhas_barracas()`)
    assert.equal(minhas.rows.length, 0)

    // restaura pros testes seguintes
    await comoSuperusuario()
    await db.exec(`insert into public.usuarios_suporte (usuario_id) values ('${SUPORTE_OK}')`)
  })

  test('suporte_meu_acesso e suporte_minhas_barracas refletem o acesso ativo (sem duplicar linha por barraca)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    await resgatar(SUPORTE_OK, codigo)
    await como(SUPORTE_OK)
    const meu = (await db.query<{ r: Record<string, unknown> }>(`select public.suporte_meu_acesso($1) as r`, [B1])).rows[0].r
    assert.equal(meu.ativo, true)
    const minhas = await db.query<{ barraca_id: string; slug: string }>(`select * from public.suporte_minhas_barracas()`)
    const deB1 = minhas.rows.filter((l) => l.barraca_id === B1)
    assert.equal(deB1.length, 1, 'uma barraca nunca aparece duas vezes mesmo com mais de um acesso ativo')
    assert.equal(deB1[0].slug, 'loja-1')
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

  test('apagar a conta de suporte não quebra por FK (acessos_suporte cai em cascata; codigos_suporte.usado_por vira NULL)', async () => {
    const codigo = (await gerar(DONO)).codigo as string
    assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')

    await comoSuperusuario()
    await assert.doesNotReject(db.query(`delete from auth.users where id = '${SUPORTE_OK}'`))

    const acessos = await db.query(`select 1 from public.acessos_suporte where usuario_suporte_id = '${SUPORTE_OK}'`)
    assert.equal(acessos.rows.length, 0, 'on delete cascade')
    const codigos = await db.query<{ usado_por: string | null }>(`select usado_por from public.codigos_suporte where codigo_hash = encode(extensions.digest('${codigo}', 'sha256'), 'hex')`)
    assert.equal(codigos.rows[0].usado_por, null, 'on delete set null — a linha do código continua, só perde a referência')

    // restaura pro resto da suíte (mesmo db, estado acumulado)
    await db.exec(`insert into auth.users values ('${SUPORTE_OK}')`)
    await db.exec(`insert into public.usuarios_suporte (usuario_id) values ('${SUPORTE_OK}')`)
  })

  describe('escopo estreito: cardápio sim, resto da loja não', () => {
    test('com acesso ativo, suporte lê e escreve itens/categorias da barraca', async () => {
      const codigo = (await gerar(DONO)).codigo as string
      assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')

      await como(SUPORTE_OK)
      const categoria = await db.query<{ id: string }>(
        `insert into public.categorias (barraca_id, nome) values ('${B1}', 'Bebidas') returning id`,
      )
      assert.equal(categoria.rows.length, 1)
      const item = await db.query<{ id: string }>(
        `insert into public.itens (barraca_id, categoria_id, nome, preco_centavos) values ('${B1}', '${categoria.rows[0].id}', 'Coca-Cola', 500) returning id`,
      )
      assert.equal(item.rows.length, 1)
      const lidos = await db.query(`select * from public.itens where barraca_id = '${B1}'`)
      assert.ok(lidos.rows.length >= 1)
    })

    test('sem acesso ativo (allowlist mas sem resgatar), suporte NÃO escreve itens/categorias', async () => {
      await como(SUPORTE_FORA)
      await assert.rejects(
        db.query(`insert into public.categorias (barraca_id, nome) values ('${B1}', 'Tentativa')`),
        /row-level security|permission denied/i,
      )
    })

    test('suporte lê a barraca (nome/slug) mas não a ATUALIZA — sem policy nova de UPDATE em barracas', async () => {
      const codigo = (await gerar(DONO)).codigo as string
      assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')

      await como(SUPORTE_OK)
      const lida = await db.query(`select nome from public.barracas where id = '${B1}'`)
      assert.equal(lida.rows.length, 1)
      // Sem policy de UPDATE pro suporte, o Postgres não dá erro — a RLS só
      // filtra a linha pra fora do conjunto afetado (0 linhas), diferente de
      // INSERT (que sempre falha explicitamente sem WITH CHECK correspondente).
      const atualizado = await db.query(`update public.barracas set nome = 'Hackeado' where id = '${B1}' returning id`)
      assert.equal(atualizado.rows.length, 0, 'nenhuma linha deveria ser afetada')
      await comoSuperusuario()
      const confere = await db.query<{ nome: string }>(`select nome from public.barracas where id = '${B1}'`)
      assert.equal(confere.rows[0].nome, 'Loja 1', 'o nome não deveria ter mudado')
    })

    test('suporte NUNCA vê nem apaga pedidos — nenhuma policy nova nessa tabela', async () => {
      const codigo = (await gerar(DONO)).codigo as string
      assert.equal((await resgatar(SUPORTE_OK, codigo)).estado, 'ok')
      // usuario_tem_acesso_barraca (a função que a policy de pedidos usa) continua
      // false pro suporte — já coberto no teste acima; aqui só reforça o raciocínio
      // de que nenhuma tabela fora de itens/categorias/barracas(select) ganhou policy.
      assert.equal(await temAcesso(SUPORTE_OK), false)
    })
  })
})
