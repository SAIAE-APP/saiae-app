// Oferta ponto/fiscal, item 1 da migration: o DO block derruba SÓ o CHECK antigo do plano (coluna + definição), nunca um
// CHECK desconhecido. Roda apenas o bloco de CHECKs da migration real num PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../supabase/migrations/20261110100000_oferta_ponto_fiscal.sql', import.meta.url), 'utf8')
const bloco = sql.slice(sql.indexOf('do $$'), sql.indexOf('-- 2) Limite'))
const checks = async (db: PGlite) =>
  (await db.query<{ conname: string }>(`select conname from pg_constraint where contype = 'c' and conrelid in ('public.assinaturas'::regclass, 'public.assinatura_ofertas'::regclass) order by conname`)).rows.map((r) => r.conname)

test('CHECKs desconhecidos sobrevivem (outra coluna, ou mesma coluna sem a lista do plano); os do plano são trocados', async () => {
  const db = new PGlite()
  await db.exec(`
    create table public.assinaturas (
      usuario_id uuid primary key, status text, plan text check (plan in ('essencial', 'pro')), cycle text,
      constraint status_sem_essencial check (status in ('trialing', 'active', 'essencial_sem_relacao')),
      constraint plan_nao_nulo_ou_legado check (plan is null or length(plan) < 20)
    );
    create table public.assinatura_ofertas (
      id uuid primary key default gen_random_uuid(), plano text not null check (plano in ('essencial', 'pro')),
      ciclo text not null check (ciclo in ('mensal', 'anual')), constraint ciclo_extra check (ciclo <> 'trimestral')
    );
  `)
  await db.exec(bloco)
  const nomes = await checks(db)
  for (const preservado of ['status_sem_essencial', 'plan_nao_nulo_ou_legado', 'ciclo_extra']) assert.ok(nomes.includes(preservado), preservado)
  assert.equal(nomes.filter((n) => n.includes('plan_check') || n.includes('plano_check')).length, 2, 'só os novos')
  await db.query(`insert into public.assinaturas (usuario_id, status, plan) values (gen_random_uuid(), 'active', 'ponto')`)
  await assert.rejects(db.query(`insert into public.assinaturas (usuario_id, status, plan) values (gen_random_uuid(), 'active', 'xyz')`), /check/)
  await db.close()
})
