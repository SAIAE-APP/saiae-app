// Tokens cifrados em repouso (fase 1): cifra, leitura "cifrado, senão texto", token.ts e migration. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, mock, test } from 'node:test'
import { buscarSegredoWebhook, buscarTokenDoProvedor } from '../supabase/functions/_shared/pagamento/token.ts'
import { cifrar, configDoEnv, decifrar, lerSegredo, ErroSegredo } from '../supabase/functions/_shared/segredoCifrado.ts'

const K1 = Buffer.alloc(32, 1).toString('base64')
const K2 = Buffer.alloc(32, 2).toString('base64')
const envDe = (m: Record<string, string>) => ({ get: (n: string) => m[n] })
const ctx = { barracaId: 'b1', campo: 'access_token' }
const SEGREDO = 'APP_USR-1234567890-token-de-teste'

describe('cifrar / decifrar', () => {
  const cfg = configDoEnv(envDe({ TOKENS_CHAVE_V1: K1 }))

  test('ida e volta; o valor guardado não contém o token e muda a cada cifra (IV novo)', async () => {
    const a = await cifrar(SEGREDO, ctx, cfg)
    const b = await cifrar(SEGREDO, ctx, cfg)
    assert.match(a.valor, /^v1\.[\w-]+\.[\w-]+$/)
    assert.ok(!a.valor.includes(SEGREDO))
    assert.notEqual(a.valor, b.valor)
    assert.equal(a.kid, '1')
    assert.equal(await decifrar(a.valor, ctx, cfg), SEGREDO)
  })

  test('AAD: outra loja ou outro campo não decifra', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    await assert.rejects(decifrar(valor, { ...ctx, barracaId: 'b2' }, cfg), { codigo: 'falha_decifrar' })
    await assert.rejects(decifrar(valor, { ...ctx, campo: 'segredo_webhook' }, cfg), { codigo: 'falha_decifrar' })
  })

  test('chave errada, adulterado, formato ruim e versão desconhecida falham com código', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    await assert.rejects(decifrar(valor, ctx, configDoEnv(envDe({ TOKENS_CHAVE_V1: K2 }))), { codigo: 'falha_decifrar' })
    const partes = valor.split('.')
    const adulterado = [partes[0], partes[1], (partes[2][0] === 'A' ? 'B' : 'A') + partes[2].slice(1)].join('.')
    await assert.rejects(decifrar(adulterado, ctx, cfg), { codigo: 'falha_decifrar' })
    await assert.rejects(decifrar('lixo', ctx, cfg), { codigo: 'formato_invalido' })
    await assert.rejects(decifrar(valor.replace(/^v1/, 'v2'), ctx, cfg), { codigo: 'versao_desconhecida' })
    await assert.rejects(decifrar(valor, ctx, configDoEnv(envDe({}))), { codigo: 'sem_chave' })
  })

  test('chave que não tem 32 bytes é recusada; sem chave não cifra', async () => {
    const curta = configDoEnv(envDe({ TOKENS_CHAVE_V1: Buffer.alloc(16, 1).toString('base64') }))
    await assert.rejects(cifrar(SEGREDO, ctx, curta), (e: unknown) => e instanceof ErroSegredo && e.codigo === 'chave_invalida')
    await assert.rejects(cifrar(SEGREDO, ctx, configDoEnv(envDe({}))), { codigo: 'sem_chave' })
  })

  test('rotação: V2 cifra, e valores da V1 continuam decifrando enquanto a V1 estiver configurada', async () => {
    const so1 = configDoEnv(envDe({ TOKENS_CHAVE_V1: K1 }))
    const velho = (await cifrar(SEGREDO, ctx, so1)).valor
    const dupla = configDoEnv(envDe({ TOKENS_CHAVE_V1: K1, TOKENS_CHAVE_V2: K2 }))
    assert.equal(dupla.atual, '2')
    const novo = await cifrar(SEGREDO, ctx, dupla)
    assert.match(novo.valor, /^v2\./)
    assert.equal(await decifrar(velho, ctx, dupla), SEGREDO)
    assert.equal(await decifrar(novo.valor, ctx, dupla), SEGREDO)
    assert.equal(configDoEnv(envDe({ TOKENS_CHAVE_V1: K1, TOKENS_CHAVE_V2: K2, TOKENS_CHAVE_ATUAL: '1' })).atual, '1')
  })
})

