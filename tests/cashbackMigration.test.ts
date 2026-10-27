// Cashback: confere as migrations M1 a M6 por texto (e as fórmulas no PGlite, na seção M3).
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ler = (nome: string) => readFileSync(new URL(`../supabase/migrations/${nome}`, import.meta.url), 'utf8')

const m1 = ler('20261106100000_cashback_config.sql')

describe('M1 cashback_config', () => {
  test('cinco colunas novas com os defaults e os checks da spec', () => {
    assert.match(m1, /add column if not exists cashback_habilitado boolean not null default false/)
    assert.match(m1, /add column if not exists cashback_percentual_bp integer not null default 500/)
    assert.match(m1, /add column if not exists cashback_validade_dias integer not null default 60/)
    assert.match(m1, /add column if not exists cashback_teto_uso_pct integer not null default 50/)
    assert.match(m1, /add column if not exists cashback_termo_aceito_em timestamptz\s*;/)
    assert.match(m1, /check \(cashback_percentual_bp between 100 and 1500\)/)
    assert.match(m1, /check \(cashback_validade_dias between 30 and 90\)/)
    assert.match(m1, /check \(cashback_teto_uso_pct between 10 and 90\)/)
  })

  test('não liga sem o termo aceito', () => {
    assert.match(m1, /check \(not cashback_habilitado or cashback_termo_aceito_em is not null\)/)
  })

  test('constraints são recriadas com drop constraint if exists (reaplicável)', () => {
    const drops = m1.match(/drop constraint if exists barracas_cashback_/g) ?? []
    assert.equal(drops.length, 4)
  })

  test('cashback_config: security definer, search_path fixo, grant para anon, só os quatro campos', () => {
    assert.match(m1, /create or replace function public\.cashback_config\(p_slug text\)/)
    assert.match(m1, /returns table \(habilitado boolean, percentual_bp integer, teto_uso_pct integer, validade_dias integer\)/)
    assert.match(m1, /security definer\s+set search_path = public, pg_temp/)
    assert.match(m1, /grant execute on function public\.cashback_config\(text\) to anon, authenticated/)
    assert.doesNotMatch(m1, /cashback_termo_aceito_em\s+from/)
  })

  test('SUPOSIÇÃO-CASHBACK-2 e -3 anotadas nos defaults', () => {
    assert.match(m1, /SUPOSIÇÃO-CASHBACK-2/)
    assert.match(m1, /SUPOSIÇÃO-CASHBACK-3/)
  })
})

const m2 = ler('20261106110000_cashback_razao.sql')

