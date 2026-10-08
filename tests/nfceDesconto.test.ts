// Rateio do desconto de cupom entre os itens da NFC-e. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ratearDesconto } from '../supabase/functions/_shared/descontoNfce.ts'

const soma = (v: number[]) => v.reduce((s, x) => s + x, 0)

describe('ratearDesconto', () => {
  test('proporcional e a soma bate exatamente', () => {
    const r = ratearDesconto([3000, 1000], 400)
    assert.deepEqual(r, [300, 100])
    assert.equal(soma(r), 400)
  })

  test('resto de centavos vai para o ÚLTIMO item', () => {
    // 100 entre três itens iguais: 33 + 33 + 34
    assert.deepEqual(ratearDesconto([1000, 1000, 1000], 100), [33, 33, 34])
  })

  test('um item só recebe tudo', () => {
    assert.deepEqual(ratearDesconto([2500], 499), [499])
  })

  test('nunca negativo, nunca maior que o valor da linha', () => {
    for (const [brutos, desc] of [
      [[1, 1, 1000], 500],
      [[1000, 1], 900],
      [[5, 5, 5], 14],
      [[100, 100], 199],
    ] as [number[], number][]) {
      const r = ratearDesconto(brutos, desc)
      r.forEach((v, i) => {
        assert.ok(v >= 0, `negativo em ${brutos}`)
        assert.ok(v <= brutos[i], `acima da linha em ${brutos}: ${r}`)
      })
      assert.equal(soma(r), desc, `soma em ${brutos}`)
    }
  })

  test('desconto acima do total é limitado ao total; zero ou negativo não desconta', () => {
    assert.deepEqual(ratearDesconto([100, 200], 9999), [100, 200])
    assert.deepEqual(ratearDesconto([100, 200], 0), [0, 0])
    assert.deepEqual(ratearDesconto([100, 200], -5), [0, 0])
  })

  test('lista vazia e itens de valor zero', () => {
    assert.deepEqual(ratearDesconto([], 100), [])
    assert.deepEqual(ratearDesconto([0, 0], 100), [0, 0])
  })

  test('propriedade: soma exata e limites em muitos casos aleatórios', () => {
    let seed = 12345
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let k = 0; k < 500; k++) {
      const brutos = Array.from({ length: 1 + rnd(6) }, () => 1 + rnd(5000))
      const total = soma(brutos)
      const desc = rnd(total + 1)
      const r = ratearDesconto(brutos, desc)
      assert.equal(soma(r), desc)
      r.forEach((v, i) => assert.ok(v >= 0 && v <= brutos[i]))
    }
  })
})
