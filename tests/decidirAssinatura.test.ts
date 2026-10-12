// webhook-mercadopago (auditoria B1): assinatura ausente só é recusada com EXIGIR_ASSINATURA_MP=1. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { decidirAssinatura, type ResultadoAssinatura } from '../supabase/functions/_shared/pagamento/tipos.ts'

describe('decidirAssinatura', () => {
  test('inválida sempre rejeita, com ou sem o flag', () => {
    assert.equal(decidirAssinatura('invalida', false), 'rejeitar_invalida')
    assert.equal(decidirAssinatura('invalida', true), 'rejeitar_invalida')
  })
  test('sem assinatura: segue por padrão e rejeita só com o flag ligado', () => {
    assert.equal(decidirAssinatura('sem_assinatura', false), 'seguir')
    assert.equal(decidirAssinatura('sem_assinatura', true), 'rejeitar_ausente')
  })
  test('válida e sem segredo cadastrado sempre seguem (o flag só vale com segredo)', () => {
    for (const r of ['valida', 'sem_segredo'] as ResultadoAssinatura[]) {
      assert.equal(decidirAssinatura(r, false), 'seguir')
      assert.equal(decidirAssinatura(r, true), 'seguir')
    }
  })
})

describe('ligação no webhook (guarda de estrutura)', () => {
  test('o webhook lê EXIGIR_ASSINATURA_MP e usa decidirAssinatura', () => {
    const f = readFileSync(new URL('../supabase/functions/webhook-mercadopago/index.ts', import.meta.url), 'utf8')
    assert.match(f, /Deno\.env\.get\('EXIGIR_ASSINATURA_MP'\) === '1'/)
    assert.match(f, /decidirAssinatura\(/)
  })
})
