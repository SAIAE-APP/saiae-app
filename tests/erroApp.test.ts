// Núcleo puro do registro de erros do app (src/lib/erroAppNucleo.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LIMITE_POR_SESSAO, REPETIDO_EM_MS, deveReportar, textoDoErro, type EstadoLimite } from '../src/lib/erroAppNucleo.ts'

const novo = (): EstadoLimite => ({ enviados: 0, ultimaVez: new Map() })

describe('textoDoErro', () => {
  test('usa a mensagem do Error, sem pilha, em uma linha', () => {
    assert.equal(textoDoErro(new Error('falhou\n  em   algum lugar')), 'falhou em algum lugar')
  })
  test('aceita texto e devolve um padrão para o resto', () => {
    assert.equal(textoDoErro('texto'), 'texto')
    assert.equal(textoDoErro({ a: 1 }), 'erro sem mensagem')
    assert.equal(textoDoErro(undefined), 'erro sem mensagem')
    assert.equal(textoDoErro(new Error('')), 'erro sem mensagem')
  })
  test('corta em 200 caracteres', () => {
    assert.equal(textoDoErro(new Error('x'.repeat(500))).length, 200)
  })
})

describe('deveReportar', () => {
  test('a mesma mensagem só sai de novo depois de 1 minuto', () => {
    const e = novo()
    assert.equal(deveReportar(e, 'js:a', 0), true)
    assert.equal(deveReportar(e, 'js:a', REPETIDO_EM_MS - 1), false)
    assert.equal(deveReportar(e, 'js:a', REPETIDO_EM_MS), true)
  })
  test('mensagens diferentes não se bloqueiam', () => {
    const e = novo()
    assert.equal(deveReportar(e, 'js:a', 0), true)
    assert.equal(deveReportar(e, 'js:b', 1), true)
  })
  test('limite por sessão', () => {
    const e = novo()
    for (let i = 0; i < LIMITE_POR_SESSAO; i++) assert.equal(deveReportar(e, `js:${i}`, 0), true)
    assert.equal(deveReportar(e, 'js:novo', 0), false)
  })
})
