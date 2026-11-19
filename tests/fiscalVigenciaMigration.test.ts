// Vigência do módulo Fiscal pago (20261110110000 + 20261110120000), migrations reais no PGlite.
// Stubs (só o que as funções tocam): assinaturas, barracas, modulos_barraca, uma versão simplificada de
// modulos_definir_interno (mesmo contrato de retorno) e a regra de modulo_ativo (pago_ate + 7 dias, cortesia sempre).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')

const DONO = 'a1000000-0000-4000-8000-000000000001'
const OUTRO = 'a2000000-0000-4000-8000-000000000002'
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const CNPJ_A = '11222333000181'
const CNPJ_B = '11444777000161'

let db: PGlite
const um = async <T>(q: string) => (await db.query<T>(q)).rows[0]
const n = async (q: string) => (await um<{ n: number }>(`select count(*)::int as n from (${q}) x`)).n
const fiscal = (barraca: string, cnpj: string, status: string, campos = '', valores = '', usuario = DONO) =>
  db.query(`insert into public.fiscal_assinaturas (usuario_id, barraca_id, cnpj, status${campos ? ', ' + campos : ''})
    values ('${usuario}', '${barraca}', '${cnpj}', '${status}'${valores ? ', ' + valores : ''})`)
const modulo = (b: string) => um<{ estado: string; origem: string; pago_ate: string | null }>(
  `select estado, origem, pago_ate::text from public.modulos_barraca where barraca_id = '${b}' and modulo = 'fiscal'`)