describe('lerSegredo: cifrado, senão texto', () => {
  const cfg = configDoEnv(envDe({ TOKENS_CHAVE_V1: K1 }))
  const semChave = configDoEnv(envDe({}))

  test('sem cifrado: devolve o texto, ou nenhum', async () => {
    assert.deepEqual(await lerSegredo({ texto: 't' }, ctx, semChave), { valor: 't', origem: 'texto' })
    assert.deepEqual(await lerSegredo({ texto: null, cifrado: null }, ctx, cfg), { valor: null, origem: 'nenhum' })
    assert.deepEqual(await lerSegredo({ texto: '', cifrado: '' }, ctx, cfg), { valor: null, origem: 'nenhum' })
  })

  test('cifrado válido vence o texto', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    assert.deepEqual(await lerSegredo({ texto: 'velho', cifrado: valor }, ctx, cfg), { valor: SEGREDO, origem: 'cifrado' })
  })

  test('cifrado inutilizável (sem chave, chave errada, corrompido): usa o texto e avisa só o código', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    const casos: Array<[string, typeof cfg, string]> = [
      ['sem chave', semChave, 'sem_chave'],
      ['chave errada', configDoEnv(envDe({ TOKENS_CHAVE_V1: K2 })), 'falha_decifrar'],
    ]
    for (const [nome, c, codigo] of casos) {
      const avisos: unknown[][] = []
      const r = await lerSegredo({ texto: 'velho', cifrado: valor }, ctx, c, { aviso: (...a) => avisos.push(a) })
      assert.deepEqual(r, { valor: 'velho', origem: 'texto', erro: codigo }, nome)
      assert.deepEqual(avisos, [[codigo, 'access_token']], nome)
    }
    const r2 = await lerSegredo({ texto: 'velho', cifrado: 'corrompido' }, ctx, cfg, { aviso: () => {} })
    assert.equal(r2.valor, 'velho')
    assert.equal(r2.erro, 'formato_invalido')
  })

  test('cifrado inutilizável e SEM texto: null com o código (nunca lança)', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    const r = await lerSegredo({ texto: null, cifrado: valor }, ctx, semChave, { aviso: () => {} })
    assert.deepEqual(r, { valor: null, origem: 'nenhum', erro: 'sem_chave' })
  })

  test('o aviso padrão (console.warn) não traz token, texto, valor cifrado nem chave', async () => {
    const { valor } = await cifrar(SEGREDO, ctx, cfg)
    const chamadas: unknown[][] = []
    mock.method(console, 'warn', (...a: unknown[]) => chamadas.push(a))
    await lerSegredo({ texto: 'texto-velho', cifrado: valor }, ctx, semChave)
    mock.restoreAll()
    const saida = JSON.stringify(chamadas)
    assert.ok(saida.includes('sem_chave'))
    for (const proibido of [SEGREDO, 'texto-velho', valor, K1]) assert.ok(!saida.includes(proibido))
  })
})

/** Supabase falso mínimo de token.ts: select('*').eq('barraca_id') → linhas. */
const clienteCom = (linhas: Record<string, unknown>[]) => ({
  from: () => ({ select: () => ({ eq: async () => ({ data: linhas, error: null }) }) }),
})

describe('token.ts (Pix) lê "cifrado, senão texto"', () => {
  const cfg = configDoEnv(envDe({ TOKENS_CHAVE_V1: K1 }))
  const env = envDe({ TOKENS_CHAVE_V1: K1 })

  test('sem env (chamadas antigas) e só texto: igual a antes', async () => {
    const c = clienteCom([{ barraca_id: 'b1', access_token: 'tk', segredo_webhook: 'sg' }])
    assert.equal(await buscarTokenDoProvedor(c, 'b1', 'mercadopago'), 'tk')
    assert.equal(await buscarSegredoWebhook(c, 'b1', 'mercadopago'), 'sg')
  })

  test('só cifrado com chave: decifra token e segredo', async () => {
    const t = (await cifrar('tok-real', { barracaId: 'b1', campo: 'access_token' }, cfg)).valor
    const s = (await cifrar('seg-real', { barracaId: 'b1', campo: 'segredo_webhook' }, cfg)).valor
    const c = clienteCom([{ barraca_id: 'b1', access_token: null, access_token_cifrado: t, segredo_webhook: null, segredo_webhook_cifrado: s }])
    assert.equal(await buscarTokenDoProvedor(c, 'b1', 'mercadopago', env), 'tok-real')
    assert.equal(await buscarSegredoWebhook(c, 'b1', 'mercadopago', env), 'seg-real')
  })

  test('cifrado + texto sem chave configurada: usa o texto, o Pix continua', async () => {
    const t = (await cifrar('tok-real', { barracaId: 'b1', campo: 'access_token' }, cfg)).valor
    mock.method(console, 'warn', () => {})
    const c = clienteCom([{ barraca_id: 'b1', access_token: 'tok-texto', access_token_cifrado: t }])
    assert.equal(await buscarTokenDoProvedor(c, 'b1', 'mercadopago', envDe({})), 'tok-texto')
    mock.restoreAll()
  })

  test('só cifrado sem chave, linha de outro provedor e erro de banco: null', async () => {
    const t = (await cifrar('tok-real', { barracaId: 'b1', campo: 'access_token' }, cfg)).valor
    mock.method(console, 'warn', () => {})
    assert.equal(await buscarTokenDoProvedor(clienteCom([{ barraca_id: 'b1', access_token_cifrado: t }]), 'b1', 'mercadopago', envDe({})), null)
    mock.restoreAll()
    assert.equal(await buscarTokenDoProvedor(clienteCom([{ barraca_id: 'b1', provedor: 'asaas', access_token: 'x' }]), 'b1', 'mercadopago', env), null)
    const quebrado = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: 'x' } }) }) }) }
    assert.equal(await buscarTokenDoProvedor(quebrado, 'b1', 'mercadopago', env), null)
  })

  test('cifrado de outra loja não decifra (AAD)', async () => {
    const deOutra = (await cifrar('tok-outra', { barracaId: 'b2', campo: 'access_token' }, cfg)).valor
    mock.method(console, 'warn', () => {})
    assert.equal(await buscarTokenDoProvedor(clienteCom([{ barraca_id: 'b1', access_token_cifrado: deOutra }]), 'b1', 'mercadopago', env), null)
    mock.restoreAll()
  })
})

