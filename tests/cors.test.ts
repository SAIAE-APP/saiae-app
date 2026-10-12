/* eslint-disable @typescript-eslint/no-explicit-any -- dependências simuladas dos handlers */
// CORS com allowlist nas edge functions autenticadas (auditoria B8). Os handlers são EXECUTADOS (origem permitida
// ecoa; desconhecida não ecoa; OPTIONS ok; Vary: Origin). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ORIGENS_PADRAO, comCors, corsHeaders, origensPermitidas } from '../supabase/functions/_shared/cors.ts'
import { tratarExcluirConta } from '../supabase/functions/_shared/excluirConta.ts'
import { tratarCancelarAssinatura, tratarCriarCheckout } from '../supabase/functions/_shared/stripeAssinatura.ts'
import { criarHandler } from '../supabase/functions/emitir-nfce/handler.ts'

const ACAO = 'Access-Control-Allow-Origin'
const req = (origem: string | null, metodo = 'POST', corpo: string | undefined = 'não é json') =>
  new Request('https://x.test/fn', {
    method: metodo,
    headers: origem ? { Origin: origem } : {},
    body: metodo === 'POST' ? corpo : undefined,
  })

const SEM_LOGIN = { autenticar: async () => null } as any

const handlers: Record<string, (r: Request) => Promise<Response>> = {
  'excluir-conta': (r) => tratarExcluirConta(r, SEM_LOGIN),
  'criar-checkout-stripe': (r) => tratarCriarCheckout(r, SEM_LOGIN),
  'cancelar-assinatura-stripe': (r) => tratarCancelarAssinatura(r, SEM_LOGIN),
  'emitir-nfce': criarHandler({
    criarCliente: (() => ({})) as any,
    env: { get: () => undefined } as any,
    buscar: (() => Promise.reject(new Error('sem rede'))) as any,
    agora: () => 0,
    esperar: async () => {},
  } as any),
}

describe('lista de origens', () => {
  test('sem ALLOWED_ORIGINS vale o padrão (app, Android, dev/staging)', () => {
    for (const vazio of [undefined, null, '', '  ', ' , ']) assert.deepEqual(origensPermitidas(vazio), ORIGENS_PADRAO)
    for (const o of [
      'https://app.saiae.com.br',
      'https://localhost',
      'capacitor://localhost',
      'http://localhost:5173',
      'http://127.0.0.1:5199',
    ]) {
      assert.ok(ORIGENS_PADRAO.includes(o), o)
    }
  })
  test('ALLOWED_ORIGINS definida substitui o padrão; barra final e "*" são ignorados', () => {
    assert.deepEqual(origensPermitidas('https://a.com/, https://b.com ,*'), ['https://a.com', 'https://b.com'])
  })
})

describe('corsHeaders', () => {
  test('origem permitida ecoa; Vary: Origin sempre', () => {
    const h = corsHeaders(req('https://app.saiae.com.br'), undefined)
    assert.equal(h[ACAO], 'https://app.saiae.com.br')
    assert.equal(h.Vary, 'Origin')
  })
  test('origem desconhecida ou ausente não recebe Allow-Origin', () => {
    assert.equal(corsHeaders(req('https://malicioso.example'), undefined)[ACAO], undefined)
    assert.equal(corsHeaders(req(null), undefined)[ACAO], undefined)
    assert.equal(corsHeaders(req('https://app.saiae.com.br.malicioso.example'), undefined)[ACAO], undefined)
  })
  test('ambiente customizado vale no lugar do padrão', () => {
    assert.equal(corsHeaders(req('https://novo.example'), 'https://novo.example')[ACAO], 'https://novo.example')
    assert.equal(corsHeaders(req('https://app.saiae.com.br'), 'https://novo.example')[ACAO], undefined)
  })
})

