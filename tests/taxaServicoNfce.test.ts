// Rateio da taxa de serviço da comanda entre as rodadas (e entre os itens) da NFC-e. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ratearTaxaServico } from '../supabase/functions/_shared/taxaServicoNfce.ts'

const soma = (v: number[]) => v.reduce((s, x) => s + x, 0)

describe('ratearTaxaServico', () => {
  test('proporcional ao total de cada rodada', () => {
    assert.deepEqual(ratearTaxaServico([1000, 2000, 3000], 600), [100, 200, 300])
  })

  test('maior resto: a soma bate exatamente com a taxa', () => {
    const r = ratearTaxaServico([333, 333, 334], 100)
    assert.equal(soma(r), 100)
    assert.deepEqual(r, [33, 33, 34])
  })

  test('empate no resto vai para a rodada de menor índice (determinístico)', () => {
    assert.deepEqual(ratearTaxaServico([100, 100, 100], 2), [1, 1, 0])
  })

  test('taxa zero dá zero', () => {
    assert.deepEqual(ratearTaxaServico([1000], 0), [0])
  })

  test('lista vazia dá lista vazia', () => {
    assert.deepEqual(ratearTaxaServico([], 500), [])
  })

  test('rodada com total 0 recebe 0', () => {
    const r = ratearTaxaServico([0, 1000, 0, 3000], 401)
    assert.equal(r[0], 0)
    assert.equal(r[2], 0)
    assert.equal(soma(r), 401)
  })

  test('soma dos totais 0 com taxa > 0: ninguém recebe (não há base para ratear)', () => {
    assert.deepEqual(ratearTaxaServico([0, 0], 100), [0, 0])
  })

  test('não depende da ordem de emissão: cada rodada tem sempre a mesma parte', () => {
    const totais = [1234, 5678, 91011]
    const a = ratearTaxaServico(totais, 9792)
    const b = ratearTaxaServico(totais, 9792)
    assert.deepEqual(a, b)
    assert.equal(soma(a), 9792)
  })

  test('NaN/Infinity/negativo contam como 0', () => {
    assert.deepEqual(ratearTaxaServico([NaN, 1000, Infinity, -500], 100), [0, 100, 0, 0])
    assert.deepEqual(ratearTaxaServico([1000], NaN), [0])
    assert.deepEqual(ratearTaxaServico([1000], Infinity), [0])
  })
})
