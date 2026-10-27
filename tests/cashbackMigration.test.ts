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
    create table public.pedidos (id uuid primary key, barraca_id uuid, cliente_id uuid, desconto_cupom_centavos integer not null default 0, status text not null default 'novo', criado_em timestamptz not null default now());
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

// ---------------------------------------------------------------- M4 (texto + PGlite)
const m4 = ler('20261106130000_cashback_resgate.sql')
const semComentarios = (s: string) => s.replace(/--.*$/gm, '')

function corpoDe(sqlTexto: string, funcao: string): string {
  const ini = sqlTexto.indexOf(`create or replace function public.${funcao}(`)
  assert.ok(ini >= 0, funcao)
  const fim = sqlTexto.indexOf('\n$$;', ini)
  return semComentarios(sqlTexto.slice(ini, fim))
}

describe('M4 resgate', () => {
  test('as cinco funções novas e a redefinição de cupom_liberar chamando cashback_liberar', () => {
    for (const f of ['cashback_avaliar_resgate', 'cashback_reservar', 'cashback_confirmar_resgate', 'cashback_liberar', 'cashback_liberar_abandonadas']) {
      assert.match(m4, new RegExp(`create or replace function public\\.${f}\\(`), f)
    }
    assert.match(corpoDe(m4, 'cupom_liberar'), /perform public\.cashback_liberar\(p_pendente_id\)/)
    assert.match(corpoDe(m4, 'cupom_liberar'), /update public\.cupom_usos set estado = 'liberado'/)
  })

  test('regra de ouro: confirmar não decide por cashback_habilitado nem por reservado_ate', () => {
    const c = corpoDe(m4, 'cashback_confirmar_resgate')
    assert.doesNotMatch(c, /cashback_habilitado/)
    assert.doesNotMatch(c, /reservado_ate/)
    assert.match(c, /estado = 'confirmado'/)
  })

  test('todas fechadas para anon/authenticated e abertas ao service_role', () => {
    const assinaturas = [
      'cashback_avaliar_resgate(uuid, uuid, integer)',
      'cashback_reservar(uuid, uuid, integer, uuid, timestamptz)',
      'cashback_confirmar_resgate(uuid, uuid)',
      'cashback_liberar(uuid)',
      'cashback_liberar_abandonadas(uuid, uuid, uuid)',
      'cupom_liberar(uuid)',
    ]
    for (const a of assinaturas) {
      const esc = a.replace(/[()]/g, '\\$&')
      assert.match(m4, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`), a)
      assert.match(m4, new RegExp(`grant execute on function public\\.${esc} to service_role`), a)
    }
  })

  test('avaliar não exige cashback_habilitado (saldo concedido segue usável)', () => {
    assert.doesNotMatch(corpoDe(m4, 'cashback_avaliar_resgate'), /cashback_habilitado/)
    assert.doesNotMatch(corpoDe(m4, 'cashback_reservar'), /cashback_habilitado/)
  })

  describe('no PGlite', () => {
    let db: PGlite
    const P1 = 'e0000000-0000-4000-8000-000000000001'
    const P2 = 'e0000000-0000-4000-8000-000000000002'
    const PED = 'f0000000-0000-4000-8000-000000000001'
    const dia = `now() + interval '30 days'`
    const reservar = (pend: string, itens = 4000, ate = `now() + interval '15 minutes'`) =>
      db.query<{ r: { ok: boolean; erro?: string; resgate_centavos?: number; uso_id?: string } }>(
        `select public.cashback_reservar('${BARRACA}', '${CLIENTE}', ${itens}, '${pend}', ${ate}) as r`,
      )
    const saldoRazao = async () =>
      Number((await db.query<{ s: string }>(`select coalesce(sum(valor_centavos), 0) s from public.cashback_lancamentos`)).rows[0].s)

    before(async () => {
      db = await novoBanco([m1, m2, m3, m4])
    })
    after(async () => {
      await db.close()
    })
    const zerar = async (saldo = 1000) => {
      await db.exec(`
        delete from public.cashback_resgates; delete from public.cashback_lancamentos;
        delete from public.pagamentos_pendentes; delete from public.pedidos;
        insert into public.pagamentos_pendentes (id, barraca_id) values ('${P1}', '${BARRACA}'), ('${P2}', '${BARRACA}');
        insert into public.pedidos (id, barraca_id, cliente_id) values ('${PED}', '${BARRACA}', '${CLIENTE}');
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em)
        values ('${BARRACA}', '${CLIENTE}', 'credito', ${saldo}, ${dia});`)
    }

    test('avaliar: sem cliente, sem saldo, itens baixos e ok', async () => {
      await zerar(1000)
      const av = async (cli: string | null, itens: number) =>
        (await db.query<{ r: Record<string, unknown> }>(`select public.cashback_avaliar_resgate('${BARRACA}', ${cli ? `'${cli}'` : 'null'}, ${itens}) as r`)).rows[0].r
      assert.equal((await av(null, 4000)).erro, 'sem_cliente')
      assert.equal((await av('c9999999-0000-4000-8000-000000000009', 4000)).erro, 'sem_cliente')
      assert.equal((await av(CLIENTE, 100)).erro, 'itens_baixos')
      const ok = await av(CLIENTE, 4000)
      assert.equal(ok.ok, true)
      assert.equal(ok.resgate_centavos, 1000)
      await db.exec(`delete from public.cashback_lancamentos`)
      assert.equal((await av(CLIENTE, 4000)).erro, 'sem_saldo')
    })

    test('reservar duas vezes a mesma cobrança não duplica a linha', async () => {
      await zerar(1000)
      const a = (await reservar(P1)).rows[0].r
      const b = (await reservar(P1)).rows[0].r
      assert.equal(a.ok, true)
      assert.equal(b.resgate_centavos, 1000)
      assert.equal(a.uso_id, b.uso_id)
      const n = await db.query<{ n: string }>(`select count(*) n from public.cashback_resgates`)
      assert.equal(Number(n.rows[0].n), 1)
      const pend = await db.query<{ cashback_usado_centavos: number }>(`select cashback_usado_centavos from public.pagamentos_pendentes where id = '${P1}'`)
      assert.equal(pend.rows[0].cashback_usado_centavos, 1000)
    })

    test('Review Focus 2: duas cobranças disputando o mesmo saldo, só uma reserva', async () => {
      await zerar(1000)
      const a = (await reservar(P1)).rows[0].r
      const b = (await reservar(P2)).rows[0].r
      assert.equal(a.ok, true)
      assert.equal(b.ok, false)
      assert.equal(b.erro, 'sem_saldo')
    })

    test('liberar devolve o disponível e não mexe em confirmado', async () => {
      await zerar(1000)
      const a = (await reservar(P1)).rows[0].r
      await db.query(`select public.cupom_liberar('${P1}')`) // passa pelo cupom_liberar redefinido
      let s = await db.query<{ disponivel_centavos: number }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s.rows[0].disponivel_centavos, 1000)
      const c = (await reservar(P1)).rows[0].r
      assert.equal(c.ok, true)
      await db.query(`select public.cashback_confirmar_resgate('${c.uso_id}', '${PED}')`)
      await db.query(`select public.cashback_liberar('${P1}')`)
      const est = await db.query<{ estado: string }>(`select estado from public.cashback_resgates where id = '${a.uso_id}'`)
      assert.equal(est.rows[0].estado, 'confirmado')
      s = await db.query(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s.rows[0].disponivel_centavos, 0)
    })

    test('confirmar duas vezes grava um só resgate e o pedido guarda o desconto', async () => {
      await zerar(1000)
      const a = (await reservar(P1)).rows[0].r
      await db.query(`select public.cashback_confirmar_resgate('${a.uso_id}', '${PED}')`)
      await db.query(`select public.cashback_confirmar_resgate('${a.uso_id}', '${PED}')`)
      const n = await db.query<{ n: string }>(`select count(*) n from public.cashback_lancamentos where tipo = 'resgate'`)
      assert.equal(Number(n.rows[0].n), 1)
      assert.equal(await saldoRazao(), 0)
      const p = await db.query<{ cashback_usado_centavos: number }>(`select cashback_usado_centavos from public.pedidos where id = '${PED}'`)
      assert.equal(p.rows[0].cashback_usado_centavos, 1000)
    })

    test('reserva vencida + saldo gasto em outro pedido + confirmação: razão >= 0 e excedente', async () => {
      await zerar(1000)
      const a = (await reservar(P1, 4000, `now() - interval '1 minute'`)).rows[0].r
      // Outro pedido gasta o saldo (a reserva vencida não segura).
      const b = (await reservar(P2)).rows[0].r
      assert.equal(b.resgate_centavos, 1000)
      await db.query(`select public.cashback_confirmar_resgate('${b.uso_id}', '${PED}')`)
      assert.equal(await saldoRazao(), 0)
      const PED2 = 'f0000000-0000-4000-8000-000000000002'
      await db.exec(`insert into public.pedidos (id, barraca_id, cliente_id) values ('${PED2}', '${BARRACA}', '${CLIENTE}')`)
      await db.query(`select public.cashback_confirmar_resgate('${a.uso_id}', '${PED2}')`)
      assert.equal(await saldoRazao(), 0)
      const r = await db.query<{ excedente_centavos: number }>(`select excedente_centavos from public.cashback_resgates where id = '${a.uso_id}'`)
      assert.equal(r.rows[0].excedente_centavos, 1000)
      const p = await db.query<{ cashback_usado_centavos: number }>(`select cashback_usado_centavos from public.pedidos where id = '${PED2}'`)
      assert.equal(p.rows[0].cashback_usado_centavos, 1000)
    })

    test('Review Focus 1: reservar sobre saldo vencido não ressuscita nada', async () => {
      await zerar(1000)
      await db.exec(`update public.cashback_lancamentos set expira_em = now() - interval '1 day'`)
      const a = (await reservar(P1)).rows[0].r
      assert.equal(a.ok, false)
      assert.equal(await saldoRazao(), 0) // expiração materializada
    })
  })
})

// ---------------------------------------------------------------- M5 (texto + PGlite)
const m5 = ler('20261106140000_cashback_credito_estorno.sql')

describe('M5 crédito e estorno', () => {
  test('as duas funções, só service_role, expirar antes do insert de crédito', () => {
    for (const a of ['cashback_creditar_pedido(uuid)', 'cashback_estornar_pedido(uuid)']) {
      const esc = a.replace(/[()]/g, '\\$&')
      assert.match(m5, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated`), a)
      assert.match(m5, new RegExp(`grant execute on function public\\.${esc} to service_role`), a)
    }
    const c = corpoDe(m5, 'cashback_creditar_pedido')
    assert.ok(c.indexOf('cashback_expirar_se_vencido') > 0)
    assert.ok(c.indexOf('cashback_expirar_se_vencido') < c.indexOf('insert into public.cashback_lancamentos'))
    const e = corpoDe(m5, 'cashback_estornar_pedido')
    assert.ok(e.indexOf('cashback_expirar_se_vencido') < e.indexOf('insert into public.cashback_lancamentos'))
  })

  test('razão só-inserção: nenhum update/delete em cashback_lancamentos', () => {
    assert.doesNotMatch(semComentarios(m5), /\b(update|delete\s+from)\s+public\.cashback_lancamentos/i)
  })

  test('estorno não olha o status do pedido (gatilho é só o estorno)', () => {
    assert.doesNotMatch(corpoDe(m5, 'cashback_estornar_pedido'), /cancelado/)
  })

  describe('no PGlite', () => {
    let db: PGlite
    const PED = 'f1000000-0000-4000-8000-000000000001'
    const PEND = 'e1000000-0000-4000-8000-000000000001'
    const CLI_SEM_TEL = 'c1000000-0000-4000-8000-000000000002'
    type R = { ok: boolean; erro?: string; credito_centavos?: number; credito_revertido_centavos?: number; saldo_devolvido_centavos?: number }
    const creditar = async (ped = PED) =>
      (await db.query<{ r: R }>(`select public.cashback_creditar_pedido('${ped}') as r`)).rows[0].r
    const estornar = async (ped = PED) =>
      (await db.query<{ r: R }>(`select public.cashback_estornar_pedido('${ped}') as r`)).rows[0].r
    const razao = async () =>
      Number((await db.query<{ s: string }>(`select coalesce(sum(valor_centavos), 0) s from public.cashback_lancamentos where cliente_id = '${CLIENTE}'`)).rows[0].s)
    const linhas = async (tipo: string) =>
      Number((await db.query<{ n: string }>(`select count(*) n from public.cashback_lancamentos where tipo = '${tipo}'`)).rows[0].n)

    before(async () => {
      db = await novoBanco([m1, m2, m3, m4, m5])
    })
    after(async () => {
      await db.close()
    })
    // Pedido de 2 × R$ 20,00 = 4000 de itens, pago online (pendente aprovado).
    const preparar = async (opts: { cupom?: number; usado?: number; itens?: number; habilitado?: boolean; cliente?: string | null } = {}) => {
      const cliente = opts.cliente === undefined ? CLIENTE : opts.cliente
      await db.exec(`
        delete from public.cashback_resgates; delete from public.cashback_lancamentos;
        delete from public.itens_do_pedido; delete from public.pagamentos_pendentes; delete from public.pedidos;
        update public.barracas set cashback_habilitado = ${opts.habilitado ?? true}, cashback_termo_aceito_em = now() where id = '${BARRACA}';
        insert into public.clientes_finais (id, barraca_id, telefone_confirmado_em) values ('${CLI_SEM_TEL}', '${BARRACA}', null) on conflict do nothing;
        insert into public.pedidos (id, barraca_id, cliente_id, desconto_cupom_centavos, cashback_usado_centavos)
        values ('${PED}', '${BARRACA}', ${cliente ? `'${cliente}'` : 'null'}, ${opts.cupom ?? 0}, ${opts.usado ?? 0});
        insert into public.itens_do_pedido (pedido_id, quantidade, preco_centavos_unitario) values ('${PED}', 2, ${(opts.itens ?? 4000) / 2});
        insert into public.itens_do_pedido (pedido_id, quantidade, preco_centavos_unitario, removido) values ('${PED}', 1, 9999, true);
        insert into public.pagamentos_pendentes (id, barraca_id, pedido_id, status) values ('${PEND}', '${BARRACA}', '${PED}', 'aprovado');`)
    }

    test('4000 de itens a 500 bp rende 200, segunda chamada não duplica, item removido fora da base', async () => {
      await preparar()
      const a = await creditar()
      assert.deepEqual([a.ok, a.credito_centavos], [true, 200])
      const b = await creditar()
      assert.deepEqual([b.ok, b.credito_centavos], [true, 200])
      assert.equal(await linhas('credito'), 1)
      const p = await db.query<{ cashback_gerado_centavos: number }>(`select cashback_gerado_centavos from public.pedidos where id = '${PED}'`)
      assert.equal(p.rows[0].cashback_gerado_centavos, 200)
    })

    test('cupom de 500 reduz a base: 175', async () => {
      await preparar({ cupom: 500 })
      assert.equal((await creditar()).credito_centavos, 175)
    })

    test('SUPOSIÇÃO-CASHBACK-4: saldo usado também sai da base', async () => {
      await preparar({ usado: 1000 })
      assert.equal((await creditar()).credito_centavos, 150)
    })

    test('Review Focus 5: 5% de R$ 0,19 vira crédito 0 sem linha no razão', async () => {
      await preparar({ itens: 18 })
      const r = await creditar()
      assert.deepEqual([r.ok, r.credito_centavos], [true, 0])
      assert.equal(await linhas('credito'), 0)
    })

    test('Review Focus 4: sem cliente, sem telefone confirmado, não pago online e desligado', async () => {
      await preparar({ cliente: null })
      assert.equal((await creditar()).erro, 'sem_cliente')
      await preparar({ cliente: CLI_SEM_TEL })
      assert.equal((await creditar()).erro, 'telefone_nao_confirmado')
      await preparar()
      await db.exec(`update public.pagamentos_pendentes set status = 'pendente'`)
      assert.equal((await creditar()).erro, 'nao_pago_online')
      await preparar({ habilitado: false })
      assert.equal((await creditar()).erro, 'desligado')
      assert.equal((await creditar('f1000000-0000-4000-8000-0000000000ff')).erro, 'pedido_inexistente')
      assert.equal(await linhas('credito'), 0)
    })

    test('Review Focus 1: saldo vencido antigo vira expiração e só o crédito novo sobra', async () => {
      await preparar()
      await db.exec(`insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em)
        values ('${BARRACA}', '${CLIENTE}', 'credito', 700, now() - interval '2 days')`)
      assert.equal((await creditar()).credito_centavos, 200)
      assert.equal(await linhas('expiracao'), 1)
      assert.equal(await razao(), 200)
      const s = await db.query<{ saldo_centavos: number }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s.rows[0].saldo_centavos, 200)
    })

    test('Review Focus 3: estorno depois de o saldo ter sido gasto reverte só o que resta; repetido não duplica', async () => {
      await preparar()
      await creditar() // +200
      await db.exec(`insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id)
        values ('${BARRACA}', '${CLIENTE}', 'resgate', -150, null)`) // gastou 150 em outro pedido
      const a = await estornar()
      assert.deepEqual([a.ok, a.credito_revertido_centavos, a.saldo_devolvido_centavos], [true, 50, 0])
      assert.equal(await razao(), 0)
      const b = await estornar()
      assert.deepEqual([b.credito_revertido_centavos, b.saldo_devolvido_centavos], [50, 0])
      assert.equal(await linhas('estorno_credito'), 1)
      assert.equal(await razao(), 0)
    })

    test('estorno devolve o saldo usado com validade renovada e não ressuscita saldo vencido', async () => {
      await preparar({ usado: 300 })
      await db.exec(`insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, pagamento_pendente_id)
        values ('${BARRACA}', '${CLIENTE}', 'credito', 900, null, null)`.replace(`'credito', 900`, `'credito', 900`))
      // Linha de resgate real do pedido, e saldo antigo vencido que não pode voltar.
      await db.exec(`
        update public.cashback_lancamentos set expira_em = now() - interval '3 days' where tipo = 'credito';
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, pagamento_pendente_id)
        values ('${BARRACA}', '${CLIENTE}', 'resgate', -300, '${PED}', '${PEND}');`)
      const r = await estornar()
      assert.deepEqual([r.credito_revertido_centavos, r.saldo_devolvido_centavos], [0, 300])
      const s = await db.query<{ saldo_centavos: number }>(`select * from public.cashback_saldo('${BARRACA}', '${CLIENTE}')`)
      assert.equal(s.rows[0].saldo_centavos, 300)
      assert.equal(await linhas('expiracao'), 1)
    })

    test('Review Focus 3: estorno de pedido sem crédito nem resgate é no-op; cancelado não muda nada', async () => {
      await preparar()
      await db.exec(`update public.pedidos set status = 'cancelado'`)
      const r = await estornar()
      assert.deepEqual([r.ok, r.credito_revertido_centavos, r.saldo_devolvido_centavos], [true, 0, 0])
      assert.equal(await razao(), 0)
    })
  })
})

