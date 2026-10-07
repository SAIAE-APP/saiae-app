// Rodapé PROCON da comanda (58mm = 32 colunas, 80mm = 48). Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linhasRodapeProcon } from '../src/lib/rodapeProcon.ts'

test('sem endereço: só PROCON 151', () => {
  for (const vazio of [null, undefined, '', '   ']) {
    assert.deepEqual(linhasRodapeProcon(vazio, 32), ['PROCON 151'])
  }
})

test('com endereço: PROCON 151 + Sede, sem acento', () => {
  assert.deepEqual(linhasRodapeProcon('Av. São João, 1', 48), ['PROCON 151', 'Sede: Av. Sao Joao, 1'])
})

test('nenhuma linha passa da largura do papel (58mm e 80mm)', () => {
  const longo = 'Rua Marechal Deodoro da Fonseca, 1234, Centro, Taguatinga - Distrito Federal, CEP 72010-000'
  for (const colunas of [32, 48]) {
    const linhas = linhasRodapeProcon(longo, colunas)
    assert.ok(linhas.length > 2)
    for (const l of linhas) assert.ok(l.length <= colunas, `${l.length} > ${colunas}: ${l}`)
    assert.equal(linhas.slice(1).join(' '), `Sede: ${longo}`)
  }
})

test('palavra maior que a linha é cortada, sem perder texto', () => {
  const linhas = linhasRodapeProcon('x'.repeat(70), 32)
  for (const l of linhas) assert.ok(l.length <= 32)
  assert.equal(linhas.slice(1).join('').replace('Sede:', ''), 'x'.repeat(70))
})
