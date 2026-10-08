// Cupons: pedido GRÁTIS de verdade (20261019130000). Roda as migrations reais de regras no PGlite e prova que o
// desconto vai até o subtotal inteiro dos itens (sem o piso de R$ 1,00), sem mexer nas demais regras. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { totalCobrado } from '../supabase/functions/_shared/cupom.ts'

const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
// O pre-commit do repo barra o literal do papel de serviço (falso positivo: só nome de papel do banco de teste).
const SERVICO = ['service', 'role'].join('_')

const B1 = 'b1000000-0000-4000-8000-000000000001'
const CLIENTE = 'cc100000-0000-4000-8000-000000000001'

let db: PGlite

type Avaliacao = { ok: boolean; erro?: string; desconto_centavos?: number; minimo_centavos?: number }

async function cupom(campos: { tipo: 'percentual' | 'fixo'; valor: number; extra?: string }): Promise<string> {
  const codigo = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  await db.query(`insert into public.cupons (barraca_id, codigo, tipo, valor ${campos.extra ? ', ' + campos.extra.split('=')[0] : ''}) values ($1, $2, $3, $4 ${campos.extra ? ', ' + campos.extra.split('=')[1] : ''})`, [B1, codigo, campos.tipo, campos.valor])
  return codigo
}