describe('migration 20261027100000 (aditiva)', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261027100000_tokens_cifrados_colunas.sql', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^--.*$/gm, '')

  test('só acrescenta colunas e afrouxa NOT NULL; nada é apagado nem atualizado', () => {
    assert.ok(!/\b(drop\s+(table|column|function)|delete\s+from|truncate|update\s+\w)/i.test(sql))
    for (const col of ['token_homologacao_cifrado', 'token_producao_cifrado', 'access_token_cifrado', 'segredo_webhook_cifrado', 'cifrado_em', 'cifrado_chave']) {
      assert.match(sql, new RegExp(`add column if not exists ${col}\\b`))
    }
  })

  test('"configurado" considera texto OU cifrado nas três funções, com checagem de acesso', () => {
    assert.match(sql, /token_homologacao is not null or token_homologacao_cifrado is not null/)
    assert.match(sql, /token_producao is not null or token_producao_cifrado is not null/)
    assert.match(sql, /access_token is not null or access_token_cifrado is not null/)
    assert.match(sql, /segredo_webhook is not null or segredo_webhook_cifrado is not null/)
    assert.equal((sql.match(/security definer/g) ?? []).length, 3)
    assert.equal((sql.match(/usuario_tem_acesso_barraca\(p_barraca_id\)/g) ?? []).length, 3)
  })
})

describe('migration 20261027100000 executada no PGlite (tabelas no formato atual)', () => {
  test('colunas novas, NOT NULL afrouxado e as 3 funções "configurado" enxergam o cifrado', async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const db = new PGlite()
    try {
      await db.exec(`
        create table public.barracas_fiscal_token (barraca_id uuid primary key, token_homologacao text not null, token_producao text, atualizado_em timestamptz default now());
        create table public.barracas_pagamento_token (barraca_id uuid, provedor text not null default 'mercadopago', access_token text not null, segredo_webhook text, atualizado_em timestamptz default now(), primary key (barraca_id, provedor));
        create function public.usuario_tem_acesso_barraca(p uuid) returns boolean language sql as $$ select true $$;
        insert into public.barracas_fiscal_token values ('00000000-0000-0000-0000-000000000001', 'h', null, now());
        insert into public.barracas_pagamento_token (barraca_id, access_token) values ('00000000-0000-0000-0000-000000000001', 'tk');
      `)
      await db.exec(readFileSync(new URL('../supabase/migrations/20261027100000_tokens_cifrados_colunas.sql', import.meta.url), 'utf8'))
      await db.exec(readFileSync(new URL('../supabase/migrations/20261027100000_tokens_cifrados_colunas.sql', import.meta.url), 'utf8')) // reaplicar não quebra
      const b1 = '00000000-0000-0000-0000-000000000001'
      const b2 = '00000000-0000-0000-0000-000000000002'
      // Estado de hoje (só texto) continua igual.
      const f1 = await db.query<{ homologacao: boolean; producao: boolean }>(`select * from token_fiscal_configurado('${b1}')`)
      assert.deepEqual(f1.rows[0], { homologacao: true, producao: false })
      assert.equal((await db.query<{ r: boolean }>(`select token_pagamento_configurado('${b1}') r`)).rows[0].r, true)
      assert.equal((await db.query<{ r: boolean }>(`select segredo_webhook_configurado('${b1}') r`)).rows[0].r, false)
      // Linha só com cifrado (texto nulo) passa a contar.
      await db.exec(`
        insert into public.barracas_fiscal_token (barraca_id, token_homologacao, token_producao_cifrado) values ('${b2}', null, 'v1.x.y');
        insert into public.barracas_pagamento_token (barraca_id, access_token, access_token_cifrado, segredo_webhook_cifrado) values ('${b2}', null, 'v1.x.y', 'v1.x.y');`)
      const f2 = await db.query<{ homologacao: boolean; producao: boolean }>(`select * from token_fiscal_configurado('${b2}')`)
      assert.deepEqual(f2.rows[0], { homologacao: false, producao: true })
      assert.equal((await db.query<{ r: boolean }>(`select token_pagamento_configurado('${b2}') r`)).rows[0].r, true)
      assert.equal((await db.query<{ r: boolean }>(`select segredo_webhook_configurado('${b2}') r`)).rows[0].r, true)
      // Nada do que já existia mudou.
      assert.equal((await db.query<{ t: string }>(`select token_homologacao t from barracas_fiscal_token where barraca_id='${b1}'`)).rows[0].t, 'h')
    } finally {
      await db.close()
    }
  })
})