const ativo = async (b: string) => (await um<{ r: boolean }>(`select public.modulo_ativo('${b}', 'fiscal') as r`)).r
const sincronizar = async (b: string, termo: string | null = 'termo-v1') =>
  (await um<{ r: string }>(`select public.fiscal_sincronizar_modulo('${b}', ${termo ? `'${termo}'` : 'null'}) as r`)).r

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.app_config (chave text primary key, valor jsonb not null, atualizado_em timestamptz not null default now());
    create table public.barracas (id uuid primary key, nome text, cnpj text, arquivada_em timestamptz);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create table public.superadmins (usuario_id uuid primary key);
    create table public.assinaturas (
      usuario_id uuid primary key, status text, stripe_subscription_id text, current_period_end timestamptz,
      bloqueada_admin boolean default false, origem_plano text default 'trial');
    create table public.eventos_webhook_stripe (
      id uuid primary key default gen_random_uuid(), stripe_event_id text unique, event text, subscription_id text,
      payload jsonb not null default '{}', error text, received_at timestamptz not null default now());
    create table public.modulos_barraca (barraca_id uuid, modulo text, estado text, origem text, teste_ate timestamptz,
      pago_ate timestamptz, ativado_em timestamptz, termo_versao text, termo_aceito_em timestamptz, primary key (barraca_id, modulo));
    -- stubs das tabelas que as funções de remoção apagam
    create table public.itens_do_pedido (id uuid, pedido_id uuid, barraca_id uuid);
    create table public.pedidos (id uuid, barraca_id uuid);
    create table public.itens (barraca_id uuid); create table public.categorias (barraca_id uuid);
    create table public.custos_diarios (barraca_id uuid); create table public.barracas_senha_admin (barraca_id uuid);
    create table public.pagamentos_pendentes (barraca_id uuid, pedido_id uuid);
    create table public.acessos_suporte (barraca_id uuid); create table public.modulos_eventos (barraca_id uuid);
    create table public.cupom_tentativas_log (barraca_id uuid);
    create table public.admin_acoes_log (admin_id uuid, acao text, alvo_tipo text, alvo_id uuid, detalhes jsonb);
    create function public.admin_registrar_acao(a text, b text, c uuid, d jsonb) returns void language sql as $$ select 1 $$;
    grant usage on schema public to authenticated, anon, service_role;

    -- Simplificação de modulos_definir_interno (20261103110000): mesma validação de pago_ate e de termo, mesmo retorno.
    create function public.modulos_definir_interno(p_barraca_id uuid, p_modulo text, p_estado text, p_origem text,
      p_teste_ate timestamptz, p_pago_ate timestamptz, p_termo_versao text) returns jsonb language plpgsql as $f$
    declare m public.modulos_barraca%rowtype;
    begin
      if p_estado = 'ativo' and p_origem = 'pago' and p_pago_ate is null then return jsonb_build_object('estado', 'invalido'); end if;
      select * into m from public.modulos_barraca where barraca_id = p_barraca_id and modulo = p_modulo;
      if p_estado in ('ativo', 'teste') and p_termo_versao is null and m.termo_versao is null then
        return jsonb_build_object('estado', 'termo_obrigatorio');
      end if;
      insert into public.modulos_barraca as t (barraca_id, modulo, estado, origem, teste_ate, pago_ate, termo_versao)
      values (p_barraca_id, p_modulo, p_estado, p_origem, p_teste_ate, p_pago_ate, p_termo_versao)
      on conflict (barraca_id, modulo) do update set estado = excluded.estado, origem = excluded.origem,
        teste_ate = excluded.teste_ate, pago_ate = excluded.pago_ate, termo_versao = coalesce(excluded.termo_versao, t.termo_versao);
      return jsonb_build_object('estado', 'ok');
    end $f$;
    -- Regra de modulo_ativo (20261103100000) para 'ativo': cortesia sempre; pago até pago_ate + 7 dias.
    create function public.modulo_ativo(p_barraca_id uuid, p_modulo text) returns boolean language sql stable as $f$
      select coalesce((select case m.estado when 'ativo' then m.origem = 'cortesia' or coalesce(now() <= m.pago_ate + interval '7 days', false) else false end
        from public.modulos_barraca m where m.barraca_id = p_barraca_id and m.modulo = p_modulo), false) $f$;
    insert into auth.users values ('${DONO}'), ('${OUTRO}');
    insert into public.barracas (id, nome, cnpj) values ('${B1}', 'A', '11.222.333/0001-81'), ('${B2}', 'B', '${CNPJ_B}');
    insert into public.usuarios_barracas values ('${DONO}', '${B1}', 'dono'), ('${DONO}', '${B2}', 'dono');
  `)
  await db.exec(sql('20261110110000_fiscal_assinaturas.sql'))
  await db.exec(sql('20261110120000_fiscal_vigencia.sql'))
})
after(async () => db.close())

beforeEach(async () => {
  await db.exec(`reset role; delete from public.fiscal_assinaturas; delete from public.modulos_barraca;
    delete from public.assinaturas; delete from public.eventos_webhook_stripe;
    update public.barracas set arquivada_em = null; delete from public.admin_acoes_log;`)
})

describe('canceled vigente continua ocupando o CNPJ e a barraca (trigger)', () => {
  test('canceled com período futuro bloqueia nova contratação (mesmo cnpj/outra barraca e mesma barraca/outro cnpj)', async () => {
    await fiscal(B1, CNPJ_A, 'canceled', 'current_period_end', `now() + interval '10 days'`)
    await assert.rejects(fiscal(B2, CNPJ_A, 'pendente', '', '', OUTRO), /fiscal_assinatura_viva|unique/)
    await assert.rejects(fiscal(B1, CNPJ_B, 'pendente'), /fiscal_assinatura_viva|unique/)
  })

  test('canceled com período vencido, ou expired, não bloqueia; canceled sem período também não', async () => {
    await fiscal(B1, CNPJ_A, 'canceled', 'current_period_end', `now() - interval '1 day'`)
    await fiscal(B1, CNPJ_A, 'canceled')
    await fiscal(B1, CNPJ_A, 'expired')
    await fiscal(B1, CNPJ_A, 'pendente')
    assert.equal(await n(`select 1 from public.fiscal_assinaturas`), 4)
  })

  test('a transição active -> canceled da própria linha passa; reativar canceled -> active também; o erro é unique_violation', async () => {
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '10 days'`)
    await db.exec(`update public.fiscal_assinaturas set status = 'canceled'`)
    await db.exec(`update public.fiscal_assinaturas set status = 'active'`)
    await db.exec(`update public.fiscal_assinaturas set status = 'canceled'`)
    await assert.rejects(fiscal(B1, CNPJ_A, 'pendente'), (e: { code?: string }) => e.code === '23505')
  })
})