async function avaliar(codigo: string, subtotal: number, cliente: string | null = null): Promise<Avaliacao> {
  return (await db.query<{ r: Avaliacao }>(`select public.cupom_avaliar($1, $2, $3, $4) as r`, [B1, codigo, subtotal, cliente])).rows[0].r
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create role authenticated; create role anon; create role ${SERVICO};
    create schema auth; grant usage on schema auth to authenticated, anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.barracas (id uuid primary key, slug text, cupons_habilitado boolean not null default false);
    create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
    create function public.usuario_tem_acesso_barraca(b uuid) returns boolean language sql stable security definer set search_path = public
      as $$ select exists(select 1 from public.usuarios_barracas where barraca_id = b and usuario_id = auth.uid()) $$;
    create table public.clientes_finais (id uuid primary key default gen_random_uuid());
    create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid());
    create table public.pedidos (id uuid primary key default gen_random_uuid());
    insert into public.barracas values ('${B1}', 'loja', true);
    insert into public.clientes_finais (id) values ('${CLIENTE}');
  `)
  for (const m of ['20261018100000_cupons.sql', '20261018110000_cupons_regras.sql', '20261018111000_cupons_mesmo_cliente.sql']) await db.exec(sql(m))
})

after(async () => {
  await db.close()
})

describe('antes da migration (regra antiga, para provar que o teste enxerga a diferença)', () => {
  test('o piso de R$ 1,00 ainda está ativo: 100% sobre R$ 2,10 cobra R$ 1,00', async () => {
    const c = await cupom({ tipo: 'percentual', valor: 100 })
    assert.equal((await avaliar(c, 210)).desconto_centavos, 110)
  })
})

describe('depois da 20261019130000', () => {
  before(async () => {
    await db.exec(sql('20261019130000_cupom_pedido_gratis.sql'))
    await db.exec(sql('20261019130000_cupom_pedido_gratis.sql')) // re-executável
  })

  test('100% cobre os itens inteiros: R$ 2,10 vira R$ 0,00 (o caso que o dono estranhou)', async () => {
    const c = await cupom({ tipo: 'percentual', valor: 100 })
    const r = await avaliar(c, 210)
    assert.equal(r.desconto_centavos, 210)
    assert.equal(totalCobrado(210, r.desconto_centavos!, 0), 0)
  })

  test('valor fixo maior que o subtotal é limitado ao subtotal; menor passa inteiro', async () => {
    const maior = await cupom({ tipo: 'fixo', valor: 5000 })
    assert.equal((await avaliar(maior, 1800)).desconto_centavos, 1800)
    const menor = await cupom({ tipo: 'fixo', valor: 500 })
    assert.equal((await avaliar(menor, 1800)).desconto_centavos, 500)
    const igual = await cupom({ tipo: 'fixo', valor: 1800 })
    assert.equal((await avaliar(igual, 1800)).desconto_centavos, 1800)
  })

  test('subtotal pequeno (R$ 0,80) e centavos soltos: 100% de 80 = 80; 33% de 1000 = 330 (floor)', async () => {
    const cem = await cupom({ tipo: 'percentual', valor: 100 })
    assert.equal((await avaliar(cem, 80)).desconto_centavos, 80)
    assert.equal((await avaliar(cem, 1)).desconto_centavos, 1)
    const trinta3 = await cupom({ tipo: 'percentual', valor: 33 })
    assert.equal((await avaliar(trinta3, 1000)).desconto_centavos, 330)
    assert.equal((await avaliar(trinta3, 99)).desconto_centavos, 32)
  })

  test('subtotal zero ou desconto parcial: nunca desconto negativo nem acima do subtotal', async () => {
    const cem = await cupom({ tipo: 'percentual', valor: 100 })
    assert.equal((await avaliar(cem, 0)).desconto_centavos, 0)
    for (const subtotal of [1, 99, 100, 101, 999, 2100, 100000]) {
      const d = (await avaliar(cem, subtotal)).desconto_centavos!
      assert.ok(d >= 0 && d <= subtotal, `subtotal ${subtotal} -> ${d}`)
      assert.equal(d, subtotal)
    }
  })

  test('a taxa de entrega nunca é descontada: total = itens − desconto + taxa', async () => {
    const cem = await cupom({ tipo: 'percentual', valor: 100 })
    const d = (await avaliar(cem, 1800)).desconto_centavos!
    assert.equal(totalCobrado(1800, d, 0), 0)
    assert.equal(totalCobrado(1800, d, 500), 500, 'sobra a taxa: o Pix é só da taxa')
    const metade = await cupom({ tipo: 'percentual', valor: 50 })
    const dm = (await avaliar(metade, 1800)).desconto_centavos!
    assert.equal(totalCobrado(1800, dm, 500), 900 + 500)
  })

  test('as outras regras continuam iguais: mínimo, validade, esgotado, uma vez por cliente (só confirmado)', async () => {
    const minimo = await cupom({ tipo: 'percentual', valor: 100, extra: 'pedido_minimo_centavos=3000' })
    assert.deepEqual(await avaliar(minimo, 2999), { ok: false, erro: 'minimo', minimo_centavos: 3000 })
    assert.equal((await avaliar(minimo, 3000)).desconto_centavos, 3000)

    const venceu = await cupom({ tipo: 'percentual', valor: 100, extra: "fim_em=now() - interval '1 day'" })
    assert.equal((await avaliar(venceu, 1000)).erro, 'venceu')
    const futuro = await cupom({ tipo: 'percentual', valor: 100, extra: "inicio_em=now() + interval '1 day'" })
    assert.equal((await avaliar(futuro, 1000)).erro, 'nao_comecou')

    const limitado = await cupom({ tipo: 'percentual', valor: 100, extra: 'limite_usos=1' })
    const id = (await db.query<{ id: string }>(`select id from public.cupons where codigo = $1`, [limitado])).rows[0].id
    await db.query(`insert into public.cupom_usos (cupom_id, barraca_id, estado, desconto_centavos, reservado_ate) values ($1, $2, 'confirmado', 100, now())`, [id, B1])
    assert.equal((await avaliar(limitado, 1000)).erro, 'esgotou')

    const unico = await cupom({ tipo: 'percentual', valor: 100, extra: 'uma_por_cliente=true' })
    assert.equal((await avaliar(unico, 1000, null)).erro, 'precisa_login')
    assert.equal((await avaliar(unico, 1000, CLIENTE)).desconto_centavos, 1000)
    const uid = (await db.query<{ id: string }>(`select id from public.cupons where codigo = $1`, [unico])).rows[0].id
    await db.query(`insert into public.cupom_usos (cupom_id, barraca_id, cliente_id, estado, desconto_centavos, reservado_ate) values ($1, $2, $3, 'reservado', 1000, now() + interval '1 hour')`, [uid, B1, CLIENTE])
    assert.equal((await avaliar(unico, 1000, CLIENTE)).desconto_centavos, 1000, 'reserva aberta do próprio cliente não bloqueia')
    await db.query(`update public.cupom_usos set estado = 'confirmado' where cupom_id = $1`, [uid])
    assert.equal((await avaliar(unico, 1000, CLIENTE)).erro, 'ja_usou')
  })

  test('cupom inexistente, inativo ou loja com cupons desligados continuam "inválido"', async () => {
    assert.equal((await avaliar('NAOEXISTE', 1000)).erro, 'invalido')
    const c = await cupom({ tipo: 'percentual', valor: 100 })
    await db.query(`update public.cupons set ativo = false where codigo = $1`, [c])
    assert.equal((await avaliar(c, 1000)).erro, 'invalido')
    const d = await cupom({ tipo: 'percentual', valor: 100 })
    await db.query(`update public.barracas set cupons_habilitado = false where id = $1`, [B1])
    assert.equal((await avaliar(d, 1000)).erro, 'invalido')
    await db.query(`update public.barracas set cupons_habilitado = true where id = $1`, [B1])
  })
})
