// Rodada de comanda aberta: a mesa identifica o pedido (Cozinha, comanda impressa) e a senha fica em segundo plano.
// Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { mesaDaRodada, textoBarraComanda } from '../src/lib/comandaAberta.ts'

describe('mesaDaRodada', () => {
  test('só pedido com comanda e mesa é rodada', () => {
    assert.equal(mesaDaRodada({ comanda_id: 'c1', mesa: '2' }), '2')
    assert.equal(mesaDaRodada({ comanda_id: 'c1', mesa: ' 7 ' }), '7')
    assert.equal(mesaDaRodada({ comanda_id: null, mesa: '2' }), null)
    assert.equal(mesaDaRodada({ comanda_id: 'c1', mesa: '  ' }), null)
    assert.equal(mesaDaRodada({ mesa: '2' }), null)
  })
})

describe('textoBarraComanda', () => {
  for (const [papel, colunasBarra] of [['58mm', 8], ['80mm', 12]] as const) {
    test(`${papel}: rodada mostra a mesa na barra e guarda a senha`, () => {
      const r = textoBarraComanda({ comandaMesa: true, mesa: '2', senha: 5 }, colunasBarra)
      assert.deepEqual(r, { barra: 'MESA 2', senhaNumero: '005', comMesa: true })
    })
  }

  test('sem comanda a barra continua sendo a senha', () => {
    assert.deepEqual(textoBarraComanda({ mesa: '2', senha: 5 }, 8), { barra: '005', senhaNumero: '005', comMesa: false })
    assert.equal(textoBarraComanda({ comandaMesa: false, mesa: '2', senha: null }, 8).barra, '---')
  })

  test('nome de mesa com acento vira ASCII maiúsculo; o que não cabe volta para a senha', () => {
    assert.equal(textoBarraComanda({ comandaMesa: true, mesa: 'Açaí', senha: 5 }, 12).barra, 'MESA ACAI')
    assert.deepEqual(textoBarraComanda({ comandaMesa: true, mesa: 'Varanda dos fundos', senha: 5 }, 8), {
      barra: '005',
      senhaNumero: '005',
      comMesa: false,
    })
  })
})

describe('guardas das telas', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('Chamada não chama rodada de mesa por senha', () => {
    assert.match(ler('pages/TelaChamada.tsx'), /p\.status === 'pronto' && !mesaDaRodada\(p\)/)
  })

  test('os dois caminhos de impressão marcam a rodada', () => {
    const h = ler('hooks/useImpressaoAutomatica.ts')
    assert.match(h, /comandaMesa: mesaDaRodada\(pedido\) !== null/)
    assert.match(h, /comandaMesa: barracaRef\.current\?\.comanda_aberta_habilitada === true/)
  })

  test('barra de navegação só mostra Mesas com a comanda ligada', () => {
    const b = ler('components/BarraNavegacao.tsx')
    assert.match(b, /ITENS\.filter\(\(item\) => comanda \|\| !item\.soComComanda\)/)
  })
})
