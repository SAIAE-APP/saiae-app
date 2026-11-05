// Passo 8 do assistente: "Como você cobra a Mesa?" (comanda aberta + taxa de serviço).
// Funções puras, fiação da tela, texto da migration e a função real rodando no PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { opcoesCobrancaMesa, resumoDoAssistente } from '../src/lib/onboardingConfig.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = ler('supabase/migrations/20261029120000_onboarding_comanda.sql')
const mapa = (l: { rotulo: string; valor: string }[]) => Object.fromEntries(l.map((x) => [x.rotulo, x.valor]))

describe('opções de cobrança da Mesa', () => {
  test('duas opções, "Paga na hora" primeiro (é o padrão)', () => {
    assert.deepEqual(opcoesCobrancaMesa.map((o) => o.chave), ['na_hora', 'comanda_aberta'])
    assert.equal(opcoesCobrancaMesa[0].titulo, 'Paga na hora')
    assert.equal(opcoesCobrancaMesa[1].titulo, 'Comanda aberta')
    for (const o of opcoesCobrancaMesa) assert.ok(o.descricao.length > 0)
  })
})

describe('resumo da tela final', () => {
  const base = { nome: 'X', modos_atendimento: ['mesa', 'balcao'] }
  test('cita "Comanda aberta" quando ligada, com a taxa', () => {
    assert.equal(mapa(resumoDoAssistente({ ...base, comanda_aberta_habilitada: true, taxa_servico_habilitada: true, taxa_servico_bps: 1000 }, []))['Mesa'], 'Comanda aberta, com 10% de taxa de serviço')
    assert.equal(mapa(resumoDoAssistente({ ...base, comanda_aberta_habilitada: true, taxa_servico_habilitada: false }, []))['Mesa'], 'Comanda aberta, sem taxa de serviço')
  })
  test('desligada ou sem Mesa: nenhuma linha nova', () => {
    assert.equal(mapa(resumoDoAssistente({ ...base, comanda_aberta_habilitada: false }, []))['Mesa'], undefined)
    assert.equal(mapa(resumoDoAssistente({ nome: 'X', modos_atendimento: ['balcao'], comanda_aberta_habilitada: true }, []))['Mesa'], undefined)
  })
})

describe('fiação do passo 8', () => {
  const pagina = ler('src/pages/Configurar.tsx')
  const api = ler('src/lib/onboardingApi.ts')
  test('pergunta só com Mesa marcada e o banco conhecendo a coluna', () => {
    assert.match(pagina, /Como você cobra a Mesa\?/)
    assert.match(pagina, /perguntaCobranca && ativos\.includes\('mesa'\)/)
    assert.match(pagina, /opcoesCobrancaMesa\.map/)
  })
  test('"Comanda aberta" revela a pergunta da taxa', () => {
    assert.match(pagina, /cobranca === 'comanda_aberta' &&/)
    assert.match(pagina, /de taxa de serviço\?/)
  })
  test('abre com o que já está salvo e grava os dois campos', () => {
    assert.match(pagina, /barraca\.comanda_aberta_habilitada === true \? 'comanda_aberta' : 'na_hora'/)
    assert.match(api, /comanda_aberta_habilitada/)
    assert.match(api, /taxa_servico_habilitada/)
  })
})

describe('migration (texto)', () => {
  test('Rollback no topo, security definer, search_path e grants', () => {
    assert.match(sql.split('\n').slice(0, 15).join('\n'), /Rollback:/)
    assert.match(sql, /create or replace function public\.onboarding_salvar_passo/)
    assert.match(sql, /security definer\s+set search_path = public, pg_temp/)
    assert.match(sql, /revoke all on function public\.onboarding_salvar_passo\(uuid, integer, jsonb\) from public, anon/)
    assert.match(sql, /grant execute on function public\.onboarding_salvar_passo\(uuid, integer, jsonb\) to authenticated/)
  })
  test('preserva as validações de antes (dono, etapas, modos, métodos, horário, conclusão)', () => {
    for (const r of [
      /papel = 'dono'/, /p_etapa not between 3 and 10/, /array\['mesa', 'balcao', 'retirada', 'entrega'\]/,
      /raise exception 'modos_invalidos'/, /array\['dinheiro', 'debito', 'credito', 'pix'\]/, /raise exception 'horario_vazio'/,
      /raise exception 'obrigatorios_pendentes'/, /greatest\(onboarding_etapa, p_etapa::smallint\)/, /!~ '\^\[0-9\]\{14\}\$'/,
    ]) assert.match(sql, r)
  })
  test('os dois campos novos no passo 8', () => {
    assert.match(sql, /comanda_aberta_habilitada/)
    assert.match(sql, /taxa_servico_habilitada/)
  })
})

