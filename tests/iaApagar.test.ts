// Apagar a conversa da IA no CRM (LGPD): envio assinado, fila de retentativa no banco e a garantia de que o apagamento
// na Comanda não depende do CRM. Migration real no PGlite. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { corpoDoApagar, enviarApagarAoCrm, processarFilaApagar, type PedidoApagar } from '../supabase/functions/_shared/iaApagar.ts'

const SEGREDO = 'segredo-de-teste-da-plataforma'
const URL_CRM = 'https://crm.exemplo.com.br/api/integracao/comanda/v1/ia-apagar-conversas'
const AGORA = 1_800_000_000_000
const resposta = (status: number, corpo: unknown) => new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })
const sql = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), 'utf8')
const SERVICO = ['service', 'role'].join('_')

describe('corpoDoApagar', () => {
  test('por telefone ou loja inteira; qualquer outra forma é recusada (nunca vira exclusão em massa por engano)', () => {
    assert.equal(corpoDoApagar('ABCD23', '5511999990000'), '{"codigo_loja":"ABCD23","telefone":"5511999990000"}')
    assert.equal(corpoDoApagar('ABCD23', null), '{"codigo_loja":"ABCD23"}')
    for (const [c, t] of [['abcd23', null], ['ABCD2', '5511999990000'], ['ABCD23', ''], ['ABCD23', '123'], ['ABCD23', '(11) 99999']] as const) {
      assert.equal(corpoDoApagar(c, t), null, `${c} ${t}`)
    }
  })
})

describe('enviarApagarAoCrm', () => {
  test('POST assinado sobre o corpo exato, sem seguir redirect', async () => {
    let visto: { url: string; init: RequestInit } | null = null
    const r = await enviarApagarAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: '5511999990000' }, async (url, init) => {
      visto = { url: String(url), init: init as RequestInit }
      return resposta(200, { apagadas: 3 })
    }, AGORA)
    assert.deepEqual(r, { ok: true, apagadas: 3 })
    const v = visto as unknown as { url: string; init: RequestInit }
    const corpo = '{"codigo_loja":"ABCD23","telefone":"5511999990000"}'
    const ts = Math.floor(AGORA / 1000)
    assert.equal(v.init.method, 'POST')
    assert.equal(v.init.body, corpo)
    assert.equal(v.init.redirect, 'manual')
    const h = v.init.headers as Record<string, string>
    assert.equal(h['X-Saiae-Timestamp'], String(ts))
    assert.equal(h['X-Saiae-Signature'], 'sha256=' + createHmac('sha256', SEGREDO).update(`${ts}.${corpo}`).digest('hex'))
    assert.ok(!JSON.stringify(h).includes(SEGREDO))
  })

  test('apagadas:0 também é sucesso (idempotente)', async () => {
    const r = await enviarApagarAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: null }, async () => resposta(200, { apagadas: 0 }), AGORA)
    assert.deepEqual(r, { ok: true, apagadas: 0 })
  })

  test('não configurado ou URL insegura: não chama a rede e retenta depois; dados inválidos são definitivos', async () => {
    let chamou = false
    const f = async () => { chamou = true; return resposta(200, { apagadas: 0 }) }
    const base = { codigoLoja: 'ABCD23', telefone: null }
    for (const a of [{ url: undefined, segredo: SEGREDO }, { url: URL_CRM, segredo: undefined }, { url: 'http://crm.exemplo.com.br/x', segredo: SEGREDO }, { url: 'https://10.0.0.5/x', segredo: SEGREDO }]) {
      const r = await enviarApagarAoCrm({ ...base, ...a }, f)
      assert.deepEqual([r.ok, r.ok ? null : r.definitivo], [false, false])
    }
    const inval = await enviarApagarAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'x', telefone: null }, f)
    assert.deepEqual([inval.ok, inval.ok ? null : inval.definitivo], [false, true])
    assert.equal(chamou, false)
  })

  test('400 é definitivo; 401/413/503/500, redirect, formato errado e erro de rede são retentáveis', async () => {
    const chama = (f: () => Promise<Response>) => enviarApagarAoCrm({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23', telefone: '5511999990000' }, f, AGORA)
    const d = async (f: () => Promise<Response>) => { const r = await chama(f); return r.ok ? 'ok' : r.definitivo }
    assert.equal(await d(async () => resposta(400, '')), true)
    for (const f of [
      async () => resposta(401, ''), async () => resposta(413, ''), async () => resposta(503, ''), async () => resposta(500, ''),
      async () => resposta(302, ''), async () => resposta(200, { apagadas: 'x' }), async () => resposta(200, { apagadas: -1 }),
      async () => resposta(200, 'não é json'), async () => { throw new Error('ECONNRESET') },
    ]) assert.equal(await d(f), false)
  })
})

