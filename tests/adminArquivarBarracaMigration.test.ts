// Painel do superadmin, arquivar / restaurar / apagar barraca: migrations reais no PGlite.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const ADMIN = 'a0000000-0000-4000-8000-000000000000'
const DONO = 'a2000000-0000-4000-8000-000000000002'
const FUNC = 'a9000000-0000-4000-8000-000000000009'
const BARRACA = 'b2000000-0000-4000-8000-000000000002' // será arquivada
const OUTRA = 'b3000000-0000-4000-8000-000000000003' // do mesmo dono, nunca tocada
const VELHA = 'b4000000-0000-4000-8000-000000000004' // arquivada há mais de 30 dias
const ITEM = 'c1000000-0000-4000-8000-000000000001'
const ITEM_OUTRA = 'c2000000-0000-4000-8000-000000000002'
const ITEM_VELHA = 'c3000000-0000-4000-8000-000000000003'
const PEDIDO_VELHA = 'd3000000-0000-4000-8000-000000000003'
const PEDIDO_OUTRA = 'd2000000-0000-4000-8000-000000000002'

let db: PGlite

async function como(uid: string | null, papel: 'authenticated' | 'anon' | 'service_role' = 'authenticated') {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false); set role ${papel}`)
}
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const acesso = async (uid: string, barraca: string) => {
  await como(uid)
  const r = await um<{ v: boolean }>(`select public.usuario_tem_acesso_barraca('${barraca}') as v`)
  await db.exec('reset role')
  return r.v
}
const logs = async (acao: string) =>
  (await um<{ n: number }>(`select count(*)::int as n from public.admin_acoes_log where acao = '${acao}'`)).n
const conta = async (tabela: string, barraca: string) =>
  (await um<{ n: number }>(`select count(*)::int as n from public.${tabela} where barraca_id = '${barraca}'`)).n
const erro = (code: string, msg: RegExp) => (e: unknown) =>
  (e as { code?: string }).code === code && msg.test((e as Error).message)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon, service_role;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.app_config (chave text primary key, valor jsonb not null);
    create table public.barracas (
      id uuid primary key default gen_random_uuid(), nome text, slug text, criada_em timestamptz default now(),
      logo_url text, imagem_capa_url text, pagamento_online_habilitado boolean default false,
      modos_atendimento text[], pagar_na_entrega_habilitado boolean default false, whatsapp_pedidos text,
      opcoes_habilitado boolean default false, slug_trocado_em timestamptz, kit_aplicado_em timestamptz,
      kit_elegivel boolean not null default true, checklist_oculto_ate timestamptz,
      avaliacao_ativa boolean, avaliacao_texto text
    );
    create table public.custos_diarios (barraca_id uuid references public.barracas(id) on delete cascade);
    create table public.barracas_senha_admin (barraca_id uuid references public.barracas(id) on delete cascade);
    create table public.grupos_opcoes (barraca_id uuid references public.barracas(id) on delete cascade);
    -- pgcrypto fica em "extensions" no Supabase; o PGlite não a traz (mesmo stub de acessoSuporteMigration).
    create schema extensions;
    create function extensions.digest(data text, algo text) returns bytea language sql immutable
      as $$ select decode(md5(data), 'hex') $$;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile
      as $$ select substring(decode(md5(random()::text || clock_timestamp()::text), 'hex') from 1 for n) $$;
    create function public.modulo_ativo(p_barraca_id uuid, p_modulo text) returns boolean language sql stable as $$ select false $$;
    create table public.usuarios_barracas (
      usuario_id uuid, barraca_id uuid references public.barracas(id) on delete cascade, papel text);
    create table public.assinaturas (
      usuario_id uuid primary key, status text not null, plan text, cycle text, trial_ends_at timestamptz,
      current_period_end timestamptz, grace_until timestamptz, stripe_subscription_id text,
      updated_at timestamptz not null default now()
    );
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), event text, subscription_id text, error text,
      received_at timestamptz not null default now()
    );
    create table public.categorias (
      id uuid primary key default gen_random_uuid(), barraca_id uuid not null references public.barracas(id) on delete cascade,
      nome text, ordem int);
    create table public.itens (
      id uuid primary key default gen_random_uuid(), barraca_id uuid not null references public.barracas(id) on delete cascade,
      categoria_id uuid references public.categorias(id), nome text, descricao text, foto_url text,
      preco_centavos int, esgotado boolean default false, popular boolean default false, ativo boolean default true,
      preco_aberto boolean not null default false, ordem int);
    create table public.pedidos (
      id uuid primary key default gen_random_uuid(), barraca_id uuid not null references public.barracas(id) on delete cascade,
      status text default 'a_fazer', criado_em timestamptz default now());
    -- FKs sem cascade, como em produção: exigem delete explícito antes da barraca.
    create table public.itens_do_pedido (
      id uuid primary key default gen_random_uuid(), pedido_id uuid references public.pedidos(id) on delete cascade,
      barraca_id uuid references public.barracas(id), item_id uuid, quantidade int, removido boolean default false);
    create table public.pagamentos_pendentes (
      id uuid primary key default gen_random_uuid(), barraca_id uuid references public.barracas(id),
      pedido_id uuid references public.pedidos(id));
    create table public.codigos_suporte (
      id uuid primary key default gen_random_uuid(), barraca_id uuid references public.barracas(id) on delete cascade,
      codigo_hash text, expira_em timestamptz, criado_por uuid);
    create table public.acessos_suporte (
      id uuid primary key default gen_random_uuid(), barraca_id uuid references public.barracas(id) on delete cascade,
      codigo_id uuid references public.codigos_suporte(id));
    create table public.modulos_barraca (
      barraca_id uuid not null references public.barracas(id) on delete cascade, modulo text not null);
    -- Sem FK em produção: precisam de delete explícito.
    create table public.modulos_eventos (id bigint generated always as identity primary key, barraca_id uuid not null, modulo text);
    create table public.cupom_tentativas_log (id bigint generated always as identity primary key, barraca_id uuid);

    create function public.cobranca_ativa() returns boolean language sql stable as $$ select true $$;
    -- corpo vigente em produção (pg_get_functiondef, 2026-11-05)
    create function public.usuario_tem_acesso_barraca(p_barraca_id uuid) returns boolean
      language sql stable security definer set search_path = public, pg_temp as $$
      select exists (select 1 from usuarios_barracas where usuario_id = auth.uid() and barraca_id = p_barraca_id) $$;
    create function public.assinatura_tem_acesso(p_assinatura public.assinaturas, p_now timestamptz default now()) returns boolean
      language sql stable as $$ select true $$;
    create function public.barraca_assinatura_ativa(p_barraca_id uuid) returns boolean language sql stable as $$ select true $$;
    create function public.assinatura_da_barraca(p_slug text)
      returns table(status text, plano text, ciclo text, tem_acesso boolean, dias_restantes_trial integer,
        trial_ends_at timestamptz, current_period_end timestamptz, eh_dono boolean, cobranca_ativa boolean)
      language sql stable as $$ select null::text, null::text, null::text, true, null::integer, null::timestamptz, null::timestamptz, false, true $$;
    grant usage on schema public to authenticated, anon, service_role;

    insert into auth.users values ('${ADMIN}', 'admin@x.com'), ('${DONO}', 'dono@x.com'), ('${FUNC}', 'func@x.com');
    insert into public.barracas (id, nome, slug) values
      ('${BARRACA}', 'Barraca do Zé', 'ze'), ('${OUTRA}', 'Outra', 'outra'), ('${VELHA}', 'Velha', 'velha');
    insert into public.usuarios_barracas values
      ('${DONO}', '${BARRACA}', 'dono'), ('${FUNC}', '${BARRACA}', 'funcionario'),
      ('${DONO}', '${OUTRA}', 'dono'), ('${DONO}', '${VELHA}', 'dono');
    insert into public.itens (id, barraca_id, nome, preco_centavos, ordem) values
      ('${ITEM}', '${BARRACA}', 'Pastel', 800, 1), ('${ITEM_OUTRA}', '${OUTRA}', 'Coxinha', 600, 1),
      ('${ITEM_VELHA}', '${VELHA}', 'Caldo', 900, 1);
    insert into public.categorias (barraca_id, nome, ordem) values ('${VELHA}', 'Bebidas', 1), ('${OUTRA}', 'Lanches', 1);
    insert into public.pedidos (id, barraca_id) values ('${PEDIDO_VELHA}', '${VELHA}'), ('${PEDIDO_OUTRA}', '${OUTRA}');
    insert into public.itens_do_pedido (pedido_id, barraca_id, item_id, quantidade) values
      ('${PEDIDO_VELHA}', '${VELHA}', '${ITEM_VELHA}', 1), ('${PEDIDO_OUTRA}', '${OUTRA}', '${ITEM_OUTRA}', 1);
    insert into public.pagamentos_pendentes (barraca_id, pedido_id) values ('${VELHA}', '${PEDIDO_VELHA}'), ('${OUTRA}', '${PEDIDO_OUTRA}');
    insert into public.codigos_suporte (id, barraca_id) values ('e3000000-0000-4000-8000-000000000003', '${VELHA}');
    insert into public.acessos_suporte (barraca_id, codigo_id) values ('${VELHA}', 'e3000000-0000-4000-8000-000000000003');
    insert into public.modulos_barraca values ('${VELHA}', 'fiscal'), ('${OUTRA}', 'fiscal');
    insert into public.modulos_eventos (barraca_id, modulo) values ('${VELHA}', 'fiscal'), ('${OUTRA}', 'fiscal');
    insert into public.cupom_tentativas_log (barraca_id) values ('${VELHA}'), ('${OUTRA}');
  `)
  await db.exec(sql('20261028100000_admin_planos_prazos.sql'))
  await db.exec(sql('20261108100000_admin_bloqueio_conta.sql'))
  await db.exec(sql('20261108120000_admin_arquivar_barraca.sql'))
  await db.exec(`insert into public.superadmins (usuario_id) values ('${ADMIN}')`)
  // VELHA: arquivada há 31 dias (direto, sem passar pela RPC).
  await db.exec(`update public.barracas set arquivada_em = now() - interval '31 days' where id = '${VELHA}'`)
})

