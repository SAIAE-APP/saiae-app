// reportar-bug (auditoria M4): cortes de tamanho, assunto fixo e corpo rotulado.
// Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  MAX_DESCRICAO,
  MAX_ESPERADO,
  MAX_NOME,
  assuntoDoRelato,
  corpoDoRelato,
  normalizarRelato,
  umaLinha,
} from '../supabase/functions/_shared/reportarBug.ts'

describe('normalizarRelato', () => {
  test('descrição de 1 MB é cortada em 4000 e o esperado em 2000', () => {
    const r = normalizarRelato({ descricao: 'a'.repeat(1_000_000), esperado: 'b'.repeat(50_000) })
    assert.equal(r.descricao.length, MAX_DESCRICAO)
    assert.equal(r.esperado.length, MAX_ESPERADO)
  })
  test('campos de uma linha: sem quebra de linha e com limite', () => {
    const r = normalizarRelato({
      descricao: 'x',
      barraca_nome: 'Loja\r\nBcc: alguem@x.com\u2028Urgente ' + 'z'.repeat(500),
      user_agent: 'UA\nOutra linha',
    })
    assert.doesNotMatch(r.barracaNome, /[\r\n\u2028\u2029]/)
    assert.equal(r.barracaNome.length, MAX_NOME)
    assert.equal(r.userAgent, 'UA Outra linha')
  })
  test('corpo ausente, nulo ou com tipos errados não quebra', () => {
    assert.equal(normalizarRelato(null).descricao, '')
    assert.equal(normalizarRelato(undefined).barracaNome, '')
    assert.equal(normalizarRelato({ descricao: 123, barraca_nome: { a: 1 } }).descricao, '123')
  })
  test('descrição só com espaços vira vazia (a function responde 400)', () => {
    assert.equal(normalizarRelato({ descricao: '   \n  ' }).descricao, '')
  })
  test('umaLinha respeita o máximo', () => {
    assert.equal(umaLinha('abcdef', 3), 'abc')
  })
})

describe('e-mail', () => {
  const relato = normalizarRelato({ descricao: 'Travou', esperado: 'Salvar', barraca_nome: 'Feira do Zé', barraca_slug: 'feira', user_agent: 'UA' })
  test('assunto é fixo e não carrega texto do cliente', () => {
    const assunto = assuntoDoRelato('12345678-aaaa-bbbb-cccc-1234567890ab')
    assert.equal(assunto, '[Bug] 12345678')
    assert.doesNotMatch(assunto, /Feira|Zé/)
  })
  test('dados do navegador vêm rotulados como não verificados', () => {
    const corpo = corpoDoRelato('a@b.com', relato)
    assert.match(corpo, /não verificados/)
    assert.match(corpo, /Barraca: Feira do Zé \(feira\)/)
    assert.match(corpo, /Descrição:\nTravou/)
    assert.match(corpo, /O que esperava que acontecesse:\nSalvar/)
  })
  test('sem "esperado" a seção some', () => {
    const corpo = corpoDoRelato('a@b.com', normalizarRelato({ descricao: 'Travou' }))
    assert.doesNotMatch(corpo, /esperava/)
    assert.match(corpo, /Barraca: — \(—\)/)
  })
})
