/* eslint-disable @typescript-eslint/no-explicit-any -- banco simulado dos testes */
// salvar-credencial (fase 2 dos tokens cifrados): EXECUTA o handler real com banco simulado. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, mock, test } from 'node:test'
import { LIMITE_GRAVACOES_HORA, tratarSalvarCredencial } from '../supabase/functions/_shared/salvarCredencial.ts'
import { configDoEnv, decifrar } from '../supabase/functions/_shared/segredoCifrado.ts'
import { lerSegredo } from '../supabase/functions/_shared/segredoCifrado.ts'

const CHAVE = Buffer.alloc(32, 5).toString('base64')
const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'TOKEN-SECRETO-DE-TESTE-123'

type Linha = Record<string, any>
function criarBanco() {
  const tabelas: Record<string, Linha[]> = {
    // u1 é dono da B1. "suporte" NÃO tem linha aqui (é o desenho do acesso de suporte).
    usuarios_barracas: [{ usuario_id: 'u1', barraca_id: B1 }, { usuario_id: 'u2', barraca_id: B2 }],
    acessos_suporte: [{ usuario_id: 'suporte', barraca_id: B1, ativo: true }],
    superadmins: [{ usuario_id: 'admin' }],
    barracas_fiscal_token: [],
    barracas_pagamento_token: [],
  }
  const estado = { limiteNegado: false, limiteErro: false, falharGravacao: false, superadminsErro: false, rpcs: [] as any[] }
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = []
    let op: 'select' | 'update' = 'select'
    let valores: Linha = {}
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      update: (v: Linha) => ((op = 'update'), (valores = v), q),
      maybeSingle: () => tabela === 'superadmins' && estado.superadminsErro ? Promise.resolve({ data: null, error: { message: 'queda' } }) : Promise.resolve({ data: tabelas[tabela].find((r) => filtros.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      upsert: (linha: Linha, opcoes: { onConflict: string }) => {
        if (estado.falharGravacao) return Promise.resolve({ data: null, error: { message: 'queda' } })
        const chaves = opcoes.onConflict.split(',')
        const ex = tabelas[tabela].find((r) => chaves.every((c) => r[c] === linha[c]))
        if (ex) Object.assign(ex, linha)
        else tabelas[tabela].push({ ...linha })
        return Promise.resolve({ data: null, error: null })
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (op !== 'update') return Promise.resolve({ data: null, error: null }).then(ok, ko)
        if (estado.falharGravacao) return Promise.resolve({ data: null, error: { message: 'queda' } }).then(ok, ko)
        const alvo = tabelas[tabela].filter((r) => filtros.every(([c, v]) => r[c] === v))
        alvo.forEach((r) => Object.assign(r, valores))
        return Promise.resolve({ data: alvo.map((r) => ({ barraca_id: r.barraca_id })), error: null }).then(ok, ko)
      },
    }
    return q
  }
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    estado.rpcs.push({ nome, args })
    if (estado.limiteErro) return { data: null, error: { message: 'x' } }
    return { data: !estado.limiteNegado, error: null }
  }
  return { tabelas, estado, supabase: { from, rpc } }
}

function montar(env: Record<string, string> = { TOKENS_CHAVE_V1: CHAVE }) {
  const banco = criarBanco()
  const usuarios: Record<string, { id: string }> = { 'jwt-u1': { id: 'u1' }, 'jwt-u2': { id: 'u2' }, 'jwt-suporte': { id: 'suporte' }, 'jwt-admin': { id: 'admin' } }
  const cfg = configDoEnv({ get: (n) => env[n] })
  const chamar = async (corpo: unknown, jwt: string | null = 'jwt-u1') => {
    const res = await tratarSalvarCredencial(
      new Request('http://local/salvar-credencial', {
        method: 'POST',
        headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      }),
      { autenticar: async (j) => usuarios[j] ?? null, supabase: banco.supabase as any, env: { get: (n) => env[n] }, agora: () => Date.parse('2026-10-27T12:00:00Z') },
    )
    const texto = await res.text()
    return { status: res.status, corpo: JSON.parse(texto) as Record<string, any>, texto }
  }
  return { banco, chamar, cfg }
}