// ---------------------------------------------------------------- M6 (texto + PGlite)
const m6 = ler('20261106150000_cashback_resumo.sql')

describe('M6 resumo', () => {
  test('security invoker (sem security definer), grant para authenticated e os seis campos', () => {
    assert.doesNotMatch(semComentarios(m6), /security definer/i)
    assert.match(m6, /security invoker/)
    assert.match(m6, /grant execute on function public\.cashback_resumo\(uuid, timestamptz, timestamptz\) to authenticated/)
    assert.doesNotMatch(m6, /to anon/)
    for (const campo of ['concedido_centavos', 'usado_centavos', 'vencido_centavos', 'estornado_centavos', 'excedente_centavos', 'saldo_em_aberto_centavos']) {
      assert.match(m6, new RegExp(campo), campo)
    }
  })

  describe('no PGlite', () => {
    let db: PGlite
    before(async () => {
      db = await novoBanco([m1, m2, m3, m4, m5, m6])
      await db.exec(`
        insert into public.pedidos (id, barraca_id, cliente_id, cashback_usado_centavos) values ('f2000000-0000-4000-8000-000000000001', '${BARRACA}', '${CLIENTE}', 300);
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em, pedido_id) values
          ('${BARRACA}', '${CLIENTE}', 'credito', 1000, now() + interval '20 days', null),
          ('${BARRACA}', '${CLIENTE}', 'resgate', -200, null, 'f2000000-0000-4000-8000-000000000001'),
          ('${BARRACA}', '${CLIENTE}', 'estorno_credito', -100, null, null),
          ('${BARRACA}', '${CLIENTE}', 'estorno_resgate', 50, now() + interval '20 days', null);
        -- Outro cliente com saldo vencido ainda não materializado e um com expiração já gravada.
        insert into public.clientes_finais (id, barraca_id, telefone_confirmado_em) values ('c2000000-0000-4000-8000-000000000002', '${BARRACA}', now());
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em) values
          ('${BARRACA}', 'c2000000-0000-4000-8000-000000000002', 'credito', 400, now() - interval '1 day');
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, expira_em) values
          ('${BARRACA}', null, 'credito', 999, now() + interval '20 days');`)
    })
    after(async () => {
      await db.close()
    })

    test('os seis números batem e clientes apagados ficam fora do saldo em aberto', async () => {
      const r = await db.query<Record<string, string | number>>(
        `select * from public.cashback_resumo('${BARRACA}', now() - interval '1 hour', now() + interval '1 hour')`,
      )
      const l = Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]))
      assert.equal(l.concedido_centavos, 1000 + 400 + 999)
      assert.equal(l.usado_centavos, 200)
      assert.equal(l.vencido_centavos, 400) // saldo vencido não materializado
      assert.equal(l.estornado_centavos, 150)
      assert.equal(l.excedente_centavos, 100) // desconto de 300, razão debitou 200
      assert.equal(l.saldo_em_aberto_centavos, 1000 - 200 - 100 + 50) // cliente 1; cliente apagado fora
    })

    test('período vazio devolve zeros, exceto o saldo em aberto (independe do período)', async () => {
      const r = await db.query<Record<string, string | number>>(
        `select * from public.cashback_resumo('${BARRACA}', now() - interval '3 days', now() - interval '2 days')`,
      )
      const l = Object.fromEntries(Object.entries(r.rows[0]).map(([k, v]) => [k, Number(v)]))
      assert.equal(l.concedido_centavos, 0)
      assert.equal(l.usado_centavos, 0)
      assert.equal(l.estornado_centavos, 0)
      assert.equal(l.excedente_centavos, 0)
      assert.equal(l.saldo_em_aberto_centavos, 750)
    })
  })
})

