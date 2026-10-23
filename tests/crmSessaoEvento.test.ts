// Evento de sessão do WhatsApp (CRM → Sai aê): validação do corpo e tratamento da requisição. Rodar: npm test
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import { tratarEventoSessao, validarEventoSessao } from '../supabase/functions/_shared/crmSessaoEvento.ts'

const SEGREDO = 'segredo-de-teste-com-16+'
const AGORA = Date.parse('2026-10-23T12:00:30Z')
const TS = Math.floor(AGORA / 1000)
const evento = {
  barraca_id: '11111111-1111-4111-8111-111111111111',
  estado: 'caiu',
  occurred_at: '2026-10-23T12:00:00.000Z',
  request_id: '22222222-2222-4222-8222-222222222222',
}

function assinar(corpo: string, ts = TS, segredo = SEGREDO) {
  return { timestamp: String(ts), assinatura: 'sha256=' + createHmac('sha256', segredo).update(`${ts}.${corpo}`).digest('hex') }
}

type Opcoes = { segredo?: string; ts?: number; segredoAssina?: string; resultado?: 'ok' | 'ignorado' | 'erro'; corpoEnviado?: string }
async function tratar(corpo: string, o: Opcoes = {}) {
  const gravados: unknown[] = []
  const a = assinar(corpo, o.ts, o.segredoAssina)
  const r = await tratarEventoSessao(
    {
      corpoBruto: o.corpoEnviado ?? corpo,
      timestamp: a.timestamp,
      assinatura: a.assinatura,
      segredo: 'segredo' in o ? o.segredo : SEGREDO,
      agoraMs: AGORA,
    },
    async (e) => {
      gravados.push(e)
      return o.resultado ?? 'ok'
    },
  )
  return { r, gravados }
}

describe('validarEventoSessao', () => {
  test('aceita o corpo do contrato', () => {
    assert.equal(validarEventoSessao(evento, AGORA).ok, true)
  })
  test('recusa barraca_id fora de UUID, estado desconhecido, chave extra, data inválida e request_id ruim', () => {
    const ruins = [
      { ...evento, barraca_id: 'abc' },
      { ...evento, estado: 'em_preparo' },
      { ...evento, extra: 1 },
      { ...evento, occurred_at: 'ontem' },
      { ...evento, occurred_at: '2027-01-01T00:00:00Z' },
      { ...evento, request_id: 5 },
      null,
      [],
      'texto',
    ]
    for (const ruim of ruins) assert.equal(validarEventoSessao(ruim, AGORA).ok, false, JSON.stringify(ruim))
  })
})

describe('tratarEventoSessao', () => {
  test('assinatura válida grava e responde 200 { ok: true }', async () => {
    const { r, gravados } = await tratar(JSON.stringify(evento))
    assert.deepEqual(r, { status: 200, corpo: { ok: true } })
    assert.deepEqual(gravados, [{ barracaId: evento.barraca_id, estado: 'caiu', em: evento.occurred_at }])
  })

  test('barraca desconhecida (RPC ignorou) responde igual ao sucesso', async () => {
    const { r } = await tratar(JSON.stringify(evento), { resultado: 'ignorado' })
    assert.deepEqual(r, { status: 200, corpo: { ok: true } })
  })

  test('segredo errado, timestamp fora da janela e corpo adulterado → 401 igual, nada gravado', async () => {
    const corpo = JSON.stringify(evento)
    const casos = [
      await tratar(corpo, { segredoAssina: 'outro-segredo-com-16-chars' }),
      await tratar(corpo, { ts: TS - 301 }),
      await tratar(corpo, { corpoEnviado: corpo + ' ' }),
    ]
    for (const c of casos) {
      assert.deepEqual(c.r, { status: 401 })
      assert.equal(c.gravados.length, 0)
    }
  })

  test('corpo inválido assinado → 422 sem ecoar valores e nada gravado', async () => {
    for (const ruim of [JSON.stringify({ ...evento, barraca_id: 'abc' }), JSON.stringify({ ...evento, estado: 'xyz' }), '{quebrado']) {
      const { r, gravados } = await tratar(ruim)
      assert.deepEqual(r, { status: 422 })
      assert.equal(gravados.length, 0)
    }
  })

  test('corpo maior que 4 KB → 413 e nada gravado', async () => {
    const { r, gravados } = await tratar(JSON.stringify({ ...evento, lixo: 'a'.repeat(5000) }))
    assert.deepEqual(r, { status: 413 })
    assert.equal(gravados.length, 0)
  })

  test('sem segredo ou com menos de 16 caracteres → 503, nunca aceita', async () => {
    for (const segredo of [undefined, '', 'curto']) {
      const { r, gravados } = await tratar(JSON.stringify(evento), { segredo, segredoAssina: segredo || 'x' })
      assert.deepEqual(r, { status: 503 })
      assert.equal(gravados.length, 0)
    }
  })

  test('falha ao gravar → 500 sem detalhe', async () => {
    const { r } = await tratar(JSON.stringify(evento), { resultado: 'erro' })
    assert.deepEqual(r, { status: 500 })
  })
})
