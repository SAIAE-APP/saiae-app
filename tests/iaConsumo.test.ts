// IA no WhatsApp, Task 10: a Comanda consulta o consumo do mês no CRM (contrato assinado, formato proposto à aorus-03).
// Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { buscarConsumo, cabecalhosDoConsumo, interpretarConsumo, urlDoConsumo } from '../supabase/functions/_shared/iaConsumo.ts'

const SEGREDO = 'segredo-de-teste-da-plataforma'
const URL_CRM = 'https://crm.exemplo.com.br/api/integracao/comanda/v1/ia-consumo'
const AGORA = 1_800_000_000_000
const OK = { mes: '2026-10', conversas: 12, limite: 100 }

function resposta(status: number, corpo: unknown): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status })
}

describe('interpretarConsumo', () => {
  test('formato válido, com limite ou sem limite (null)', () => {
    assert.deepEqual(interpretarConsumo(OK), OK)
    assert.deepEqual(interpretarConsumo({ mes: '2026-01', conversas: 0, limite: null }), { mes: '2026-01', conversas: 0, limite: null })
  })
  test('campos extras são ignorados; nada de campo do CRM vaza para a tela', () => {
    assert.deepEqual(interpretarConsumo({ ...OK, telefone: '5511999990000', texto: 'oi' }), OK)
  })
  test('fora de forma é recusado (mês, tipos, negativos, não inteiros, limite ausente)', () => {
    for (const ruim of [
      null, undefined, 'x', 7, [], {},
      { ...OK, mes: '2026-13' }, { ...OK, mes: '2026-1' }, { ...OK, mes: 202610 }, { ...OK, mes: '10/2026' },
      { ...OK, conversas: -1 }, { ...OK, conversas: 1.5 }, { ...OK, conversas: '12' }, { ...OK, conversas: null },
      { ...OK, limite: -5 }, { ...OK, limite: 10.5 }, { ...OK, limite: '100' }, { mes: '2026-10', conversas: 3 },
    ]) {
      assert.equal(interpretarConsumo(ruim), null, JSON.stringify(ruim))
    }
  })
})

describe('urlDoConsumo', () => {
  test('acrescenta codigo_loja preservando a URL base; código fora de [A-Z0-9]{6} é recusado', () => {
    assert.equal(urlDoConsumo(URL_CRM, 'ABCD23'), `${URL_CRM}?codigo_loja=ABCD23`)
    assert.equal(urlDoConsumo(`${URL_CRM}?x=1`, 'ABCD23'), `${URL_CRM}?x=1&codigo_loja=ABCD23`)
    for (const ruim of ['abcd23', 'ABCD2', 'ABCD234', 'AB CD2', '', "AB'CD2", 'ABCD2&']) assert.equal(urlDoConsumo(URL_CRM, ruim), null, ruim)
    assert.equal(urlDoConsumo('não é url', 'ABCD23'), null)
  })
})

describe('assinatura (contrato: HMAC-SHA256 de `${timestamp}.${codigo_loja}`)', () => {
  test('bate com um HMAC calculado de forma independente', async () => {
    const h = await cabecalhosDoConsumo(SEGREDO, 1_800_000_000, 'ABCD23')
    const esperado = 'sha256=' + createHmac('sha256', SEGREDO).update('1800000000.ABCD23').digest('hex')
    assert.equal(h['X-Saiae-Signature'], esperado)
    assert.equal(h['X-Saiae-Timestamp'], '1800000000')
  })
  test('código diferente ou timestamp diferente muda a assinatura', async () => {
    const base = (await cabecalhosDoConsumo(SEGREDO, 1_800_000_000, 'ABCD23'))['X-Saiae-Signature']
    assert.notEqual(base, (await cabecalhosDoConsumo(SEGREDO, 1_800_000_000, 'ABCD24'))['X-Saiae-Signature'])
    assert.notEqual(base, (await cabecalhosDoConsumo(SEGREDO, 1_800_000_001, 'ABCD23'))['X-Saiae-Signature'])
  })
})