after(async () => {
  await db.close()
})

describe('arquivar barraca', () => {
  test('arquivar exige superadmin', async () => {
    await como(DONO)
    await assert.rejects(db.query(`select public.admin_arquivar_barraca('${BARRACA}', 'Barraca do Zé')`), erro('42501', /acesso negado/))
    await como(null, 'anon')
    await assert.rejects(db.query(`select public.admin_arquivar_barraca('${BARRACA}', 'Barraca do Zé')`), /permission denied/)
  })

  test('arquivar exige o nome exato', async () => {
    await como(ADMIN)
    for (const nome of ['barraca do zé', 'Barraca do Ze', 'Barraca', '', null]) {
      await assert.rejects(
        db.query(`select public.admin_arquivar_barraca('${BARRACA}', $1)`, [nome]),
        erro('22023', /nome/),
      )
    }
    await db.exec('reset role')
    assert.equal((await um<{ a: string | null }>(`select arquivada_em as a from public.barracas where id = '${BARRACA}'`)).a, null)
    assert.equal(await logs('arquivar_barraca'), 0)
    // espaços nas pontas são tolerados
    await como(ADMIN)
    await db.query(`select public.admin_arquivar_barraca('${BARRACA}', '  Barraca do Zé ')`)
    await db.exec('reset role')
    assert.ok((await um<{ a: string | null }>(`select arquivada_em as a from public.barracas where id = '${BARRACA}'`)).a)
    assert.equal(await logs('arquivar_barraca'), 1)
  })

  test('arquivar de novo não dá erro nem duplica o log', async () => {
    await como(ADMIN)
    await db.query(`select public.admin_arquivar_barraca('${BARRACA}', 'Barraca do Zé')`)
    await db.exec('reset role')
    assert.equal(await logs('arquivar_barraca'), 1)
  })

  test('arquivada perde acesso para dono e funcionário', async () => {
    assert.equal(await acesso(DONO, BARRACA), false)
    assert.equal(await acesso(FUNC, BARRACA), false)
  })

  test('dono mantém acesso à outra barraca', async () => {
    assert.equal(await acesso(DONO, OUTRA), true)
  })

  test('cardapio_publico não encontra arquivada', async () => {
    await como(null, 'anon')
    assert.equal((await db.query(`select * from public.cardapio_publico('ze')`)).rows.length, 0)
    assert.equal((await db.query(`select * from public.cardapio_publico('outra')`)).rows.length, 1)
    await db.exec('reset role')
  })

  test('resolver_carrinho recusa barraca arquivada', async () => {
    const linhas = `'[{"item_id":"x","quantidade":1}]'::jsonb`
    const r = await um<{ r: { erros: { codigo: string }[] } }>(`select public.resolver_carrinho('${BARRACA}', ${linhas}) as r`)
    assert.equal(r.r.erros[0].codigo, 'barraca_invalida')
    const r2 = await um<{ r: { erros: { codigo: string }[] } }>(`select public.resolver_carrinho('${OUTRA}', ${linhas}) as r`)
    assert.equal(r2.r.erros[0].codigo, 'item_invalido')
  })

  // RPCs de escrita do dono que não passam por usuario_tem_acesso_barraca: arquivada é recusada com a resposta
  // de "sem acesso"; na OUTRA (não arquivada) a mesma chamada passa da checagem de acesso.
  const doDono = async <T>(q: string) => {
    await como(DONO)
    try {
      return (await db.query<{ r: T }>(`select ${q} as r`)).rows[0].r
    } finally {
      await db.exec('reset role')
    }
  }
  const recusaDono = async (q: string, msg: RegExp) => {
    await como(DONO)
    try {
      await assert.rejects(db.query(`select ${q}`), msg)
    } finally {
      await db.exec('reset role')
    }
  }

  test('suporte_gerar_codigo recusa arquivada', async () => {
    assert.equal((await doDono<{ estado: string }>(`public.suporte_gerar_codigo('${BARRACA}')`)).estado, 'sem_acesso')
    assert.equal(await conta('codigos_suporte', BARRACA), 0)
    assert.equal((await doDono<{ estado: string }>(`public.suporte_gerar_codigo('${OUTRA}')`)).estado, 'ok')
    await db.exec(`delete from public.codigos_suporte where barraca_id = '${OUTRA}'`)
  })

  test('barraca_trocar_slug recusa arquivada', async () => {
    assert.equal((await doDono<{ estado: string }>(`public.barraca_trocar_slug('${BARRACA}', 'ze')`)).estado, 'sem_acesso')
    assert.equal((await doDono<{ estado: string }>(`public.barraca_trocar_slug('${OUTRA}', 'outra')`)).estado, 'ok')
  })

  test('onboarding_aplicar_kit recusa arquivada', async () => {
    assert.equal((await doDono<{ estado: string }>(`public.onboarding_aplicar_kit('${BARRACA}', 'feira', '{}')`)).estado, 'sem_acesso')
    // OUTRA já tem itens: passa do acesso e para na regra seguinte
    assert.equal((await doDono<{ estado: string }>(`public.onboarding_aplicar_kit('${OUTRA}', 'feira', '{}')`)).estado, 'catalogo_nao_vazio')
  })

  test('onboarding_salvar_passo recusa arquivada', async () => {
    await recusaDono(`public.onboarding_salvar_passo('${BARRACA}', 99, '{}')`, /sem acesso a esta barraca/)
    await recusaDono(`public.onboarding_salvar_passo('${OUTRA}', 99, '{}')`, /etapa_invalida/)
  })

  test('onboarding_ocultar_checklist recusa arquivada', async () => {
    await recusaDono(`public.onboarding_ocultar_checklist('${BARRACA}')`, /sem acesso a esta barraca/)
    await doDono(`public.onboarding_ocultar_checklist('${OUTRA}')`)
    assert.ok((await um<{ c: string | null }>(`select checklist_oculto_ate as c from public.barracas where id = '${OUTRA}'`)).c)
  })

  test('whatsapp_avaliacao_salvar recusa arquivada', async () => {
    assert.equal((await doDono<{ estado: string }>(`public.whatsapp_avaliacao_salvar('${BARRACA}', true, null)`)).estado, 'sem_acesso')
    // OUTRA passa do acesso e para no módulo (stub desligado)
    assert.equal((await doDono<{ estado: string }>(`public.whatsapp_avaliacao_salvar('${OUTRA}', true, null)`)).estado, 'modulo_desligado')
  })

  test('apagar_barraca recusa arquivada', async () => {
    const DESCARTE = 'b5000000-0000-4000-8000-000000000005'
    await db.exec(`insert into public.barracas (id, nome, slug) values ('${DESCARTE}', 'Descarte', 'descarte');
      insert into public.usuarios_barracas values ('${DONO}', '${DESCARTE}', 'dono')`)
    await recusaDono(`public.apagar_barraca('${BARRACA}')`, /Só o dono da barraca pode apagá-la/)
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.barracas where id = '${BARRACA}'`)).n, 1)
    await doDono(`public.apagar_barraca('${DESCARTE}')`)
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.barracas where id = '${DESCARTE}'`)).n, 0)
  })

  test('restaurar dentro de 30 dias devolve o acesso', async () => {
    await db.exec(`update public.barracas set arquivada_em = now() - interval '29 days' where id = '${BARRACA}'`)
    await como(ADMIN)
    await db.query(`select public.admin_restaurar_barraca('${BARRACA}')`)
    await db.query(`select public.admin_restaurar_barraca('${BARRACA}')`) // idempotente
    await db.exec('reset role')
    assert.equal(await logs('restaurar_barraca'), 1)
    assert.equal(await acesso(DONO, BARRACA), true)
    assert.equal(await acesso(FUNC, BARRACA), true)
    await como(null, 'anon')
    assert.equal((await db.query(`select * from public.cardapio_publico('ze')`)).rows.length, 1)
    await db.exec('reset role')
  })

  test('restaurar após 30 dias é recusado', async () => {
    await como(ADMIN)
    await assert.rejects(db.query(`select public.admin_restaurar_barraca('${VELHA}')`), erro('22023', /30 dias/))
    await como(DONO)
    await assert.rejects(db.query(`select public.admin_restaurar_barraca('${BARRACA}')`), erro('42501', /acesso negado/))
    await db.exec('reset role')
    assert.equal(await logs('restaurar_barraca'), 1)
  })
})