describe('salvar-credencial', () => {
  test('fiscal: grava SÓ o cifrado do ambiente, zera o texto desse ambiente e não toca no outro', async () => {
    const { banco, chamar, cfg } = montar()
    banco.tabelas.barracas_fiscal_token.push({ barraca_id: B1, token_homologacao: 'texto-h', token_producao: 'texto-p' })
    const r = await chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'producao', valor: `  ${TOKEN}  ` })
    assert.equal(r.status, 200)
    assert.deepEqual(r.corpo, { ok: true })
    const linha = banco.tabelas.barracas_fiscal_token[0]
    assert.equal(linha.token_producao, null)
    assert.equal(linha.token_homologacao, 'texto-h', 'o outro ambiente não é tocado')
    assert.equal(linha.token_homologacao_cifrado, undefined)
    assert.ok(!JSON.stringify(linha).includes(TOKEN))
    assert.equal(await decifrar(linha.token_producao_cifrado, { barracaId: B1, campo: 'token_producao' }, cfg), TOKEN)
    assert.equal(linha.cifrado_em, '2026-10-27T12:00:00.000Z')
    assert.equal(linha.cifrado_chave, '1')
  })

  test('pagamento: depois do corte (CORTE_TOKEN_MP_ISO) recusa token colado novo; antes do corte grava como antes', async () => {
    const depois = montar({ TOKENS_CHAVE_V1: CHAVE, CORTE_TOKEN_MP_ISO: '2026-10-20T00:00:00Z' })
    const r = await depois.chamar({ barraca_id: B1, tipo: 'pagamento', provedor: 'mercadopago', valor: TOKEN })
    assert.equal(r.status, 409)
    assert.equal(r.corpo.codigo, 'mp_conectar_oauth')
    assert.equal(depois.banco.tabelas.barracas_pagamento_token.length, 0)
    assert.ok(!r.texto.includes(TOKEN))

    const antes = montar({ TOKENS_CHAVE_V1: CHAVE, CORTE_TOKEN_MP_ISO: '2026-12-01T00:00:00Z' })
    assert.equal((await antes.chamar({ barraca_id: B1, tipo: 'pagamento', provedor: 'mercadopago', valor: TOKEN })).status, 200)
    assert.equal(antes.banco.tabelas.barracas_pagamento_token.length, 1)

    const fiscal = montar({ TOKENS_CHAVE_V1: CHAVE, CORTE_TOKEN_MP_ISO: '2026-10-20T00:00:00Z' })
    assert.equal((await fiscal.chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'producao', valor: TOKEN })).status, 200, 'o corte só vale para o token do Mercado Pago')
  })

  test('fiscal em loja sem linha: cria a linha só com o cifrado', async () => {
    const { banco, chamar, cfg } = montar()
    assert.equal((await chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN })).status, 200)
    const linha = banco.tabelas.barracas_fiscal_token[0]
    assert.equal(linha.token_homologacao, null)
    assert.equal(await decifrar(linha.token_homologacao_cifrado, { barracaId: B1, campo: 'token_homologacao' }, cfg), TOKEN)
  })

  test('pagamento: cifra o token por provedor e mantém o segredo do webhook existente', async () => {
    const { banco, chamar, cfg } = montar()
    banco.tabelas.barracas_pagamento_token.push({ barraca_id: B1, provedor: 'mercadopago', access_token: 'velho', segredo_webhook: 'seg-antigo' })
    assert.equal((await chamar({ barraca_id: B1, tipo: 'pagamento', provedor: 'mercadopago', valor: TOKEN })).status, 200)
    const linha = banco.tabelas.barracas_pagamento_token[0]
    assert.equal(linha.access_token, null)
    assert.equal(linha.segredo_webhook, 'seg-antigo')
    assert.equal(await decifrar(linha.access_token_cifrado, { barracaId: B1, campo: 'access_token' }, cfg), TOKEN)
    // E a leitura real (token.ts usa lerSegredo) devolve o novo valor.
    const leitura = await lerSegredo({ texto: linha.access_token, cifrado: linha.access_token_cifrado }, { barracaId: B1, campo: 'access_token' }, cfg)
    assert.deepEqual(leitura, { valor: TOKEN, origem: 'cifrado' })
  })

  test('segredo do webhook: só depois do token do provedor (409), e então grava cifrado', async () => {
    const { banco, chamar, cfg } = montar()
    const sem = await chamar({ barraca_id: B1, tipo: 'segredo_webhook', provedor: 'mercadopago', valor: 'seg' })
    assert.equal(sem.status, 409)
    banco.tabelas.barracas_pagamento_token.push({ barraca_id: B1, provedor: 'mercadopago', access_token: null, access_token_cifrado: 'v1.x.y', segredo_webhook: 'seg-velho' })
    assert.equal((await chamar({ barraca_id: B1, tipo: 'segredo_webhook', provedor: 'mercadopago', valor: 'seg-novo' })).status, 200)
    const linha = banco.tabelas.barracas_pagamento_token[0]
    assert.equal(linha.segredo_webhook, null)
    assert.equal(await decifrar(linha.segredo_webhook_cifrado, { barracaId: B1, campo: 'segredo_webhook' }, cfg), 'seg-novo')
    assert.equal(linha.access_token_cifrado, 'v1.x.y', 'o token não é tocado')
  })

  test('superadmin sem vínculo grava token fiscal de homologação e de produção cifrados', async () => {
    const { banco, chamar, cfg } = montar()
    for (const [ambiente, campo] of [['homologacao', 'token_homologacao'], ['producao', 'token_producao']] as const) {
      const r = await chamar({ barraca_id: B2, tipo: 'fiscal', ambiente, valor: TOKEN }, 'jwt-admin')
      assert.equal(r.status, 200)
      assert.ok(!r.texto.includes(TOKEN))
      const linha = banco.tabelas.barracas_fiscal_token.find((l) => l.barraca_id === B2)!
      assert.equal(linha[campo], null)
      assert.equal(await decifrar(linha[`${campo}_cifrado`], { barracaId: B2, campo }, cfg), TOKEN)
    }
  })

  test('superadmin sem vínculo recebe 403 para tipo pagamento', async () => {
    const { banco, chamar } = montar()
    assert.equal((await chamar({ barraca_id: B2, tipo: 'pagamento', provedor: 'mercadopago', valor: TOKEN }, 'jwt-admin')).status, 403)
    assert.equal((await chamar({ barraca_id: B2, tipo: 'segredo_webhook', provedor: 'mercadopago', valor: TOKEN }, 'jwt-admin')).status, 403)
    assert.equal(banco.tabelas.barracas_pagamento_token.length, 0)
  })

  test('usuário comum sem vínculo continua 403 no fiscal; falha ao consultar superadmins também (fail closed)', async () => {
    mock.method(console, 'error', () => {})
    const { banco, chamar } = montar()
    const corpo = { barraca_id: B1, tipo: 'fiscal', ambiente: 'producao', valor: TOKEN }
    assert.equal((await chamar(corpo, 'jwt-u2')).status, 403)
    banco.estado.superadminsErro = true
    assert.equal((await chamar({ ...corpo, barraca_id: B2 }, 'jwt-admin')).status, 403)
    mock.restoreAll()
    assert.equal(banco.tabelas.barracas_fiscal_token.length, 0)
  })

  test('acesso de suporte continua sem gravar (inclusive fiscal)', async () => {
    const { banco, chamar } = montar()
    assert.equal((await chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN }, 'jwt-suporte')).status, 403)
    assert.equal(banco.tabelas.barracas_fiscal_token.length, 0)
  })

  test('SEM chave: 503, nada gravado e nada em texto', async () => {
    mock.method(console, 'error', () => {})
    const { banco, chamar } = montar({})
    const r = await chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN })
    mock.restoreAll()
    assert.equal(r.status, 503)
    assert.equal(banco.tabelas.barracas_fiscal_token.length, 0)
    assert.ok(!r.texto.includes(TOKEN))
  })

  test('autenticação e acesso: sem JWT 401; outra loja 403; SUPORTE ativo 403 (nunca grava credencial)', async () => {
    const { banco, chamar } = montar()
    const corpo = { barraca_id: B1, tipo: 'pagamento', provedor: 'mercadopago', valor: TOKEN }
    assert.equal((await chamar(corpo, null)).status, 401)
    assert.equal((await chamar(corpo, 'jwt-invalido')).status, 401)
    assert.equal((await chamar(corpo, 'jwt-u2')).status, 403)
    assert.equal((await chamar(corpo, 'jwt-suporte')).status, 403)
    assert.equal(banco.tabelas.barracas_pagamento_token.length, 0)
    assert.equal(banco.estado.rpcs.length, 0, 'nem consome o limite antes de checar acesso')
  })

  test('validação: json ruim, tipo, ambiente, provedor, valor vazio ou enorme, barraca_id malformado', async () => {
    const { banco, chamar } = montar()
    assert.equal((await chamar('{nao-json')).status, 400)
    const base = { barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN }
    for (const ruim of [
      { ...base, tipo: 'senha' },
      { ...base, ambiente: 'teste' },
      { ...base, ambiente: undefined },
      { ...base, valor: '   ' },
      { ...base, valor: 123 },
      { ...base, valor: 'x'.repeat(5000) },
      { ...base, barraca_id: "x'; drop table" },
      { barraca_id: B1, tipo: 'pagamento', provedor: 'paypal', valor: TOKEN },
    ]) {
      assert.equal((await chamar(ruim)).status, 400, JSON.stringify(ruim).slice(0, 60))
    }
    assert.equal(banco.tabelas.barracas_fiscal_token.length + banco.tabelas.barracas_pagamento_token.length, 0)
  })

  test('limite por hora: 429 quando excedido, 503 se o contador falha; nada é gravado', async () => {
    mock.method(console, 'error', () => {})
    const { banco, chamar } = montar()
    const corpo = { barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN }
    banco.estado.limiteNegado = true
    assert.equal((await chamar(corpo)).status, 429)
    banco.estado.limiteNegado = false
    banco.estado.limiteErro = true
    assert.equal((await chamar(corpo)).status, 503)
    mock.restoreAll()
    assert.equal(banco.tabelas.barracas_fiscal_token.length, 0)
    assert.deepEqual(banco.estado.rpcs[0], { nome: 'consulta_externa_registrar', args: { p_usuario_id: 'u1', p_tipo: 'salvar_credencial', p_limite: LIMITE_GRAVACOES_HORA } })
  })

  test('falha ao gravar: 500 genérico, sem vazar valor nem detalhe; o log tem só o motivo curto', async () => {
    const logs: unknown[][] = []
    mock.method(console, 'error', (...a: unknown[]) => logs.push(a))
    const { banco, chamar } = montar()
    banco.estado.falharGravacao = true
    const r = await chamar({ barraca_id: B1, tipo: 'fiscal', ambiente: 'homologacao', valor: TOKEN })
    mock.restoreAll()
    assert.equal(r.status, 500)
    assert.ok(!r.texto.includes('queda') && !r.texto.includes(TOKEN))
    assert.ok(!JSON.stringify(logs).includes(TOKEN) && !JSON.stringify(logs).includes(CHAVE))
  })

  test('OPTIONS responde ok; GET é 405', async () => {
    const { banco } = montar()
    const deps = { autenticar: async () => null, supabase: banco.supabase as any, env: { get: () => undefined } }
    assert.equal((await tratarSalvarCredencial(new Request('http://l/', { method: 'OPTIONS' }), deps)).status, 200)
    assert.equal((await tratarSalvarCredencial(new Request('http://l/', { method: 'GET' }), deps)).status, 405)
  })
})

