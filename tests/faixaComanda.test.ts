// Comanda impressa: a faixa de tipo (MESA, BALCAO, RETIRADA, ENTREGA) sai no mesmo 2x, sem acento e cabendo no papel
// de 58 mm (32 colunas) e de 80 mm (48). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { faixaImpressao } from '../src/lib/atendimento.ts'

const COLUNAS = { '58mm': 32, '80mm': 48 } as const

describe('faixaImpressao', () => {
  test('Retirada e Entrega seguem como antes', () => {
    assert.equal(faixaImpressao('retirada'), '*** RETIRADA ***')
    assert.equal(faixaImpressao('entrega'), '*** ENTREGA ***')
  })

  test('Mesa leva o número e Balcão sai como BALCAO, sem acento', () => {
    assert.equal(faixaImpressao('mesa', { mesa: '12' }), '*** MESA 12 ***')
    assert.equal(faixaImpressao('balcao'), '*** BALCAO ***')
    assert.equal(faixaImpressao('mesa', { mesa: null }), '*** BALCAO ***')
    assert.equal(faixaImpressao('mesa', { mesa: '   ' }), '*** BALCAO ***')
    assert.equal(faixaImpressao('mesa', { mesa: 'varanda' }), '*** MESA VARANDA ***'.length <= 16 ? '*** MESA VARANDA ***' : 'MESA VARANDA')
  })

  test('nome de mesa com acento vira ASCII maiúsculo', () => {
    assert.equal(faixaImpressao('mesa', { mesa: 'Área 3', colunasFaixa: 24 }), '*** MESA AREA 3 ***')
    assert.equal(faixaImpressao('mesa', { mesa: 'Açaí' , colunasFaixa: 24 }), '*** MESA ACAI ***')
  })

  for (const [papel, colunas] of Object.entries(COLUNAS)) {
    test(`${papel}: toda faixa cabe em ${colunas / 2} colunas no 2x e é ASCII puro`, () => {
      const colunasFaixa = colunas / 2
      const mesas = ['1', '12', '123', '1234', 'Varanda', 'Salão dos fundos 12', 'ÁÉÍÓÚ ÇÃO ÕÊ ñ', 'x'.repeat(60)]
      for (const mesa of mesas) {
        const f = faixaImpressao('mesa', { mesa, colunasFaixa }) as string
        assert.ok(f.length > 0 && f.length <= colunasFaixa, `${mesa} -> "${f}" (${f.length} > ${colunasFaixa})`)
        assert.match(f, /^[\x20-\x7e]+$/, f)
        assert.match(f, /MESA/)
      }
      for (const tipo of ['balcao', 'retirada', 'entrega'] as const) {
        const f = faixaImpressao(tipo, { colunasFaixa }) as string
        assert.ok(f.length <= colunasFaixa, f)
      }
    })
  }

  test('mesa curta mantém os asteriscos nos dois papéis; só a muito longa os perde', () => {
    assert.equal(faixaImpressao('mesa', { mesa: '12', colunasFaixa: 16 }), '*** MESA 12 ***')
    assert.equal(faixaImpressao('mesa', { mesa: '123', colunasFaixa: 16 }), '*** MESA 123 ***')
    assert.equal(faixaImpressao('mesa', { mesa: '1234', colunasFaixa: 16 }), 'MESA 1234')
    assert.equal(faixaImpressao('mesa', { mesa: '1234', colunasFaixa: 24 }), '*** MESA 1234 ***')
  })
})

test('montarComanda imprime a faixa em 2x e sem a linha antiga "Mesa N"', () => {
  const f = readFileSync(new URL('../src/lib/impressoraTermica.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(f, /faixaImpressao\(tipo, \{ mesa: dados\.mesa, colunasFaixa: Math\.floor\(colunas \/ 2\) \}\)/)
  assert.match(f, /encoder\.bold\(true\)\.size\(2, 2\)\.line\(faixa\)\.size\(1, 1\)\.bold\(false\)\.newline\(\)/)
  assert.doesNotMatch(f, /dados\.mesa \? semAcento\(`Mesa \$\{dados\.mesa\}`\) : 'BALCAO'/)
})
