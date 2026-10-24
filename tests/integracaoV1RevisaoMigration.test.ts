// Migrations da revisão de segurança da integracao-v1 (reserva do Pix e dono confirmado): texto e PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const ler = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const reservaSql = ler('20261031110000_integracao_pix_reservar.sql')
const cardapioBase = ler('20261031100000_integracao_v1_bot.sql')
const cardapioSql = ler('20261031120000_integracao_cardapio_dono_confirmado.sql')
const B1 = 'b1000000-0000-4000-8000-000000000001'
const B2 = 'b2000000-0000-4000-8000-000000000002'
const U1 = '11111111-1111-4111-8111-111111111111'

describe('migrations da revisão (texto)', () => {
  test('Rollback no topo, security definer, search_path e grants só para service_role', () => {
    for (const [sql, fn] of [
      [reservaSql, 'integracao_pix_reservar\\(uuid, text, jsonb, timestamptz\\)'],
      [cardapioSql, 'integracao_cardapio\\(uuid\\)'],
    ]) {
      assert.match(sql.split('\n').slice(0, 6).join('\n'), /-- Rollback:/)
      assert.match(sql, /security definer/i)
      assert.match(sql, /set search_path = public, pg_temp/i)
      assert.match(sql, new RegExp(`revoke all on function public\\.${fn} from public, anon, authenticated`, 'i'))
      assert.match(sql, new RegExp(`grant execute on function public\\.${fn} to service_role`, 'i'))
    }
  })
  test('reserva usa lock advisory transacional por client_uuid', () => {
    assert.match(reservaSql, /pg_advisory_xact_lock\(/)
  })
})

describe('integracao_pix_reservar (PGlite)', () => {
  let db: PGlite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reservar = async (barraca = B1, uuid = U1, expira = '2099-01-01T00:00:00Z'): Promise<any> =>
    (
      await db.query<{ r: unknown }>('select public.integracao_pix_reservar($1, $2, $3::jsonb, $4::timestamptz) as r', [
        barraca,
        uuid,
        JSON.stringify({ itens: [{ quantidade: 1 }], cliente_nome: 'Ana', cliente_telefone: '61999531848', conversa_id: 'c1', provedor: 'mercadopago' }),
        expira,
      ])
    ).rows[0].r
  const linhas = async () => (await db.query<{ n: number }>('select count(*)::int as n from public.pagamentos_pendentes')).rows[0].n

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid(), barraca_id uuid not null,
        mesa text, viagem boolean not null default false, observacao text, itens jsonb not null, client_uuid text not null unique,
        mercadopago_order_id text, status text not null default 'pendente', tipo_atendimento text, cliente_nome text,
        cliente_telefone text, conversa_id text, provedor text, expira_em timestamptz, taxa_entrega_centavos integer not null default 0);
      grant usage on schema public to service_role, authenticated, anon;
    `)
    await db.exec(reservaSql)
    await db.exec(reservaSql) // idempotente
  })
  after(async () => {
    await db.close()
  })

  test('primeira chamada reivindica e grava o pendente; a segunda, em curso, vira em_andamento sem duplicar', async () => {
    const a = await reservar()
    assert.equal(a.estado, 'reivindicado')
    assert.ok(a.id)
    assert.equal((await reservar()).estado, 'em_andamento')
    assert.equal(await linhas(), 1)
    const p = (await db.query<{ tipo_atendimento: string; viagem: boolean; conversa_id: string }>('select * from public.pagamentos_pendentes')).rows[0]
    assert.deepEqual([p.tipo_atendimento, p.viagem, p.conversa_id], ['retirada', true, 'c1'])
  })

  test('reivindicação velha (provedor caiu) é retomada; liberada (null) também', async () => {
    await db.exec(`update public.pagamentos_pendentes set emissao_iniciada_em = now() - interval '2 minutes'`)
    assert.equal((await reservar()).estado, 'reivindicado')
    await db.exec(`update public.pagamentos_pendentes set emissao_iniciada_em = null`)
    assert.equal((await reservar()).estado, 'reivindicado')
    assert.equal(await linhas(), 1)
  })

  test('com cobrança emitida devolve emitido; outra loja, pago e vencido são recusados', async () => {
    await db.exec(`update public.pagamentos_pendentes set mercadopago_order_id = 'ord-1'`)
    assert.equal((await reservar()).estado, 'emitido')
    assert.equal((await reservar(B2)).estado, 'outra_loja')
    await db.exec(`update public.pagamentos_pendentes set expira_em = now() - interval '1 minute'`)
    assert.equal((await reservar()).estado, 'expirado')
    await db.exec(`update public.pagamentos_pendentes set status = 'aprovado'`)
    assert.equal((await reservar()).estado, 'ja_pago')
  })

  test('anon e authenticated não executam', async () => {
    for (const papel of ['authenticated', 'anon']) {
      await db.exec(`set role ${papel}`)
      await assert.rejects(reservar(B1, '22222222-2222-4222-8222-222222222222'), /permission denied/i, papel)
    }
    await db.exec('reset role')
  })
})

describe('integracao_cardapio: dono só com confirmação (PGlite)', () => {
  let db: PGlite
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardapio = async (): Promise<any> => (await db.query<{ r: unknown }>('select public.integracao_cardapio($1) as r', [B1])).rows[0].r

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create table public.barracas (id uuid primary key, nome text, slug text, modos_atendimento text[], pagar_na_entrega_habilitado boolean,
        pagamento_online_habilitado boolean, perfil_cliente_obrigatorio boolean, ia_habilitada boolean, ia_whatsapp_dono text,
        ia_whatsapp_dono_confirmado_em timestamptz, bloquear_fora_do_horario boolean, fuso text, opcoes_habilitado boolean not null default false);
      create table public.horarios_funcionamento (barraca_id uuid, dia_semana int, aberto boolean, hora_abertura text, hora_fechamento text);
      create table public.categorias (id uuid primary key, barraca_id uuid, nome text, ordem int default 0);
      create table public.itens (id uuid primary key default gen_random_uuid(), barraca_id uuid, nome text, descricao text, preco_centavos int,
        categoria_id uuid, ativo boolean default true, esgotado boolean default false, preco_aberto boolean default false, ordem int default 0);
      create table public.grupos_opcoes (id uuid primary key, barraca_id uuid, nome text, tipo text, min_escolhas int, max_escolhas int, ordem int, ativo boolean);
      create table public.opcoes (id uuid primary key, grupo_id uuid, barraca_id uuid, nome text, preco_centavos int, ordem int, ativo boolean, esgotado boolean);
      create table public.itens_grupos (item_id uuid, grupo_id uuid, barraca_id uuid, ordem int);
      create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid());
      grant usage on schema public to service_role;
      grant select on all tables in schema public to service_role;
      insert into public.barracas (id, nome, slug, ia_whatsapp_dono) values ('${B1}', 'Loja', 'loja', '5561999531848');
    `)
    await db.exec(cardapioBase)
    await db.exec(cardapioSql)
    await db.exec(cardapioSql) // idempotente
    await db.exec('set role service_role')
  })
  after(async () => {
    await db.close()
  })

  test('sem confirmação o número não sai do banco; confirmado, sai', async () => {
    assert.equal((await cardapio()).loja.ia_whatsapp_dono, null)
    await db.exec('reset role')
    await db.exec(`update public.barracas set ia_whatsapp_dono_confirmado_em = now()`)
    await db.exec('set role service_role')
    assert.equal((await cardapio()).loja.ia_whatsapp_dono, '5561999531848')
  })
})
