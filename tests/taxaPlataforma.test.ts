// Taxa de serviço Sai aê na tela do cardápio: espelho do servidor (_shared/pagamento/taxaPlataforma.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { TAXA_PLATAFORMA_CENTAVOS, totalComTaxaPlataforma } from '../src/lib/taxaPlataforma.ts'

test('taxaPlataforma: soma R$ 0,99 ao total', () => {
  assert.equal(totalComTaxaPlataforma(1500), 1599)
  assert.equal(totalComTaxaPlataforma(1), 100)
})

test('taxaPlataforma: total zero (pedido grátis) não paga taxa', () => {
  assert.equal(totalComTaxaPlataforma(0), 0)
})

test('taxaPlataforma: total inválido não vira cobrança', () => {
  assert.throws(() => totalComTaxaPlataforma(-1), RangeError)
  assert.throws(() => totalComTaxaPlataforma(10.5), RangeError)
})

test('taxaPlataforma: constante do front igual à do servidor', () => {
  const servidor = readFileSync(new URL('../supabase/functions/_shared/pagamento/taxaPlataforma.ts', import.meta.url), 'utf8')
  const valor = servidor.match(/export const TAXA_PLATAFORMA_CENTAVOS = (\d+)/)
  assert.ok(valor, 'constante não encontrada no servidor')
  assert.equal(TAXA_PLATAFORMA_CENTAVOS, Number(valor[1]))
  assert.equal(TAXA_PLATAFORMA_CENTAVOS, 99)
})
