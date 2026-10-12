// Auditoria, Pacote 3 (M3, M5, M7): migrations reais rodando no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'

const GRUPO1 = [
  'apagar_barraca', 'assinatura_da_barraca', 'barraca_assinatura_ativa', 'cobranca_ativa', 'criar_barraca',
  'definir_senha_admin', 'definir_token_fiscal', 'definir_token_pagamento', 'senha_admin_configurada',
  'token_fiscal_configurado', 'token_pagamento_configurado', 'verificar_senha_admin', 'usuario_tem_acesso_barraca',
]
const GRUPO2 = [
  'criar_assinatura_trial', 'trg_pedido_evento_criado', 'trg_pedido_evento_pago_na_entrega',
  'trg_pedido_evento_status', 'trg_pendente_evento_pago', 'processar_webhook_kirvano',
]
const PUBLICAS = [
  'bairros_entrega_publicos', 'banners_publicos', 'barraca_slug_atual', 'cardapio_publico',
  'consultar_status_pagamento', 'cupom_config', 'entregador_confirmar', 'entregador_pedido',
  'horarios_publicos', 'ofertas_publicas', 'opcoes_publicas', 'perfil_cliente_config',
]

let db: PGlite

async function pode(papel: string, funcao: string): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(
    `select bool_and(has_function_privilege('${papel}', p.oid, 'execute')) as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '${funcao}'`,
  )
  assert.notEqual(r.rows[0].ok, null, `função ${funcao} não existe`)
  return r.rows[0].ok
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    -- Como no Supabase: default privileges dão EXECUTE a anon/authenticated/service_role.
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  // Funções de mentira com as MESMAS assinaturas de nome; sobrecarga incluída de propósito.
  for (const nome of [...GRUPO1, ...GRUPO2, ...PUBLICAS]) {
    await db.exec(`create function public.${nome}(p_x text) returns text language sql as $$ select 'ok'::text $$;`)
  }
  await db.exec(`create function public.definir_token_pagamento(p_x text, p_y text) returns text language sql as $$ select 'ok'::text $$;`)
  await db.exec(sql('20261026110000_revogar_anon_funcoes.sql'))
})

after(async () => {
  await db.close()
})

describe('M3: revogação de funções para anon', () => {
  test('grupo 1: anon perde, authenticated e service_role mantêm', async () => {
    for (const f of GRUPO1) {
      assert.equal(await pode('anon', f), false, `${f} ainda aberta para anon`)
      assert.equal(await pode('authenticated', f), true, `${f} perdeu authenticated`)
      assert.equal(await pode('service_role', f), true, `${f} perdeu service_role`)
    }
  })
  test('sobrecargas também são revogadas (definir_token_pagamento tem 2 assinaturas)', async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p where p.proname = 'definir_token_pagamento'
          and has_function_privilege('anon', p.oid, 'execute')`,
    )
    assert.equal(r.rows[0].n, 0)
  })
  test('grupo 2 (job/trigger): ninguém além do dono executa', async () => {
    for (const f of GRUPO2) {
      assert.equal(await pode('anon', f), false, `${f} aberta para anon`)
      assert.equal(await pode('authenticated', f), false, `${f} aberta para authenticated`)
    }
  })
  test('as 12 públicas de propósito continuam abertas para anon', async () => {
    for (const f of PUBLICAS) assert.equal(await pode('anon', f), true, `${f} deixou de ser pública`)
  })
  test('função futura nasce sem EXECUTE explícito para anon (default privileges)', async () => {
    await db.exec(`create function public.funcao_futura() returns int language sql as $$ select 1 $$;`)
    const r = await db.query<{ acl: string | null }>(
      `select proacl::text as acl from pg_proc where proname = 'funcao_futura'`,
    )
    assert.doesNotMatch(r.rows[0].acl ?? '', /(^|[{,])anon=/)
  })
  test('reexecutável (segunda aplicação não muda nada)', async () => {
    await db.exec(sql('20261026110000_revogar_anon_funcoes.sql'))
    for (const f of GRUPO1) assert.equal(await pode('anon', f), false)
  })
})

describe('M5: cardapio_registrar_tentativa', () => {
  before(async () => {
    await db.exec(`
      create table public.cardapio_pedidos_log (
        id bigint generated always as identity primary key,
        barraca_id uuid not null,
        ip_hash text not null,
        client_uuid text,
        criado_em timestamptz not null default now()
      );
    `)
    await db.exec(sql('20261026120000_limite_cardapio_atomico.sql'))
  })
  const chamar = async (b: string, ip: string, limIp = 3, limLoja = 5, janela = 300) =>
    (await db.query<{ r: string }>(
      `select public.cardapio_registrar_tentativa('${b}', '${ip}', 'c', ${limIp}, ${limLoja}, ${janela}) as r`,
    )).rows[0].r

  test('só service_role executa', async () => {
    assert.equal(await pode('anon', 'cardapio_registrar_tentativa'), false)
    assert.equal(await pode('authenticated', 'cardapio_registrar_tentativa'), false)
    assert.equal(await pode('service_role', 'cardapio_registrar_tentativa'), true)
  })
  test('teto por IP: aceita até o limite e recusa sem gravar', async () => {
    for (let i = 0; i < 3; i++) assert.equal(await chamar(B1, 'ipA'), 'ok')
    assert.equal(await chamar(B1, 'ipA'), 'limite_ip')
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.cardapio_pedidos_log where ip_hash = 'ipA'`)
    assert.equal(n.rows[0].n, 3)
  })
  test('teto por loja: IPs diferentes também param no limite da loja', async () => {
    // B1 já tem 3 de ipA; faltam 2 até 5.
    assert.equal(await chamar(B1, 'ipB'), 'ok')
    assert.equal(await chamar(B1, 'ipC'), 'ok')
    assert.equal(await chamar(B1, 'ipD'), 'limite_barraca')
    // Outra loja não é afetada.
    assert.equal(await chamar(B2, 'ipD'), 'ok')
  })
  test('janela: tentativas antigas não contam', async () => {
    await db.exec(`update public.cardapio_pedidos_log set criado_em = now() - interval '1 hour'`)
    assert.equal(await chamar(B1, 'ipA'), 'ok')
  })
  test('argumento inválido não grava', async () => {
    const antes = (await db.query<{ n: number }>('select count(*)::int as n from public.cardapio_pedidos_log')).rows[0].n
    assert.equal(await chamar(B1, '', 3, 5, 300), 'invalido')
    assert.equal(await chamar(B1, 'x', 0, 5, 300), 'invalido')
    assert.equal(await chamar(B1, 'x', 3, 5, 0), 'invalido')
    const depois = (await db.query<{ n: number }>('select count(*)::int as n from public.cardapio_pedidos_log')).rows[0].n
    assert.equal(depois, antes)
  })
})