// ---------------------------------------------------------------- M7 (aviso do cashback no status do Pix)
const m7 = ler('20261106160000_cashback_aviso_pix.sql')

describe('M7 consultar_status_pagamento com cashback', () => {
  test('mantém as três colunas atuais na mesma ordem e acrescenta as duas novas', () => {
    assert.match(m7, /returns table \(\s*status text,\s*senha int,\s*pedido_id uuid,\s*cashback_gerado_centavos integer,\s*cashback_vence_em timestamptz\s*\)/)
  })

  test('continua security definer com search_path fixo e executável por anon', () => {
    assert.match(m7, /security definer/)
    assert.match(m7, /set search_path = public, pg_temp/)
    assert.match(m7, /grant execute on function public\.consultar_status_pagamento\(uuid\) to anon, authenticated/)
  })

  describe('no PGlite', () => {
    let db: PGlite
    const PEND = 'd7000000-0000-4000-8000-000000000001'
    const PED = 'e7000000-0000-4000-8000-000000000001'
    before(async () => {
      db = await novoBanco([m1, m2, m3, m4, m5])
      await db.exec('alter table public.pedidos add column if not exists senha int')
      await db.exec(m7)
      await db.exec(`
        insert into public.pedidos (id, barraca_id, senha, cashback_gerado_centavos) values ('${PED}', '${BARRACA}', 42, 200);
        insert into public.pagamentos_pendentes (id, barraca_id, pedido_id, status) values ('${PEND}', '${BARRACA}', '${PED}', 'aprovado');
        insert into public.cashback_lancamentos (barraca_id, cliente_id, tipo, valor_centavos, pedido_id, expira_em) values ('${BARRACA}', '${CLIENTE}', 'credito', 200, '${PED}', '2026-12-31T12:00:00Z');`)
    })
    after(async () => {
      await db.close()
    })

    test('devolve status, senha, cashback gerado e vencimento do próprio pagamento', async () => {
      const r = await db.query<Record<string, unknown>>(`select * from public.consultar_status_pagamento('${PEND}')`)
      assert.equal(r.rows.length, 1)
      assert.equal(r.rows[0].status, 'aprovado')
      assert.equal(r.rows[0].senha, 42)
      assert.equal(r.rows[0].cashback_gerado_centavos, 200)
      assert.ok(r.rows[0].cashback_vence_em)
    })

    test('pagamento sem pedido devolve zero e vencimento nulo; id desconhecido não devolve linha', async () => {
      await db.exec(`insert into public.pagamentos_pendentes (id, barraca_id, status) values ('d7000000-0000-4000-8000-000000000002', '${BARRACA}', 'pendente')`)
      const r = await db.query<Record<string, unknown>>(`select * from public.consultar_status_pagamento('d7000000-0000-4000-8000-000000000002')`)
      assert.equal(r.rows[0].cashback_gerado_centavos, 0)
      assert.equal(r.rows[0].cashback_vence_em, null)
      const v = await db.query(`select * from public.consultar_status_pagamento('d7000000-0000-4000-8000-0000000000ff')`)
      assert.equal(v.rows.length, 0)
    })
  })
})
