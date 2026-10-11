// Valor livre, PR 3/4: validação do valor e ligação no Lançar Pedido.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  LIMITE_VALOR_LIVRE_CENTAVOS,
  MAX_OBS_VALOR_LIVRE,
  chaveValorLivre,
  validarValorLivre,
} from '../src/lib/valorLivre.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('validarValorLivre', () => {
  test('aceita valor e observação válidos (vírgula decimal, espaços aparados)', () => {
    const r = validarValorLivre('1,35', '  bala de menta ')
    assert.deepEqual(r, { ok: true, centavos: 135, observacao: 'bala de menta' })
  })
  test('valor vazio, zero ou negativo é recusado', () => {
    for (const v of ['', '0', '0,00', '-1']) assert.equal(validarValorLivre(v, 'bala').ok, false, v)
  })
  test('limite de R$ 9.999,99 por linha', () => {
    assert.equal(validarValorLivre('9999,99', 'caixa').ok, true)
    assert.equal(validarValorLivre('10000', 'caixa').ok, false)
    assert.equal(LIMITE_VALOR_LIVRE_CENTAVOS, 999_999)
  })
  test('observação obrigatória, de 2 a 60 caracteres', () => {
    assert.equal(validarValorLivre('2', '').ok, false)
    assert.equal(validarValorLivre('2', 'a').ok, false)
    assert.equal(validarValorLivre('2', 'ab').ok, true)
    assert.equal(validarValorLivre('2', 'x'.repeat(MAX_OBS_VALOR_LIVRE)).ok, true)
    assert.equal(validarValorLivre('2', 'x'.repeat(MAX_OBS_VALOR_LIVRE + 1)).ok, false)
  })
  test('cada confirmação gera uma chave de linha própria', () => {
    assert.notEqual(chaveValorLivre('item-1', 'a'), chaveValorLivre('item-1', 'b'))
  })
})

describe('Lançar Pedido com item de preço aberto', () => {
  const lp = ler('src/pages/LancarPedido.tsx')
  test('o + abre a folha de valor e o − tira a última linha do item', () => {
    assert.match(lp, /item\.preco_aberto\s*\?\s*abrirValorLivre\(item\)/)
    assert.match(lp, /item\.preco_aberto \|\| gruposDoItem\(item\.id\)\.length > 0\s*\?\s*decrementarComOpcoes\(item\.id\)/)
  })
  test('a linha entra com quantidade 1, preço digitado e a observação do que foi vendido', () => {
    assert.match(lp, /precoUnitarioCentavos: centavos/)
    assert.match(lp, /setCarrinho\(\(atual\) => \(\{ \.\.\.atual, \[chave\]: 1 \}\)\)/)
    assert.match(lp, /definirObservacaoItem\(chave, obs\)/)
  })
  test('o cartão mostra "Valor livre" em vez de "Sem preço"', () => {
    assert.equal((lp.match(/'Valor livre'/g) ?? []).length, 2)
  })
})