describe('processarFilaApagar', () => {
  const itens: PedidoApagar[] = [
    { id: '1', codigo_loja: 'ABCD23', telefone: '5511999990000' },
    { id: '2', codigo_loja: 'ABCD23', telefone: null },
    { id: '3', codigo_loja: 'EFGH45', telefone: '5521988887777' },
    { id: '4', codigo_loja: 'EFGH45', telefone: '5521977776666' },
  ]
  test('tira da fila o que o CRM confirmou e o que ele recusou em definitivo; o resto fica para a próxima rodada', async () => {
    const concluidos: string[] = []
    const r = await processarFilaApagar({
      pegar: async () => itens,
      concluir: async (id) => { concluidos.push(id) },
      enviar: async (p) =>
        p.id === '1' ? { ok: true, apagadas: 1 } : p.id === '2' ? { ok: false, definitivo: false, motivo: 'CRM respondeu 503' }
          : p.id === '3' ? { ok: false, definitivo: true, motivo: 'CRM respondeu 400' } : { ok: true, apagadas: 0 },
    })
    assert.deepEqual(concluidos, ['1', '3', '4'])
    assert.deepEqual(r, { enviados: 2, falhas: 2 })
  })

  test('nunca lança: fila indisponível, envio que explode e conclusão que falha', async () => {
    assert.deepEqual(await processarFilaApagar({ pegar: async () => { throw new Error('banco fora') }, concluir: async () => {}, enviar: async () => ({ ok: true, apagadas: 0 }) }), { enviados: 0, falhas: 0 })
    const r = await processarFilaApagar({
      pegar: async () => itens.slice(0, 2),
      concluir: async () => { throw new Error('x') },
      enviar: async () => { throw new Error('boom') },
    })
    assert.equal(r.enviados, 0)
    const r2 = await processarFilaApagar({ pegar: async () => itens.slice(0, 1), concluir: async () => { throw new Error('x') }, enviar: async () => ({ ok: true, apagadas: 1 }) })
    assert.equal(r2.enviados, 0)
  })
})

