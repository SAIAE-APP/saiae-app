import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { textoAvisoGanho, textoGanho, textoSaldoBotao, textoValidade } from '../src/lib/cashbackTexto.ts'

const ler = (c: string) => readFileSync(new URL(`../src/${c}`, import.meta.url), 'utf8')
const normal = (s: string) => s.replace(/\s/g, ' ')

describe('cashbackTexto', () => {
  test('textoGanho traz o valor dentro da frase', () => {
    assert.equal(normal(textoGanho(250)), 'Você ganha R$ 2,50 de volta neste pedido')
  })
  test('textoValidade mostra DD/MM no fuso de Brasília', () => {
    assert.equal(textoValidade('2026-12-31T15:00:00.000Z'), '31/12')
    // 01h UTC de 1/1 ainda é 31/12 em Brasília (UTC-3)
    assert.equal(textoValidade('2027-01-01T01:00:00.000Z'), '31/12')
  })
  test('textoValidade com data inválida devolve vazio, nunca "Invalid Date"', () => {
    assert.equal(textoValidade('não é data'), '')
  })
  test('textoSaldoBotao', () => {
    assert.equal(normal(textoSaldoBotao(1000)), 'Usar meu saldo (R$ 10,00)')
  })
  test('textoAvisoGanho: valor e validade; sem validade só o valor; sem ganho vazio', () => {
    assert.equal(normal(textoAvisoGanho(200, '2026-12-31T15:00:00.000Z')), 'Você ganhou R$ 2,00. Vale até 31/12.')
    assert.equal(normal(textoAvisoGanho(200, null)), 'Você ganhou R$ 2,00.')
    assert.equal(textoAvisoGanho(0, '2026-12-31T15:00:00.000Z'), '')
    assert.equal(textoAvisoGanho(undefined, null), '')
  })
})

describe('useCashback e componentes (texto)', () => {
  const hook = ler('hooks/useCashback.ts')
  test('não importa useCupom: o acoplamento é só pela prop cupomAplicado', () => {
    assert.doesNotMatch(hook, /useCupom/)
    assert.match(hook, /!cupomAplicado/)
  })
  test('uso do saldo só em pagamento online e sem cupom (usadoCentavos 0 fora disso)', () => {
    assert.match(hook, /usar && pagamentoOnline && !cupomAplicado/)
  })
  test('sem sessão nada aparece', () => {
    assert.match(hook, /token/)
    assert.match(hook, /SUPOSIÇÃO-CASHBACK-2/)
  })
  test('o ganho só aparece com o cashback ligado na loja', () => {
    assert.match(hook, /config\.habilitado/)
  })
  test('a prévia usa as regras puras; o servidor recalcula', () => {
    for (const f of ['calcularResgate', 'calcularCredito', 'itensLiquidosCentavos']) assert.match(hook, new RegExp(f))
  })
  test('o bloco do checkout tem toque de 44 px, vem desmarcado e explica o cupom', () => {
    const bloco = ler('components/cashback/BlocoCashbackCheckout.tsx')
    assert.match(bloco, /min-h-11/)
    assert.match(ler('lib/cashbackTexto.ts'), /Cupom e saldo não somam\. Remova o cupom para usar o saldo\./)
    assert.match(bloco, /aviso/)
    assert.match(bloco, /SUPOSIÇÃO-CASHBACK-4/)
  })
  test('nenhum componente usa emoji', () => {
    for (const f of ['BlocoCashbackCheckout', 'LinhaCashbackGanho', 'AvisoCashbackGanho']) {
      assert.doesNotMatch(ler(`components/cashback/${f}.tsx`), /\p{Extended_Pictographic}/u)
    }
  })
})