describe('migration (PGlite)', () => {
  const B = 'b1000000-0000-4000-8000-000000000001'
  const DONO = 'a1000000-0000-4000-8000-000000000001'
  let db: PGlite

  const passo8 = (dados: object) =>
    db.query('select public.onboarding_salvar_passo($1, 8, $2::jsonb)', [B, JSON.stringify(dados)])
  async function estado() {
    const r = await db.query<{ modos: string[]; c: boolean; t: boolean }>(
      'select modos_atendimento modos, comanda_aberta_habilitada c, taxa_servico_habilitada t from public.barracas where id = $1', [B])
    return r.rows[0]
  }
  const definir = (c: boolean, t: boolean) =>
    db.query('update public.barracas set comanda_aberta_habilitada = $2, taxa_servico_habilitada = $3 where id = $1', [B, c, t])

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.barracas (
        id uuid primary key, modos_atendimento text[] not null default '{mesa,balcao,retirada}',
        comanda_aberta_habilitada boolean not null default false, taxa_servico_habilitada boolean not null default false,
        onboarding_etapa smallint not null default 0, onboarding_concluido_em timestamptz
      );
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      insert into public.barracas (id) values ('${B}');
      insert into public.usuarios_barracas values ('${DONO}', '${B}', 'dono');
      select set_config('test.uid', '${DONO}', false);
    `)
    await db.exec(sql)
    await db.exec(sql) // idempotente
  })

  after(async () => {
    await db.close()
  })

  test('sem as chaves novas (app antigo): nada muda além dos modos', async () => {
    await definir(true, true)
    await passo8({ modos: ['mesa', 'balcao'] })
    assert.deepEqual(await estado(), { modos: ['balcao', 'mesa'], c: true, t: true })
  })

  test('comanda aberta com taxa, com Mesa marcada', async () => {
    await definir(false, false)
    await passo8({ modos: ['mesa'], comanda_aberta_habilitada: true, taxa_servico_habilitada: true })
    assert.deepEqual(await estado(), { modos: ['mesa'], c: true, t: true })
  })

  test('"Paga na hora" desliga a comanda e a taxa', async () => {
    await definir(true, true)
    await passo8({ modos: ['mesa'], comanda_aberta_habilitada: false, taxa_servico_habilitada: true })
    assert.deepEqual(await estado(), { modos: ['mesa'], c: false, t: false })
  })

  test('sem Mesa nos modos a comanda NÃO liga (é forçada a false, sem erro), nem a taxa', async () => {
    await definir(true, true)
    await passo8({ modos: ['balcao'], comanda_aberta_habilitada: true, taxa_servico_habilitada: true })
    assert.deepEqual(await estado(), { modos: ['balcao'], c: false, t: false })
  })

  test('taxa sozinha (sem a chave da comanda) é ignorada', async () => {
    await definir(false, false)
    await passo8({ modos: ['mesa'], taxa_servico_habilitada: true })
    assert.deepEqual(await estado(), { modos: ['mesa'], c: false, t: false })
  })

  test('validação de modos continua valendo', async () => {
    await assert.rejects(passo8({ modos: [] }), /modos_invalidos/)
    await assert.rejects(passo8({ modos: ['vale'] }), /modos_invalidos/)
    await assert.rejects(passo8({ comanda_aberta_habilitada: true }), /modos_invalidos/)
  })

  test('só o dono grava', async () => {
    await db.exec(`select set_config('test.uid', 'a9000000-0000-4000-8000-000000000009', false)`)
    await assert.rejects(passo8({ modos: ['mesa'] }), /sem acesso/)
    await db.exec(`select set_config('test.uid', '${DONO}', false)`)
  })
})
