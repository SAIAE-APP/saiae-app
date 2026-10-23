// Proxy da conexão do WhatsApp com o CRM: assinatura, validação estrita da resposta e regra de acesso. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import { chamarConexaoCrm, podeExecutar } from '../supabase/functions/_shared/crmConexao.ts'

const args = {
  url: 'https://crm.exemplo.com/api/integracao/comanda/v1/whatsapp-conexao',
  segredo: 'segredo-de-teste-com-16+',
  barracaId: '11111111-1111-4111-8111-111111111111',
  acao: 'status' as const,
  requestId: '22222222-2222-4222-8222-222222222222',
}

function fakeJson(corpo: unknown, status = 200) {
  return (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch
}
const aviso = (n: number) => ({
  pedido_id: '33333333-3333-4333-8333-333333333333',
  tipo: 'pronto',
  estado: 'enviado',
  motivo: null,
  em: `2026-10-23T12:${String(n % 60).padStart(2, '0')}:00.000Z`,
})
const ok = { estado: 'conectado', qr: null, numero: '5561999531848', avisos: [] }

describe('chamarConexaoCrm', () => {
  test('envia corpo assinado no padrão do contrato, com redirect manual', async () => {
    let capturado: { url: string; init: RequestInit } | null = null
    const fake = (async (url: string, init: RequestInit) => {
      capturado = { url, init }
      return new Response(JSON.stringify(ok), { status: 200 })
    }) as unknown as typeof fetch
    const r = await chamarConexaoCrm(args, fake)
    assert.deepEqual(r, { ok: true, dados: ok })
    const h = capturado!.init.headers as Record<string, string>
    const corpo = capturado!.init.body as string
    assert.deepEqual(JSON.parse(corpo), { barraca_id: args.barracaId, acao: 'status', request_id: args.requestId })
    assert.equal(h['X-Saiae-Event-Id'], args.requestId)
    const esperado = 'sha256=' + createHmac('sha256', args.segredo).update(`${h['X-Saiae-Timestamp']}.${corpo}`).digest('hex')
    assert.equal(h['X-Saiae-Signature'], esperado)
    assert.equal(capturado!.init.method, 'POST')
    assert.equal(capturado!.init.redirect, 'manual')
    assert.ok(capturado!.init.signal)
  })

  test('URL http ou IP privado é recusada sem chamar a rede', async () => {
    let chamou = false
    const fake = (async () => {
      chamou = true
      return new Response('{}')
    }) as unknown as typeof fetch
    for (const url of ['http://crm.exemplo.com/x', 'https://127.0.0.1/x', 'https://192.168.0.10/x', 'https://localhost/x']) {
      const r = await chamarConexaoCrm({ ...args, url }, fake)
      assert.equal(r.ok, false, url)
    }
    assert.equal(chamou, false)
  })

  test('status 401/422/503 do CRM viram falha sem vazar o corpo', async () => {
    for (const status of [401, 422, 503]) {
      const r = await chamarConexaoCrm(args, fakeJson({ error: 'barraca 1111 segredo-de-teste-com-16+' }, status))
      assert.equal(r.ok, false)
      if (!r.ok) {
        assert.equal(r.motivo, `CRM respondeu ${status}`)
        assert.doesNotMatch(r.motivo, /segredo|1111/)
      }
    }
  })

  test('resposta fora do contrato vira falha', async () => {
    const ruins = [
      { ...ok, estado: 'explodiu' },
      { ...ok, estado: 'aguardando_qr', qr: 123 },
      { ...ok, numero: '55abc' },
      { ...ok, avisos: 'nada' },
      { ...ok, avisos: [{ ...aviso(0), tipo: 'em_preparo' }] },
      { ...ok, avisos: [{ ...aviso(0), estado: 'quem_sabe' }] },
      null,
      [],
    ]
    for (const ruim of ruins) {
      const r = await chamarConexaoCrm(args, fakeJson(ruim))
      assert.equal(r.ok, false, JSON.stringify(ruim))
      if (!r.ok) assert.doesNotMatch(r.motivo, /explodiu|abc|segredo-de-teste/)
    }
    const naoJson = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
    assert.equal((await chamarConexaoCrm(args, naoJson)).ok, false)
  })

  test('conectado nunca devolve qr; aguardando_qr devolve o texto bruto', async () => {
    const a = await chamarConexaoCrm(args, fakeJson({ ...ok, qr: 'QR-QUE-NAO-DEVIA' }))
    assert.deepEqual(a.ok && a.dados.qr, null)
    const b = await chamarConexaoCrm(args, fakeJson({ estado: 'aguardando_qr', qr: '2@abc,def', numero: null, avisos: [] }))
    assert.deepEqual(b.ok && b.dados.qr, '2@abc,def')
  })

  test('erro de rede e timeout viram falha com motivo fixo', async () => {
    const rede = (async () => {
      throw new Error('ECONNRESET segredo-de-teste-com-16+')
    }) as unknown as typeof fetch
    const r1 = await chamarConexaoCrm(args, rede)
    assert.deepEqual(r1, { ok: false, motivo: 'erro de rede' })
    const tempo = (async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    const r2 = await chamarConexaoCrm(args, tempo)
    assert.deepEqual(r2, { ok: false, motivo: 'tempo esgotado' })
  })

  test('avisos é truncado em 20 itens', async () => {
    const r = await chamarConexaoCrm({ ...args, acao: 'historico' }, fakeJson({ ...ok, avisos: Array.from({ length: 30 }, (_, i) => aviso(i)) }))
    assert.equal(r.ok && r.dados.avisos.length, 20)
  })
})

describe('podeExecutar', () => {
  test('dono faz tudo; suporte e operador só status e historico', () => {
    for (const acao of ['iniciar', 'status', 'desconectar', 'historico'] as const) {
      assert.equal(podeExecutar(acao, 'dono'), true, acao)
    }
    for (const papel of ['suporte', 'operador', 'gerente', null]) {
      assert.equal(podeExecutar('status', papel), true, `${papel} status`)
      assert.equal(podeExecutar('historico', papel), true, `${papel} historico`)
      assert.equal(podeExecutar('iniciar', papel), false, `${papel} iniciar`)
      assert.equal(podeExecutar('desconectar', papel), false, `${papel} desconectar`)
    }
  })
})
