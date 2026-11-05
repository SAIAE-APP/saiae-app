// Guarda dos pontos de contato do cashback em CardapioPublico.tsx (spec 2026-10-27, Task 20, pontos C1 a C6).
// Este teste É a lista de contatos: se o cardápio mover os blocos para outros componentes, ajuste-o, não o remova.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const fonte = readFileSync(new URL('../src/pages/CardapioPublico.tsx', import.meta.url), 'utf8')
const contar = (re: RegExp) => (fonte.match(re) ?? []).length

describe('cashback no CardapioPublico', () => {
  test('C1: importa o hook e os três componentes', () => {
    assert.equal(contar(/import \{ useCashback \} from/g), 1)
    assert.match(fonte, /import \{ BlocoCashbackCheckout \}/)
    assert.match(fonte, /import \{ LinhaCashbackGanho \}/)
    assert.match(fonte, /import \{ AvisoCashbackGanho \}/)
  })

  test('C2: uma só instância do hook e descontoCupom soma o saldo usado', () => {
    assert.equal(contar(/useCashback\(\{/g), 1)
    assert.match(fonte, /const descontoCupom = \(cupom\.aplicado\?\.descontoCentavos \?\? 0\) \+ cashback\.usadoCentavos/)
  })

  test('C2: o saldo só vale em pagamento online (nunca no "pagar na entrega")', () => {
    assert.match(fonte, /pagamentoOnline: .*!\(formularioEntregaAberto && formaEntrega === 'na_entrega'\)/)
  })

  test('C3: corpoCashback() entra nos dois corpos de criar-pagamento-pix e em nenhum de criar-pedido-cardapio', () => {
    assert.equal(contar(/cashback\.corpoCashback\(\)/g), 2)
    const trechos = fonte.split("functions.invoke('")
    const pix = trechos.filter((t) => t.startsWith('criar-pagamento-pix'))
    const entrega = trechos.filter((t) => t.startsWith('criar-pedido-cardapio'))
    assert.ok(pix.length >= 2)
    for (const t of entrega) assert.doesNotMatch(t.slice(0, 900), /corpoCashback/)
    assert.equal(pix.filter((t) => /cashback\.corpoCashback\(\)/.test(t.slice(0, 600))).length, 2)
  })

  test('C4: bloco do checkout aparece nos dois resumos e a linha de cupom só renderiza com cupom aplicado', () => {
    assert.equal(contar(/<BlocoCashbackCheckout /g), 2)
    assert.equal(contar(/cupom\.aplicado && descontoCupom > 0 &&/g), 2)
    assert.doesNotMatch(fonte, /\{descontoCupom > 0 && \(/)
  })

  test('C5: linha "Você ganha" no resumo', () => {
    assert.equal(contar(/<LinhaCashbackGanho /g), 1)
  })

  test('C6: aviso na confirmação, pelo Pix (polling) e pelo cartão (resposta síncrona)', () => {
    assert.equal(contar(/<AvisoCashbackGanho /g), 1)
    assert.match(fonte, /cashback_gerado_centavos: data\.cashback_gerado_centavos/)
    assert.match(fonte, /consultar_status_pagamento/)
  })
})