describe('comCors', () => {
  test('troca o "*" do handler pela origem e preserva status e corpo', async () => {
    const r = await comCors(req('https://localhost'), new Response('{"a":1}', { status: 418, headers: { [ACAO]: '*', 'Content-Type': 'application/json' } }), undefined)
    assert.equal(r.status, 418)
    assert.equal(r.headers.get(ACAO), 'https://localhost')
    assert.equal(r.headers.get('Content-Type'), 'application/json')
    assert.equal(await r.text(), '{"a":1}')
  })
  test('origem desconhecida: "*" do handler é removido', async () => {
    const r = await comCors(req('https://x.example'), new Response('ok', { headers: { [ACAO]: '*' } }), undefined)
    assert.equal(r.headers.get(ACAO), null)
  })
  test('Vary existente é mantido e ganha Origin', async () => {
    const r = await comCors(req(null), new Response('ok', { headers: { Vary: 'Accept-Encoding' } }), undefined)
    assert.equal(r.headers.get('Vary'), 'Accept-Encoding, Origin')
  })
})

for (const [nome, tratar] of Object.entries(handlers)) {
  // Corpo inválido: 400 (cancelar não lê corpo e responde 401 sem login).
const ERRO_ESPERADO = nome === 'cancelar-assinatura-stripe' ? 401 : 400
  describe(`${nome} (handler executado)`, () => {
    test('OPTIONS de origem permitida: ok, ecoa a origem e responde Vary: Origin', async () => {
      for (const origem of ['https://app.saiae.com.br', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173']) {
        const r = await tratar(req(origem, 'OPTIONS'))
        assert.equal(r.status, 200)
        assert.equal(r.headers.get(ACAO), origem)
        assert.equal(r.headers.get('Vary'), 'Origin')
        assert.match(r.headers.get('Access-Control-Allow-Headers') ?? '', /authorization/)
      }
    })
    test('OPTIONS de origem desconhecida: sem Allow-Origin', async () => {
      const r = await tratar(req('https://malicioso.example', 'OPTIONS'))
      assert.equal(r.headers.get(ACAO), null)
      assert.equal(r.headers.get('Vary'), 'Origin')
    })
    test('resposta de erro (POST inválido) também ecoa só a origem permitida e nunca "*"', async () => {
      const boa = await tratar(req('https://app.saiae.com.br'))
      assert.equal(boa.status, ERRO_ESPERADO)
      assert.equal(boa.headers.get(ACAO), 'https://app.saiae.com.br')
      const ruim = await tratar(req('https://malicioso.example'))
      assert.equal(ruim.status, ERRO_ESPERADO)
      assert.equal(ruim.headers.get(ACAO), null)
      const semOrigem = await tratar(req(null))
      assert.equal(semOrigem.headers.get(ACAO), null)
    })
  })
}

describe('ligação nas functions (guarda de estrutura)', () => {
  const fonte = (caminho: string) => readFileSync(new URL(`../supabase/functions/${caminho}`, import.meta.url), 'utf8')
  test('reportar-bug e consultar-externo respondem via comCors e não têm "*"', () => {
    for (const f of ['reportar-bug/index.ts', 'consultar-externo/index.ts']) {
      const s = fonte(f)
      assert.match(s, /comCors\(req, tratar\(req\)\)/, f)
      assert.doesNotMatch(s, /Allow-Origin': '\*'/, f)
    }
  })
  test('nenhuma function autenticada declara Allow-Origin "*"', () => {
    for (const f of ['_shared/excluirConta.ts', '_shared/stripeAssinatura.ts', 'emitir-nfce/handler.ts']) {
      assert.doesNotMatch(fonte(f), /Allow-Origin': '\*'/, f)
    }
  })
  test('as públicas do cardápio e os webhooks seguem como estavam', () => {
    for (const f of ['criar-pedido-cardapio/index.ts', 'criar-pagamento-pix/index.ts', 'cupom-validar/index.ts']) {
      assert.match(fonte(f), /Allow-Origin': '\*'/, f)
    }
  })
})
