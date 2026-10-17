// Ciclo de vida do trial: migration real no PGlite + e-mails (supabase/functions/_shared/trialAvisos.ts).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { emailDoDono, emailDoSuporte, linkPlanos, type AvisoTrial } from '../supabase/functions/_shared/trialAvisos.ts'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const id = (n: number) => `a${n}000000-0000-4000-8000-00000000000${n}`
const U = { semPedido3d: id(1), semPedido8d: id(2), faltam7: id(3), faltam2: id(4), fim: id(5), retorno: id(6), antigo: id(7), stripe: id(8), jaAvisado: id(9) }

let db: PGlite

type Linha = { usuario_id: string; etapa: string; destino: string; barraca_nome: string; dias_restantes: number }

async function pendentes() {
  await db.exec('reset role; set role service_role')
  return (await db.query<Linha>('select * from public.trial_avisos_pendentes()')).rows
}

const por = (linhas: Linha[], uid: string) => linhas.filter((l) => l.usuario_id === uid).map((l) => `${l.etapa}/${l.destino}`)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
    create table public.barracas (id uuid primary key default gen_random_uuid(), nome text, slug text, criada_em timestamptz default now());
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid not null, cancelado_em timestamptz);
    create table public.assinaturas (usuario_id uuid primary key, status text, trial_ends_at timestamptz, stripe_subscription_id text);
    create table public.app_config (chave text primary key, valor jsonb);
    create function public.cobranca_ativa() returns boolean language sql stable security definer
      as $$ select coalesce((select valor <> 'false'::jsonb from public.app_config where chave = 'cobranca_ativa'), true) $$;
    grant usage on schema public to service_role, authenticated;
  `)
  // usuário, cadastro (dias atrás), fim do trial (horas a partir de agora), com pedido?, stripe?
  const casos: [string, number, number, boolean, boolean][] = [
    [U.semPedido3d, 3, 24 * 20, false, false],
    [U.semPedido8d, 8, 24 * 20, false, false],
    [U.faltam7, 23, 24 * 5, true, false],
    [U.faltam2, 28, 24 * 1, true, false],
    [U.fim, 30, -2, true, false],
    [U.retorno, 33, -24 * 3, true, false],
    [U.antigo, 60, -24 * 20, true, false],
    [U.stripe, 28, 24 * 1, true, true],
    [U.jaAvisado, 23, 24 * 5, true, false],
  ]
  for (const [uid, diasCadastro, horasFim, pedido, stripe] of casos) {
    const barraca = `b${uid.slice(1, 2)}000000-0000-4000-8000-00000000000${uid.slice(1, 2)}`
    await db.exec(`
      insert into auth.users values ('${uid}', '${uid.slice(0, 2)}@x.com', now() - interval '${diasCadastro} days');
      insert into public.barracas (id, nome, slug) values ('${barraca}', 'Loja ${uid.slice(1, 2)}', 'loja-${uid.slice(1, 2)}');
      insert into public.usuarios_barracas values ('${uid}', '${barraca}', 'dono');
      insert into public.assinaturas values ('${uid}', 'trialing', now() + interval '${horasFim} hours', ${stripe ? "'sub_1'" : 'null'});
      ${pedido ? `insert into public.pedidos (barraca_id) values ('${barraca}');` : ''}
    `)
  }
  await db.exec(sql('20261028130000_trial_avisos.sql'))
  await db.exec(`insert into public.trial_avisos_enviados (usuario_id, etapa) values ('${U.jaAvisado}', 'faltam_7')`)
})

after(async () => {
  await db.close()
})

describe('trial_avisos_pendentes', () => {
  test('cada situação cai na etapa certa, para o destino certo', async () => {
    const l = await pendentes()
    assert.deepEqual(por(l, U.semPedido3d), ['sem_pedido_48h/dono'])
    assert.deepEqual(por(l, U.semPedido8d), ['sem_pedido_7d/suporte'])
    assert.deepEqual(por(l, U.faltam7), ['faltam_7/dono'])
    assert.deepEqual(por(l, U.faltam2), ['faltam_2/dono'])
    assert.deepEqual(por(l, U.fim), ['fim/dono'])
    assert.deepEqual(por(l, U.retorno), ['retorno/dono'])
  })

  test('fora de janela, com assinatura Stripe ou já avisado: nada', async () => {
    const l = await pendentes()
    assert.deepEqual(por(l, U.antigo), [])
    assert.deepEqual(por(l, U.stripe), [])
    assert.deepEqual(por(l, U.jaAvisado), [])
  })

  test('dias restantes arredonda para cima', async () => {
    const l = await pendentes()
    assert.equal(l.find((x) => x.usuario_id === U.faltam7)?.dias_restantes, 5)
    assert.equal(l.find((x) => x.usuario_id === U.faltam2)?.dias_restantes, 1)
  })

  test('marcar como enviado tira da lista (idempotente)', async () => {
    await db.exec(`reset role; insert into public.trial_avisos_enviados (usuario_id, etapa) values ('${U.faltam2}', 'faltam_2')`)
    assert.deepEqual(por(await pendentes(), U.faltam2), [])
  })

  test('cobrança desligada: ninguém recebe aviso', async () => {
    await db.exec(`reset role; insert into public.app_config values ('cobranca_ativa', 'false'::jsonb)`)
    assert.deepEqual(await pendentes(), [])
    await db.exec(`reset role; delete from public.app_config`)
  })

  test('só a chave de serviço executa; ninguém lê a tabela de avisos', async () => {
    await db.exec('reset role; set role authenticated')
    await assert.rejects(db.query('select * from public.trial_avisos_pendentes()'), /permission denied/)
    await assert.rejects(db.query('select * from public.trial_avisos_enviados'), /permission denied/)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from public.trial_avisos_pendentes()'), /permission denied/)
  })
})

describe('e-mails', () => {
  const aviso = (etapa: AvisoTrial['etapa'], dias = 5): AvisoTrial => ({
    usuario_id: 'u1',
    email: 'dono@x.com',
    barraca_nome: 'Tapioca da Ana',
    barraca_slug: 'tapioca-da-ana',
    etapa,
    destino: etapa === 'sem_pedido_7d' ? 'suporte' : 'dono',
    dias_restantes: dias,
  })

  test('cada etapa do dono cita a barraca; as pagas levam preço e link dos planos', () => {
    for (const etapa of ['faltam_7', 'faltam_2', 'fim', 'retorno'] as const) {
      const e = emailDoDono(aviso(etapa))
      assert.match(e.assunto, /Tapioca da Ana/)
      assert.match(e.texto, /R\$ 57,90/)
      assert.ok(e.texto.includes(linkPlanos('tapioca-da-ana')))
    }
    assert.match(emailDoDono(aviso('sem_pedido_48h')).texto, /ajustes\/cardapio/)
  })

  test('faltam_7 cita os dias; faltam_2 com menos de 1 dia diz isso', () => {
    assert.match(emailDoDono(aviso('faltam_7', 6)).texto, /em 6 dias/)
    assert.match(emailDoDono(aviso('faltam_2', 1)).texto, /menos de 1 dia/)
  })

  test('aviso do suporte não vai para o dono', () => {
    assert.throws(() => emailDoDono(aviso('sem_pedido_7d')), /suporte/)
  })

  test('e-mail do suporte lista todos num só', () => {
    const e = emailDoSuporte([aviso('sem_pedido_7d', 20), { ...aviso('sem_pedido_7d', 10), barraca_nome: 'Outra' }])
    assert.match(e.assunto, /2 trials/)
    assert.match(e.texto, /Tapioca da Ana[\s\S]*Outra/)
  })

  test('slug com caractere especial é escapado no link', () => {
    assert.equal(linkPlanos('a b'), 'https://app.saiae.com.br/a%20b/planos')
  })
})