describe('M7: limpar_logs_antigos', () => {
  before(async () => {
    await db.exec(`
      create table public.cliente_verificacoes_log (id bigint generated always as identity primary key, barraca_id uuid, telefone text, ip_hash text, criado_em timestamptz not null default now());
      create table public.cliente_codigos (id bigint generated always as identity primary key, barraca_id uuid, telefone text, criado_em timestamptz not null default now(), expira_em timestamptz not null, usado_em timestamptz);
      delete from public.cardapio_pedidos_log;
    `)
    await db.exec(sql('20261026130000_retencao_logs.sql'))
  })
  test('apaga o antigo e preserva o recente e o código ainda válido', async () => {
    await db.exec(`
      insert into public.cardapio_pedidos_log (barraca_id, ip_hash, criado_em) values
        ('${B1}', 'velho', now() - interval '3 days'), ('${B1}', 'novo', now() - interval '1 hour');
      insert into public.cliente_verificacoes_log (barraca_id, telefone, criado_em) values
        ('${B1}', '11999999999', now() - interval '3 days'), ('${B1}', '11999999999', now());
      insert into public.cliente_codigos (barraca_id, telefone, criado_em, expira_em, usado_em) values
        ('${B1}', '1', now() - interval '8 days', now() - interval '8 days' + interval '10 minutes', null),
        ('${B1}', '2', now() - interval '8 days', now() + interval '1 day', null),
        ('${B1}', '3', now() - interval '8 days', now() + interval '1 day', now() - interval '7 days'),
        ('${B1}', '4', now() - interval '1 hour', now() + interval '10 minutes', null);
    `)
    await db.exec('select public.limpar_logs_antigos()')
    const c = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n
    assert.equal(await c('cardapio_pedidos_log'), 1)
    assert.equal(await c('cliente_verificacoes_log'), 1)
    // sobram: 2 (velho mas ainda não vencido e não usado) e 4 (recente)
    const sobra = (await db.query<{ t: string }>('select telefone as t from public.cliente_codigos order by 1')).rows.map((r) => r.t)
    assert.deepEqual(sobra, ['2', '4'])
  })
  test('só o dono do job executa', async () => {
    assert.equal(await pode('anon', 'limpar_logs_antigos'), false)
    assert.equal(await pode('authenticated', 'limpar_logs_antigos'), false)
  })
})