describe('guardas estáticos', () => {
  const ler = (c: string) => readFileSync(new URL(c, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const handler = ler('../supabase/functions/_shared/salvarCredencial.ts')
  const ajustes = ler('../src/pages/Ajustes.tsx')

  test('o suporte não grava: o handler não consulta acesso de suporte e só aceita usuarios_barracas', () => {
    assert.ok(!/acessos?_suporte|acesso_suporte_ativo|usuarios_suporte/.test(handler.replace(/^\s*\/\/.*$/gm, '')))
    assert.match(handler, /from\('usuarios_barracas'\)/)
  })

  test('o front não chama mais as RPCs que gravam em texto; passa pela função', () => {
    for (const rpc of ['definir_token_fiscal', 'definir_token_pagamento', 'definir_segredo_webhook_pagamento']) {
      assert.ok(!ajustes.includes(`rpc('${rpc}'`), rpc)
    }
    assert.equal((ajustes.match(/salvarCredencial\(\{/g) ?? []).length, 2) // fiscal saiu do app: o token fiscal é cadastrado pelo Sai aê
  })

  test('nenhum console.* do handler recebe o valor ou a chave', () => {
    for (const m of handler.matchAll(/console\.\w+\(([^)]*)\)/g)) assert.ok(!/\bvalor\b|corpo|CHAVE|cifrado\.valor/.test(m[1]), m[0])
  })
})
