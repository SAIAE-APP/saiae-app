// QR do link da loja: matriz gerada pela biblioteca e agrupamento em faixas (src/lib/qr.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_TEXTO_QR, faixasEscuras, matrizQr } from '../src/lib/qr.ts'

const LINK = 'https://wa.me/551140001234?text=' + encodeURIComponent('Oi! Quero tirar uma dúvida sobre a loja. #K7P2QX')

describe('matrizQr', () => {
  test('é quadrada, com tamanho de versão QR (21 + 4k) e determinística', () => {
    const m = matrizQr(LINK)
    assert.ok(m.length >= 21 && (m.length - 21) % 4 === 0)
    assert.ok(m.every((l) => l.length === m.length))
    assert.deepEqual(matrizQr(LINK), m)
  })

  test('tem os três localizadores nos cantos (anel 7x7 escuro, miolo 3x3 escuro) e nenhum no canto inferior direito', () => {
    const m = matrizQr(LINK)
    const n = m.length
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const borda = i === 0 || i === 6 || j === 0 || j === 6
          const miolo = i >= 2 && i <= 4 && j >= 2 && j <= 4
          assert.equal(m[r0 + i][c0 + j], borda || miolo, `${r0 + i},${c0 + j}`)
        }
      }
    }
  })

  test('texto maior gera matriz maior; textos diferentes geram desenhos diferentes', () => {
    assert.ok(matrizQr(LINK + LINK).length > matrizQr('abc').length)
    assert.notDeepEqual(matrizQr(LINK), matrizQr(LINK.replace('K7P2QX', 'K7P2QY').replace('%23K7P2QX', '%23K7P2QY')))
  })

  test('texto vazio ou acima do limite lança (nunca desenha QR em branco ou cortado)', () => {
    assert.throws(() => matrizQr(''))
    assert.throws(() => matrizQr('x'.repeat(MAX_TEXTO_QR + 1)))
    assert.doesNotThrow(() => matrizQr('x'.repeat(MAX_TEXTO_QR)))
  })
})

describe('faixasEscuras', () => {
  test('agrupa módulos escuros contíguos por linha', () => {
    assert.deepEqual(faixasEscuras([[true, true, false, true], [false, false, false, false], [true, false, true, true]]), [
      { x: 0, y: 0, w: 2 }, { x: 3, y: 0, w: 1 }, { x: 0, y: 2, w: 1 }, { x: 2, y: 2, w: 2 },
    ])
  })

  test('a soma das larguras é exatamente o número de módulos escuros da matriz real', () => {
    const m = matrizQr(LINK)
    const escuros = m.flat().filter(Boolean).length
    assert.equal(faixasEscuras(m).reduce((s, f) => s + f.w, 0), escuros)
  })

  test('matriz vazia ou toda clara não gera faixa', () => {
    assert.deepEqual(faixasEscuras([]), [])
    assert.deepEqual(faixasEscuras([[false, false], [false, false]]), [])
  })
})