describe('assinatura_base_paga_vigente', () => {
  const base = (campos: string) => db.exec(`delete from public.assinaturas; insert into public.assinaturas (usuario_id, ${campos.split('|')[0]}) values ('${DONO}', ${campos.split('|')[1]})`)
  const vale = async () => (await um<{ r: boolean }>(`select public.assinatura_base_paga_vigente('${DONO}') as r`)).r

  test('Stripe active com pagamento > 0 e período em dia vale; folga de 3 dias; passou disso, não', async () => {
    await base(`status, stripe_subscription_id, pago_em, current_period_end|'active', 'sub_1', now(), now() + interval '10 days'`)
    assert.equal(await vale(), true)
    await base(`status, stripe_subscription_id, pago_em, current_period_end|'active', 'sub_1', now(), now() - interval '2 days 23 hours'`)
    assert.equal(await vale(), true)
    await base(`status, stripe_subscription_id, pago_em, current_period_end|'active', 'sub_1', now(), now() - interval '3 days 1 hour'`)
    assert.equal(await vale(), false)
  })

  test('trial Stripe (active sem pagamento), past_due, canceled, expired, trialing e bloqueada NÃO valem', async () => {
    await base(`status, stripe_subscription_id, current_period_end|'active', 'sub_1', now() + interval '10 days'`)
    assert.equal(await vale(), false, 'trial no_payment_required: sem pago_em')
    for (const status of ['past_due', 'canceled', 'expired', 'trialing']) {
      await base(`status, stripe_subscription_id, pago_em, current_period_end|'${status}', 'sub_1', now(), now() + interval '10 days'`)
      assert.equal(await vale(), false, status)
    }
    await base(`status, stripe_subscription_id, pago_em, current_period_end, bloqueada_admin|'active', 'sub_1', now(), now() + interval '10 days', true`)
    assert.equal(await vale(), false)
  })

  test('legado (origem_plano legado, sem Stripe) active vale; legado fora de active e sem origem legado não', async () => {
    await base(`status, origem_plano|'active', 'legado'`)
    assert.equal(await vale(), true)
    await base(`status, origem_plano|'expired', 'legado'`)
    assert.equal(await vale(), false)
    await base(`status, origem_plano|'active', 'trial'`)
    assert.equal(await vale(), false)
  })

  test('backfill: pago_em vem do último invoice.paid com valor > 0 (fatura zero de trial não conta)', async () => {
    await db.exec(`insert into public.assinaturas (usuario_id, status, stripe_subscription_id) values ('${DONO}', 'active', 'sub_9');
      insert into public.eventos_webhook_stripe (stripe_event_id, event, subscription_id, payload)
      values ('e1', 'invoice.paid', 'sub_9', '{"data":{"object":{"amount_paid":0}}}'),
             ('e2', 'invoice.paid', 'sub_9', '{"data":{"object":{"amount_paid":4990}}}')`)
    // reaplica só o trecho do backfill
    const trecho = sql('20261110120000_fiscal_vigencia.sql').match(/update public\.assinaturas a[\s\S]*?pago_em is null;/)![0]
    await db.exec(trecho)
    assert.ok((await um<{ pago_em: string | null }>(`select pago_em::text from public.assinaturas`)).pago_em)
    await db.exec(`update public.assinaturas set pago_em = null; delete from public.eventos_webhook_stripe where stripe_event_id = 'e2'`)
    await db.exec(trecho)
    assert.equal((await um<{ pago_em: string | null }>(`select pago_em::text from public.assinaturas`)).pago_em, null)
  })
})

