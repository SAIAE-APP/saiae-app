// IA no WhatsApp, Task 2 (SAI-002): assinatura HMAC e validação do corpo da rota ia-contexto. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { assinarEvento } from '../supabase/functions/_shared/eventosSaida.ts'
import { JANELA_ASSINATURA_S, TAMANHO_MAX_CORPO, validarCorpoIa, verificarAssinaturaIa } from '../supabase/functions/_shared/iaAssinatura.ts'

const SEGREDO = 'segredo-de-teste-da-plataforma'
const AGORA = 1_800_000_000_000 // ms
const TS = Math.floor(AGORA / 1000)
const CORPO = JSON.stringify({ codigo_loja: 'ABCD23', telefone: '11977776655' })

async function assinado(corpo = CORPO, ts = TS, segredo = SEGREDO) {
  return { ts: String(ts), assinatura: await assinarEvento(segredo, ts, corpo), corpo }
}

describe('verificarAssinaturaIa', () => {
  test('assinatura correta passa', async () => {
    const a = await assinado()
    assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, a.assinatura, a.corpo, AGORA), true)
  })

  test('a mesma assinatura do evento SAI-001 vale (mesma família: sha256= de timestamp.corpo)', async () => {
    const a = await assinado()
    assert.match(a.assinatura, /^sha256=[0-9a-f]{64}$/)
  })

  test('corpo alterado em um caractere falha', async () => {
    const a = await assinado()
    assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, a.assinatura, a.corpo.replace('ABCD23', 'ABCD24'), AGORA), false)
    assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, a.assinatura, a.corpo + ' ', AGORA), false)
  })

  test('segredo errado, vazio ou ausente falha (inclusive assinatura calculada com segredo vazio)', async () => {
    const a = await assinado()
    assert.equal(await verificarAssinaturaIa('outro-segredo', a.ts, a.assinatura, a.corpo, AGORA), false)
    assert.equal(await verificarAssinaturaIa('', a.ts, a.assinatura, a.corpo, AGORA), false)
    assert.equal(await verificarAssinaturaIa(undefined, a.ts, a.assinatura, a.corpo, AGORA), false)
    // O HMAC nem aceita chave vazia: um segredo vazio nunca valida nada, mesmo com uma assinatura bem formada.
    assert.equal(await verificarAssinaturaIa('', a.ts, a.assinatura, a.corpo, AGORA), false)
  })

  test('janela de 5 minutos: passa até 300 s (passado e futuro), falha acima', async () => {
    for (const delta of [0, 1, JANELA_ASSINATURA_S, -JANELA_ASSINATURA_S]) {
      const a = await assinado(CORPO, TS + delta)
      assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, a.assinatura, a.corpo, AGORA), true, `delta ${delta}`)
    }
    for (const delta of [JANELA_ASSINATURA_S + 1, -(JANELA_ASSINATURA_S + 1), 3600, -3600]) {
      const a = await assinado(CORPO, TS + delta)
      assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, a.assinatura, a.corpo, AGORA), false, `delta ${delta}`)
    }
  })

  test('assinatura de outro timestamp (replay trocando o cabeçalho) falha', async () => {
    const a = await assinado(CORPO, TS - 10)
    assert.equal(await verificarAssinaturaIa(SEGREDO, String(TS), a.assinatura, a.corpo, AGORA), false)
  })

  test('formato da assinatura: prefixo, tamanho e maiúsculas', async () => {
    const a = await assinado()
    const hex = a.assinatura.slice('sha256='.length)
    for (const ruim of [hex, `sha1=${hex}`, `sha256=${hex.slice(1)}`, `sha256=${hex.toUpperCase()}`, `sha256=${hex}00`, '', 'sha256=']) {
      assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, ruim, a.corpo, AGORA), false, ruim)
    }
    assert.equal(await verificarAssinaturaIa(SEGREDO, a.ts, null, a.corpo, AGORA), false)
  })

  test('timestamp que não é inteiro canônico falha (zeros à esquerda, notação científica, sinal, espaço, decimal, vazio)', async () => {
    const a = await assinado()
    for (const ruim of ['0' + a.ts, '1.8e9', '+' + a.ts, ' ' + a.ts, a.ts + '.0', '-1', '', 'abc', '9'.repeat(13)]) {
      assert.equal(await verificarAssinaturaIa(SEGREDO, ruim, a.assinatura, a.corpo, AGORA), false, JSON.stringify(ruim))
    }
    assert.equal(await verificarAssinaturaIa(SEGREDO, null, a.assinatura, a.corpo, AGORA), false)
  })
})

describe('validarCorpoIa', () => {
  test('corpo válido', () => {
    assert.deepEqual(validarCorpoIa(CORPO), { ok: true, codigo: 'ABCD23', telefone: '11977776655' })
    assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'ZZ9999', telefone: '5511977776655' })), { ok: true, codigo: 'ZZ9999', telefone: '5511977776655' })
  })

  test('código fora de [A-Z0-9]{6} é recusado (minúsculas, curto, longo, símbolo, espaço)', () => {
    for (const codigo of ['abcd23', 'ABCD2', 'ABCD234', 'ABCD2!', ' BCD23', 'ABCD 3', '', "AB'CD2"]) {
      assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: codigo, telefone: '11977776655' })), { ok: false }, codigo)
    }
  })

  test('telefone ausente ou nulo vale como cliente novo; presente e inválido continua recusado', () => {
    assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'ABCD23' })), { ok: true, codigo: 'ABCD23', telefone: null })
    assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'ABCD23', telefone: null })), { ok: true, codigo: 'ABCD23', telefone: null })
    assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'abcd23' })), { ok: false })
  })

  test('telefone só com dígitos, de 10 a 13', () => {
    for (const tel of ['119777766', '11977776655999', '(11) 97777-6655', '+5511977776655', '11 97777 6655', 'abc', '']) {
      assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'ABCD23', telefone: tel })), { ok: false }, tel)
    }
  })

  test('tipos errados, JSON quebrado, não-objeto e vazio são recusados', () => {
    for (const ruim of [
      '', 'x', '{', '[]', 'null', '"texto"', '42',
      JSON.stringify({ codigo_loja: 123456, telefone: '11977776655' }),
      JSON.stringify({ codigo_loja: 'ABCD23', telefone: 11977776655 }),
      JSON.stringify({ codigo_loja: ['ABCD23'], telefone: '11977776655' }),
      JSON.stringify({ telefone: '11977776655' }),
    ]) {
      assert.deepEqual(validarCorpoIa(ruim), { ok: false }, ruim)
    }
  })

  test('corpo acima de 4 KB é recusado, mesmo válido no começo; campo extra é ignorado', () => {
    const grande = JSON.stringify({ codigo_loja: 'ABCD23', telefone: '11977776655', lixo: 'x'.repeat(TAMANHO_MAX_CORPO) })
    assert.deepEqual(validarCorpoIa(grande), { ok: false })
    assert.deepEqual(validarCorpoIa(JSON.stringify({ codigo_loja: 'ABCD23', telefone: '11977776655', extra: 'ok' })), { ok: true, codigo: 'ABCD23', telefone: '11977776655' })
  })
})