describe('buscarConsumo', () => {
  test('chama o CRM com GET assinado, sem corpo, sem seguir redirect e com o código na URL', async () => {
    let visto: { url: string; init: RequestInit } | null = null
    const r = await buscarConsumo({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23' }, async (url, init) => {
      visto = { url: String(url), init: init as RequestInit }
      return resposta(200, OK)
    }, AGORA)
    assert.deepEqual(r, { ok: true, consumo: OK })
    assert.ok(visto)
    const v = visto as { url: string; init: RequestInit }
    assert.equal(v.url, `${URL_CRM}?codigo_loja=ABCD23`)
    assert.equal(v.init.method, 'GET')
    assert.equal(v.init.redirect, 'manual')
    assert.equal(v.init.body, undefined)
    const h = v.init.headers as Record<string, string>
    assert.equal(h['X-Saiae-Timestamp'], String(Math.floor(AGORA / 1000)))
    assert.equal(h['X-Saiae-Signature'], 'sha256=' + createHmac('sha256', SEGREDO).update(`${Math.floor(AGORA / 1000)}.ABCD23`).digest('hex'))
    assert.ok(!v.url.includes(SEGREDO) && !JSON.stringify(h).includes(SEGREDO), 'o segredo nunca vai na requisição')
  })

  test('sem URL ou sem segredo configurados: não chama a rede', async () => {
    let chamou = false
    const f = async () => { chamou = true; return resposta(200, OK) }
    assert.equal((await buscarConsumo({ url: undefined, segredo: SEGREDO, codigoLoja: 'ABCD23' }, f)).ok, false)
    assert.equal((await buscarConsumo({ url: URL_CRM, segredo: undefined, codigoLoja: 'ABCD23' }, f)).ok, false)
    assert.equal((await buscarConsumo({ url: URL_CRM, segredo: '', codigoLoja: 'ABCD23' }, f)).ok, false)
    assert.equal(chamou, false)
  })

  test('URL interna, http ou com credencial é recusada (SSRF) sem chamar a rede', async () => {
    let chamou = false
    const f = async () => { chamou = true; return resposta(200, OK) }
    for (const url of ['http://crm.exemplo.com.br/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://u:p@crm.exemplo.com.br/x', 'https://192.168.0.1/x']) {
      const r = await buscarConsumo({ url, segredo: SEGREDO, codigoLoja: 'ABCD23' }, f)
      assert.equal(r.ok, false, url)
    }
    assert.equal(chamou, false)
  })

  test('código da loja inválido não chama a rede', async () => {
    let chamou = false
    const r = await buscarConsumo({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'x' }, async () => { chamou = true; return resposta(200, OK) })
    assert.equal(r.ok, false)
    assert.equal(chamou, false)
  })

  test('401, 400, 500, resposta fora de forma, JSON quebrado e erro de rede viram erro sem lançar', async () => {
    const casos: Array<() => Promise<Response>> = [
      async () => resposta(401, ''), async () => resposta(400, { erro: 'x' }), async () => resposta(500, 'falha'),
      async () => resposta(200, { mes: 'x' }), async () => resposta(200, 'não é json'), async () => resposta(302, ''),
      async () => { throw new Error('ECONNRESET') },
    ]
    for (const c of casos) {
      const r = await buscarConsumo({ url: URL_CRM, segredo: SEGREDO, codigoLoja: 'ABCD23' }, c, AGORA)
      assert.equal(r.ok, false)
      if (!r.ok) assert.ok(!r.motivo.includes(SEGREDO))
    }
  })
})

describe('ia-consumo (edge function, guardas estáticas)', () => {
  const fonte = readFileSync(new URL('../supabase/functions/ia-consumo/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('exige o login do dono e o vínculo com a loja antes de qualquer chamada ao CRM', () => {
    const pos = (t: string) => fonte.indexOf(t)
    assert.ok(pos('auth.getUser(') > 0 && pos("from('usuarios_barracas')") > pos('auth.getUser(') && pos('buscarConsumo(') > pos("from('usuarios_barracas')"))
    assert.match(fonte, /if \(erroUsuario \|\| !usuario\?\.user\) return json\(\{ erro: 'Não autenticado' \}, 401\)/)
    assert.match(fonte, /if \(!vinculo\) return json\(\{ erro: 'Sem acesso a esta loja' \}, 403\)/)
  })

  test('loja sem código da IA não chama o CRM', () => {
    assert.match(fonte, /if \(!barraca\?\.ia_codigo\) return json\(\{ ok: true, conversas: 0, limite: null, mes: null \}\)/)
  })

  test('o erro do CRM nunca chega ao navegador e o log é só mensagem fixa', () => {
    assert.match(fonte, /return json\(\{ erro: 'Consumo indisponível' \}, 502\)/)
    for (const l of fonte.split('\n').filter((x) => /console\./.test(x))) assert.match(l.trim(), /^console\.error\('[^'$`]*'\)$/, l)
  })

  test('segredos só por variável de ambiente', () => {
    assert.match(fonte, /Deno\.env\.get\('IA_CONTEXTO_SEGREDO'\)/)
    assert.match(fonte, /Deno\.env\.get\('CRM_IA_CONSUMO_URL'\)/)
  })
})