describe('M2 razão', () => {
  test('cashback_lancamentos: tipos, sinal e motivo do ajuste', () => {
    assert.match(m2, /create table if not exists public\.cashback_lancamentos/)
    assert.match(m2, /tipo in \('credito', 'resgate', 'estorno_credito', 'estorno_resgate', 'expiracao', 'ajuste'\)/)
    assert.match(m2, /valor_centavos integer not null check \(valor_centavos <> 0\)/)
    assert.match(m2, /tipo in \('credito', 'estorno_resgate'\) and valor_centavos > 0/)
    assert.match(m2, /tipo in \('resgate', 'estorno_credito', 'expiracao'\) and valor_centavos < 0/)
    assert.match(m2, /tipo <> 'ajuste' or motivo is not null/)
    assert.match(m2, /cliente_id uuid references public\.clientes_finais\(id\) on delete set null/)
    assert.match(m2, /barraca_id uuid not null references public\.barracas\(id\) on delete cascade/)
  })

  test('os quatro índices de idempotência e consulta', () => {
    assert.match(m2, /unique index if not exists \w+\s+on public\.cashback_lancamentos \(pedido_id\) where tipo = 'credito'/)
    assert.match(m2, /unique index if not exists \w+\s+on public\.cashback_lancamentos \(pagamento_pendente_id\) where tipo = 'resgate'/)
    assert.match(m2, /\(pedido_id, tipo\) where tipo in \('estorno_credito', 'estorno_resgate'\)/)
    assert.match(m2, /\(barraca_id, cliente_id, criado_em desc\)/)
  })

  test('cashback_resgates: estado, valor, excedente e uma linha por cobrança', () => {
    assert.match(m2, /pagamento_pendente_id uuid not null unique references public\.pagamentos_pendentes\(id\) on delete cascade/)
    assert.match(m2, /estado in \('reservado', 'confirmado', 'liberado'\)/)
    assert.match(m2, /valor_centavos integer not null check \(valor_centavos > 0\)/)
    assert.match(m2, /excedente_centavos integer not null default 0 check \(excedente_centavos >= 0\)/)
    assert.match(m2, /reservado_ate timestamptz not null/)
  })

  test('RLS: nenhuma escrita direta para authenticated/anon', () => {
    for (const t of ['cashback_lancamentos', 'cashback_resgates']) {
      assert.match(m2, new RegExp(`alter table public\\.${t} enable row level security`), t)
      assert.match(m2, new RegExp(`revoke all on table public\\.${t} from anon, authenticated`), t)
    }
    const policies = m2.match(/create policy/gi) ?? []
    assert.equal(policies.length, 1)
    assert.match(m2, /create policy \w+ on public\.cashback_lancamentos for select to authenticated\s+using \(public\.usuario_tem_acesso_barraca\(barraca_id\)\)/)
    assert.doesNotMatch(m2, /for (insert|update|delete|all)/i)
    assert.match(m2, /grant select on table public\.cashback_lancamentos to authenticated/)
    assert.doesNotMatch(m2, /grant (insert|update|delete|all)/i)
  })

  test('colunas novas em pagamentos_pendentes e pedidos com default 0', () => {
    assert.match(m2, /alter table public\.pagamentos_pendentes[\s\S]*?cashback_usado_centavos integer not null default 0 check \(cashback_usado_centavos >= 0\)[\s\S]*?cashback_uso_id uuid/)
    assert.match(m2, /alter table public\.pedidos[\s\S]*?cashback_usado_centavos integer not null default 0[\s\S]*?cashback_gerado_centavos integer not null default 0 check \(cashback_gerado_centavos >= 0\)/)
  })
})

// ---------------------------------------------------------------- M3 (texto + PGlite)
const m3 = ler('20261106120000_cashback_funcoes_conta.sql')

type Vetores = {
  credito: Array<{ nome: string; itensLiquidos: number; percentualBp: number; esperado: number }>
  resgate: Array<{ nome: string; saldo: number; itens: number; tetoUsoPct: number; esperado: number }>
}
const vetores = JSON.parse(
  readFileSync(new URL('./fixtures/cashback-vetores.json', import.meta.url), 'utf8'),
) as Vetores

const BARRACA = 'b0000000-0000-4000-8000-000000000001'
const CLIENTE = 'c0000000-0000-4000-8000-000000000001'