describe('fila no banco (migration real)', () => {
  let db: PGlite
  const B1 = 'b1000000-0000-4000-8000-000000000001'
  const B2 = 'b2000000-0000-4000-8000-000000000002'
  const C1 = 'c1000000-0000-4000-8000-000000000001'

  async function fila() {
    return (await db.query<{ codigo_loja: string; telefone: string | null; tentativas: number }>(
      'select codigo_loja, telefone, tentativas from public.ia_apagar_fila order by codigo_loja, telefone nulls first',
    )).rows
  }

  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated; create role anon; create role ${SERVICO};
      create table public.barracas (id uuid primary key, ia_codigo text);
      create table public.clientes_finais (id uuid primary key, barraca_id uuid, telefone text);
      create table public.pedidos (id uuid primary key default gen_random_uuid(), barraca_id uuid, cliente_id uuid, cliente_nome text,
        cliente_telefone text, entrega_nome text, entrega_telefone text, entrega_rua text, entrega_numero text, entrega_bairro text, entrega_referencia text);
      create table public.pagamentos_pendentes (id uuid primary key default gen_random_uuid(), barraca_id uuid, cliente_id uuid, cliente_nome text,
        cliente_telefone text, entrega jsonb);
      create table public.cliente_codigos (barraca_id uuid, telefone text);
      create table public.cliente_verificacoes_log (barraca_id uuid, telefone text);
      create table public.usuarios_barracas (usuario_id uuid, barraca_id uuid, papel text);
      insert into public.barracas values ('${B1}', 'ABCD23'), ('${B2}', null);
      insert into public.clientes_finais values ('${C1}', '${B1}', '11999990000'), ('c2000000-0000-4000-8000-000000000002', '${B2}', '11988887777');
      insert into public.pedidos (barraca_id, cliente_telefone, entrega_telefone) values ('${B1}', '21977776666', null), ('${B1}', null, '(31) 95555-4444');
    `)
    await db.exec(sql('20261019160000_ia_apagar_fila.sql'))
    await db.exec(sql('20261019160000_ia_apagar_fila.sql')) // re-executável
  })
  after(async () => { await db.close() })

  test('cliente_apagar_dados apaga localmente e enfileira o telefone (com 55) da loja que tem IA', async () => {
    await db.query(`select public.cliente_apagar_dados('${C1}')`)
    assert.equal((await db.query('select 1 from public.clientes_finais where id = $1', [C1])).rows.length, 0)
    assert.deepEqual(await fila(), [{ codigo_loja: 'ABCD23', telefone: '5511999990000', tentativas: 0 }])
  })

  test('repetir não duplica; loja SEM código da IA (nunca ligou) não enfileira nada', async () => {
    await db.query(`select public.ia_apagar_enfileirar('${B1}', '11999990000')`)
    await db.query(`select public.ia_apagar_enfileirar('${B2}', '11988887777')`)
    await db.query(`select public.ia_apagar_enfileirar('${B1}', '123')`)
    assert.equal((await fila()).length, 1)
  })

  test('a exclusão de conta enfileira a loja inteira E cada telefone conhecido (perfis e pedidos)', async () => {
    await db.query(`select public.ia_apagar_enfileirar_loja('${B1}')`)
    const f = await fila()
    assert.deepEqual(f.map((x) => x.telefone), [null, '5511999990000', '5521977776666', '5531955554444'])
    assert.ok(f.every((x) => x.codigo_loja === 'ABCD23'))
  })

  test('ia_apagar_pegar: devolve os vencidos, conta a tentativa e adia a próxima (backoff); concluir remove', async () => {
    const r = await db.query<{ id: string; codigo_loja: string; telefone: string | null }>('select * from public.ia_apagar_pegar(2)')
    assert.equal(r.rows.length, 2)
    assert.deepEqual((await db.query('select * from public.ia_apagar_pegar(10)')).rows.length, 2, 'só os outros 2 estavam vencidos')
    assert.equal((await db.query('select * from public.ia_apagar_pegar(10)')).rows.length, 0, 'todos adiados')
    const t = (await db.query<{ tentativas: number; adiado: boolean }>(`select tentativas, proxima_em > now() as adiado from public.ia_apagar_fila limit 1`)).rows[0]
    assert.equal(t.tentativas, 1)
    assert.equal(t.adiado, true)
    await db.query('select public.ia_apagar_concluir($1)', [r.rows[0].id])
    assert.equal((await fila()).length, 3)
  })

  test('pedido com mais de 14 dias é descartado (nada de telefone parado para sempre)', async () => {
    await db.exec(`update public.ia_apagar_fila set criado_em = now() - interval '15 days', proxima_em = now() - interval '1 minute'`)
    assert.equal((await db.query('select * from public.ia_apagar_pegar(10)')).rows.length, 0)
    assert.equal((await fila()).length, 0)
  })

  test('tabela e funções fechadas: só o papel de serviço executa; ninguém lê a fila pela API', async () => {
    const m = sql('20261019160000_ia_apagar_fila.sql').replace(/\r\n/g, '\n')
    assert.match(m, /alter table public\.ia_apagar_fila enable row level security;/)
    assert.match(m, /revoke all on public\.ia_apagar_fila from anon, authenticated;/)
    for (const f of ['ia_apagar_enfileirar\\(uuid, text\\)', 'ia_apagar_enfileirar_loja\\(uuid\\)', 'ia_apagar_pegar\\(integer\\)', 'ia_apagar_concluir\\(uuid\\)']) {
      assert.match(m, new RegExp(`revoke all on function public\\.${f} from public, anon, authenticated;`), f)
      assert.match(m, new RegExp(`grant execute on function public\\.${f} to service_role;`), f)
    }
    assert.doesNotMatch(m, /grant execute on function public\.ia_apagar\w+\([^)]*\) to (anon|authenticated)/)
  })

  test('excluir_dados_conta enfileira ANTES de apagar qualquer coisa da loja', () => {
    const m = sql('20261019160000_ia_apagar_fila.sql').replace(/\r\n/g, '\n')
    const f = m.slice(m.indexOf('create or replace function public.excluir_dados_conta'))
    assert.ok(f.indexOf('ia_apagar_enfileirar_loja(v_barraca)') > 0)
    assert.ok(f.indexOf('ia_apagar_enfileirar_loja(v_barraca)') < f.indexOf('delete from public.itens_do_pedido'))
    assert.ok(f.indexOf('ia_apagar_enfileirar_loja(v_barraca)') < f.indexOf('delete from public.barracas where'))
  })
})

describe('functions (guardas estáticas)', () => {
  const ler = (n: string) => readFileSync(new URL(`../supabase/functions/${n}/index.ts`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('cliente-sessao e excluir-conta: o CRM só é tentado DEPOIS do apagamento local e a falha é engolida', () => {
    const c = ler('cliente-sessao')
    assert.ok(c.indexOf("rpc('cliente_apagar_dados'") < c.indexOf('drenarFilaApagarIa('))
    assert.match(c, /if \(error\) return json\(\{ erro: 'Não foi possível apagar agora\. Tente de novo\.' \}, 500\)/)
    assert.match(c, /drenarFilaApagarIa\(supabase\)\.catch\(\(\) => undefined\)/)
    const e = ler('excluir-conta')
    assert.ok(e.indexOf("rpc('excluir_dados_conta'") < e.indexOf('drenarFilaApagarIa('))
    assert.ok(e.indexOf('drenarFilaApagarIa(') < e.indexOf('auth.admin.deleteUser'))
    assert.match(e, /drenarFilaApagarIa\(admin\)\.catch\(\(\) => undefined\)/)
  })

  test('ia-apagar-processar: sem segredo do job não existe; segredo errado = 401; log fixo', () => {
    const f = ler('ia-apagar-processar')
    assert.match(f, /if \(!segredo\) return new Response\(null, \{ status: 503 \}\)/)
    assert.match(f, /return new Response\(null, \{ status: 401 \}\)/)
    assert.match(f, /Deno\.env\.get\('IA_APAGAR_JOB_SEGREDO'\)/)
  })

  test('nenhum log carrega telefone, código ou corpo', () => {
    const arq = readFileSync(new URL('../supabase/functions/_shared/iaApagarSupabase.ts', import.meta.url), 'utf8')
    for (const l of arq.split('\n').filter((x) => /console\./.test(x))) assert.match(l.trim(), /^if \(r\.falhas > 0\) console\.error\('[^'$`]*'\)$/, l)
  })
})