describe('fiscal_sincronizar_modulo: carência única e fonte da vigência', () => {
  test('active: liga o módulo (origem pago) com pago_ate = fim do período; termo ausente não liga', async () => {
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '20 days'`)
    assert.equal(await sincronizar(B1, null), 'termo_obrigatorio')
    assert.equal(await modulo(B1), undefined)
    assert.equal(await sincronizar(B1), 'ok')
    assert.equal((await modulo(B1)).origem, 'pago')
    assert.equal(await ativo(B1), true)
  })

  test('past_due: o acesso termina em grace_until (3 dias), nem antes nem depois (limites de 1 hora)', async () => {
    await fiscal(B1, CNPJ_A, 'past_due', 'current_period_end, grace_until', `now() - interval '1 day', now() + interval '1 hour'`)
    await sincronizar(B1)
    assert.equal(await ativo(B1), true, '1 h antes do fim da carência')
    await db.exec(`update public.fiscal_assinaturas set grace_until = now() - interval '1 hour'`)
    await sincronizar(B1)
    assert.equal(await ativo(B1), false, '1 h depois do fim da carência')
  })

  test('canceled: acesso até o fim do período pago, sem os 7 dias extras de modulo_ativo', async () => {
    await fiscal(B1, CNPJ_A, 'canceled', 'current_period_end', `now() + interval '1 hour'`)
    await sincronizar(B1)
    assert.equal(await ativo(B1), true)
    await db.exec(`update public.fiscal_assinaturas set current_period_end = now() - interval '1 hour'`)
    assert.equal(await sincronizar(B1), 'ok') // nada vigente: desliga o módulo da cobrança
    assert.equal(await ativo(B1), false)
    assert.equal((await modulo(B1)).estado, 'cancelado')
  })

  test('renovação pelo estado final: deleted mais novo nunca é desfeito por sincronização atrasada', async () => {
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '20 days'`)
    await sincronizar(B1)
    await db.exec(`update public.fiscal_assinaturas set status = 'expired'`) // deleted aplicado
    await sincronizar(B1)
    assert.equal(await ativo(B1), false)
    await sincronizar(B1) // pagamento atrasado chama a sincronização depois: a linha continua expired
    assert.equal(await ativo(B1), false)
  })

  test('uma assinatura antiga encerrando NÃO desliga o módulo se outra é a fonte da vigência', async () => {
    await fiscal(B1, CNPJ_A, 'expired', 'current_period_end', `now() - interval '40 days'`)
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '20 days'`)
    await sincronizar(B1)
    await db.exec(`update public.fiscal_assinaturas set status = 'expired' where current_period_end < now()`)
    await sincronizar(B1)
    assert.equal(await ativo(B1), true)
  })

  test('cortesia do admin nunca é desligada; sem nada vigente e sem módulo: sem_alteracao', async () => {
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem, termo_versao) values ('${B1}', 'fiscal', 'ativo', 'cortesia', 't')`)
    await fiscal(B1, CNPJ_A, 'expired')
    assert.equal(await sincronizar(B1), 'sem_alteracao')
    assert.equal(await ativo(B1), true)
    assert.equal(await sincronizar(B2), 'sem_alteracao')
  })
})