describe('apagar barraca arquivada', () => {
  test('funções de apagar só para service_role', async () => {
    for (const papel of ['authenticated', 'anon'] as const) {
      await como(ADMIN, papel)
      await assert.rejects(db.query('select * from public.barracas_para_apagar()'), /permission denied/)
      await assert.rejects(db.query(`select public.apagar_dados_barraca('${VELHA}')`), /permission denied/)
      await assert.rejects(db.query('select public.disparar_worker_apagar_barracas()'), /permission denied/)
    }
    await como(null, 'service_role')
    const r = (await db.query<{ barraca_id: string }>('select * from public.barracas_para_apagar()')).rows
    assert.deepEqual(r.map((l) => l.barraca_id), [VELHA])
    await db.exec('reset role')
  })

  test('apagar_dados_barraca antes de 30 dias é recusado', async () => {
    await db.exec(`update public.barracas set arquivada_em = now() - interval '29 days' where id = '${OUTRA}'`)
    await como(null, 'service_role')
    await assert.rejects(db.query(`select public.apagar_dados_barraca('${OUTRA}')`), erro('22023', /30 dias/))
    await assert.rejects(db.query(`select public.apagar_dados_barraca('${BARRACA}')`), erro('22023', /30 dias/)) // não arquivada
    await db.exec(`reset role; update public.barracas set arquivada_em = null where id = '${OUTRA}'`)
    assert.equal(await conta('itens', OUTRA), 1)
  })

  test('apagar_dados_barraca depois de 30 dias remove barraca e filhos', async () => {
    await como(null, 'service_role')
    await db.query(`select public.apagar_dados_barraca('${VELHA}')`)
    await db.exec('reset role')
    assert.equal((await um<{ n: number }>(`select count(*)::int as n from public.barracas where id = '${VELHA}'`)).n, 0)
    for (const t of ['itens', 'categorias', 'pedidos', 'itens_do_pedido', 'pagamentos_pendentes', 'usuarios_barracas',
      'acessos_suporte', 'codigos_suporte', 'modulos_barraca', 'modulos_eventos', 'cupom_tentativas_log']) {
      assert.equal(await conta(t, VELHA), 0, t)
    }
    // a outra barraca do mesmo dono fica intacta
    for (const t of ['itens', 'categorias', 'pedidos', 'itens_do_pedido', 'pagamentos_pendentes', 'modulos_barraca',
      'modulos_eventos', 'cupom_tentativas_log']) {
      assert.equal(await conta(t, OUTRA), 1, t)
    }
    assert.equal(await acesso(DONO, OUTRA), true)
  })

  test('apagar_dados_barraca grava o log do sistema e admin_listar_acoes o lista com admin nulo', async () => {
    assert.equal(await logs('apagar_barraca_definitivo'), 1)
    const l = await um<{ admin_id: string | null; alvo_id: string; nome: string }>(
      `select admin_id, alvo_id, detalhes->>'nome' as nome from public.admin_acoes_log where acao = 'apagar_barraca_definitivo'`)
    assert.equal(l.admin_id, null)
    assert.equal(l.alvo_id, VELHA)
    assert.ok(l.nome)
    await como(ADMIN)
    const r = (await db.query<{ admin_email: string | null; acao: string }>(
      `select admin_email, acao from public.admin_listar_acoes(200, 0) where acao = 'apagar_barraca_definitivo'`)).rows
    await db.exec('reset role')
    assert.equal(r.length, 1)
    assert.equal(r[0].admin_email, null)
  })

  test('disparar_worker_apagar_barracas sem app_config não faz nada', async () => {
    await db.exec('reset role')
    await db.query('select public.disparar_worker_apagar_barracas()')
  })
})