// Banco mínimo no PGlite: só o que as migrations do cashback referenciam (nada do app inteiro).
async function novoBanco(migrations: string[]): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create table public.barracas (id uuid primary key, slug text, nome text);
    create table public.clientes_finais (id uuid primary key, barraca_id uuid, telefone_confirmado_em timestamptz);
    create table public.pedidos (id uuid primary key, barraca_id uuid, cliente_id uuid, desconto_cupom_centavos integer not null default 0);
    create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid(), barraca_id uuid, pedido_id uuid, status text not null default 'pendente');
    create table public.itens_do_pedido (id uuid primary key default gen_random_uuid(), pedido_id uuid, quantidade integer, preco_centavos_unitario integer, removido boolean default false);
    create table public.cupom_usos (id uuid primary key default gen_random_uuid(), pagamento_pendente_id uuid, estado text);
    create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql as $$ select true $$;
    create function public.cupom_liberar(p_pendente_id uuid) returns void language sql as $$
      update public.cupom_usos set estado = 'liberado' where pagamento_pendente_id = p_pendente_id and estado = 'reservado' $$;
    insert into public.barracas (id, slug, nome) values ('${BARRACA}', 'teste-cashback', 'TESTE-CASHBACK');
    insert into public.clientes_finais (id, barraca_id, telefone_confirmado_em) values ('${CLIENTE}', '${BARRACA}', now());
  `)
  for (const m of migrations) await db.exec(m)
  return db
}

describe('M3 funções de conta', () => {
  test('as cinco funções existem; fórmulas são immutable; revoke e grant só para service_role', () => {
    for (const f of ['cashback_calcular_credito', 'cashback_calcular_resgate', 'cashback_travar', 'cashback_expirar_se_vencido', 'cashback_saldo']) {
      assert.match(m3, new RegExp(`create or replace function public\\.${f}\\(`), f)
      assert.match(m3, new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`), f)
      assert.match(m3, new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`), f)
    }
    assert.match(m3, /cashback_calcular_credito[\s\S]*?language sql\s+immutable/)
    assert.match(m3, /cashback_calcular_resgate[\s\S]*?language sql\s+immutable/)
    assert.match(m3, /pg_advisory_xact_lock\(hashtextextended\(p_barraca_id::text \|\| p_cliente_id::text, 0\)\)/)
    assert.match(m3, /security definer\s+set search_path = public, pg_temp/)
  })

  test('cashback_expirar_se_vencido trava a conta e é o único que grava expiração', () => {
    assert.match(m3, /cashback_expirar_se_vencido[\s\S]*?perform public\.cashback_travar/)
    assert.doesNotMatch(m3, /\b(update|delete from) public\.cashback_lancamentos/)
  })

  describe('no PGlite', () => {
    let db: PGlite
    before(async () => {
      db = await novoBanco([m2, m3])
    })
    after(async () => {
      await db.close()
    })

    for (const v of vetores.credito) {
      test(`vetor de crédito: ${v.nome}`, async () => {
        const r = await db.query<{ v: number }>(`select public.cashback_calcular_credito(${v.itensLiquidos}, ${v.percentualBp}) as v`)
        assert.equal(r.rows[0].v, v.esperado)
      })
    }
    for (const v of vetores.resgate) {
      test(`vetor de resgate: ${v.nome}`, async () => {
        const r = await db.query<{ v: number }>(`select public.cashback_calcular_resgate(${v.saldo}, ${v.itens}, ${v.tetoUsoPct}) as v`)
        assert.equal(r.rows[0].v, v.esperado)
      })
    }

    test('Review Focus 1: saldo vencido não materializado vale 0 e a expiração grava a soma', async () => {
      await db.exec(`
        delete from public.cashback_lancamentos;
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em)
        values ('${BARRACA}', '${CLIENTE}', 'credito', 300, now() - interval '1 day');`)
      const s = await db.query<{ saldo_centavos: number; vence_em: string | null }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s.rows[0].saldo_centavos, 0)
      assert.equal(s.rows[0].vence_em, null)
      const e = await db.query<{ v: number }>(`select public.cashback_expirar_se_vencido('${BARRACA}', '${CLIENTE}') as v`)
      assert.equal(e.rows[0].v, 300)
      const again = await db.query<{ v: number }>(`select public.cashback_expirar_se_vencido('${BARRACA}', '${CLIENTE}') as v`)
      assert.equal(again.rows[0].v, 0)
      // Crédito novo depois da expiração: só o novo sobra.
      await db.exec(`insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em)
        values ('${BARRACA}', '${CLIENTE}', 'credito', 100, now() + interval '30 days')`)
      const s2 = await db.query<{ saldo_centavos: number }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s2.rows[0].saldo_centavos, 100)
    })

    test('reserva aberta desconta do disponível; reserva vencida é ignorada', async () => {
      await db.exec(`
        delete from public.cashback_resgates; delete from public.cashback_lancamentos;
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em)
        values ('${BARRACA}', '${CLIENTE}', 'credito', 500, now() + interval '10 days');
        insert into public.pagamentos_pendentes (id, barraca_id) values ('d0000000-0000-4000-8000-000000000001', '${BARRACA}'), ('d0000000-0000-4000-8000-000000000002', '${BARRACA}');
        insert into public.cashback_resgates (barraca_id, cliente_id, pagamento_pendente_id, estado, valor_centavos, reservado_ate)
        values ('${BARRACA}', '${CLIENTE}', 'd0000000-0000-4000-8000-000000000001', 'reservado', 200, now() + interval '10 minutes'),
               ('${BARRACA}', '${CLIENTE}', 'd0000000-0000-4000-8000-000000000002', 'reservado', 100, now() - interval '1 minute');`)
      const s = await db.query<{ saldo_centavos: number; reservado_centavos: number; disponivel_centavos: number }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.deepEqual([s.rows[0].saldo_centavos, s.rows[0].reservado_centavos, s.rows[0].disponivel_centavos], [500, 200, 300])
    })
  })
})