describe('fiscal_emissao_bloqueio', () => {
  const emissao = async (b: string) => (await um<{ r: string | null }>(`select public.fiscal_emissao_bloqueio('${b}') as r`)).r
  const pago = async () => {
    await db.exec(`insert into public.assinaturas (usuario_id, status, stripe_subscription_id, pago_em, current_period_end)
      values ('${DONO}', 'active', 'sub_1', now(), now() + interval '20 days') on conflict (usuario_id) do nothing`)
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '20 days'`)
    await sincronizar(B1)
  }

  test('módulo pago com base em dia e CNPJ igual (mesmo formatado na barraca): pode emitir', async () => {
    await pago()
    assert.equal(await emissao(B1), null)
  })

  test('base perdeu a vigência ou foi bloqueada: base_sem_vigencia', async () => {
    await pago()
    await db.exec(`update public.assinaturas set status = 'past_due'`)
    assert.equal(await emissao(B1), 'base_sem_vigencia')
    await db.exec(`update public.assinaturas set status = 'active', bloqueada_admin = true`)
    assert.equal(await emissao(B1), 'base_sem_vigencia')
  })

  test('troca de CNPJ com assinatura viva: cnpj_divergente; voltar ao CNPJ contratado libera', async () => {
    await pago()
    await db.exec(`update public.barracas set cnpj = '${CNPJ_B}' where id = '${B1}'`)
    assert.equal(await emissao(B1), 'cnpj_divergente')
    await db.exec(`update public.barracas set cnpj = '11.222.333/0001-81' where id = '${B1}'`)
    assert.equal(await emissao(B1), null)
  })

  test('cortesia e teste do admin, e pago lançado à mão sem cobrança, NÃO são conferidos', async () => {
    await db.exec(`insert into public.modulos_barraca (barraca_id, modulo, estado, origem, termo_versao) values ('${B1}', 'fiscal', 'ativo', 'cortesia', 't')`)
    assert.equal(await emissao(B1), null)
    await db.exec(`update public.modulos_barraca set origem = 'pago', pago_ate = now() + interval '5 days'`)
    assert.equal(await emissao(B1), null, 'sem linha em fiscal_assinaturas')
    assert.equal(await emissao(B2), null, 'sem módulo')
  })

  test('as funções são só do service_role (cliente não chama)', async () => {
    await db.exec(`reset role; set role authenticated`)
    await assert.rejects(db.query(`select public.fiscal_emissao_bloqueio('${B1}')`), /permission denied/)
    await assert.rejects(db.query(`select public.fiscal_sincronizar_modulo('${B1}', 'x')`), /permission denied/)
    await assert.rejects(db.query(`select public.assinatura_base_paga_vigente('${DONO}')`), /permission denied/)
    await db.exec('reset role')
  })
})

describe('remoção bloqueada com cobrança fiscal ocupando a barraca', () => {
  const comoDono = (uid: string) => db.exec(`reset role; select set_config('test.uid', '${uid}', false)`)

  test('apagar_barraca recusa com pendente, active, past_due e canceled vigente; libera com expired e canceled vencida', async () => {
    await comoDono(DONO)
    for (const [status, extra] of [['pendente', ''], ['active', ''], ['past_due', ''], ['canceled', `current_period_end => now() + interval '3 days'`]] as const) {
      await db.exec(`delete from public.fiscal_assinaturas`)
      if (extra) await fiscal(B2, CNPJ_B, status, 'current_period_end', `now() + interval '3 days'`)
      else await fiscal(B2, CNPJ_B, status)
      await assert.rejects(db.query(`select public.apagar_barraca('${B2}')`), /módulo Fiscal contratado/, status)
    }
    await db.exec(`delete from public.fiscal_assinaturas`)
    await fiscal(B2, CNPJ_B, 'canceled', 'current_period_end', `now() - interval '1 day'`)
    await db.query(`select public.apagar_barraca('${B2}')`)
    assert.equal(await n(`select 1 from public.barracas where id = '${B2}'`), 0)
    await db.exec(`insert into public.barracas (id, nome, cnpj) values ('${B2}', 'B', '${CNPJ_B}'); insert into public.usuarios_barracas values ('${DONO}', '${B2}', 'dono')`)
  })

  test('admin_arquivar_barraca recusa com cobrança fiscal; barracas_para_apagar e apagar_dados_barraca respeitam', async () => {
    await db.exec(`reset role; insert into public.superadmins values ('${DONO}') on conflict do nothing; select set_config('test.uid', '${DONO}', false)`)
    await fiscal(B1, CNPJ_A, 'active', 'current_period_end', `now() + interval '10 days'`)
    await assert.rejects(db.query(`select public.admin_arquivar_barraca('${B1}', 'A')`), /Fiscal vigente/)
    await db.exec(`update public.fiscal_assinaturas set status = 'expired'`)
    await db.query(`select public.admin_arquivar_barraca('${B1}', 'A')`)
    assert.ok((await um<{ a: string | null }>(`select arquivada_em::text as a from public.barracas where id = '${B1}'`)).a)

    await db.exec(`update public.barracas set arquivada_em = now() - interval '31 days' where id = '${B1}'`)
    assert.equal(await n(`select 1 from public.barracas_para_apagar()`), 1)
    await db.exec(`update public.fiscal_assinaturas set status = 'active', current_period_end = now() + interval '10 days'`)
    assert.equal(await n(`select 1 from public.barracas_para_apagar()`), 0)
    await assert.rejects(db.query(`select public.apagar_dados_barraca('${B1}')`), /não pode ser apagada/)
    await db.exec(`update public.fiscal_assinaturas set status = 'expired'`)
    await db.query(`select public.apagar_dados_barraca('${B1}')`)
    assert.equal(await n(`select 1 from public.barracas where id = '${B1}'`), 0)
  })
})
