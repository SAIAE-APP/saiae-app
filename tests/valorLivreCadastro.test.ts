// Valor livre, PR 2/4: cadastro do item em Ajustes (toggle, preço de reserva, sem estoque, aviso fiscal).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ajustes = ler('src/pages/Ajustes.tsx')

describe('cadastro de item com preço aberto', () => {
  test('a opção só aparece se o banco já tem a coluna (ou o item já é de preço aberto)', () => {
    assert.match(ajustes, /suportaPrecoAberto=\{itens\.length === 0 \|\| itens\.some\(\(i\) => i\.preco_aberto !== undefined\)\}/)
    assert.match(ajustes, /const mostrarPrecoAberto = suportaPrecoAberto \|\| !!existente\?\.preco_aberto/)
  })
  test('com preço aberto o preço de reserva é R$ 0,00, sem estoque e sem Popular', () => {
    assert.match(ajustes, /preco_centavos: precoAberto \? 0 : reaisParaCentavos\(preco\)/)
    assert.match(ajustes, /if \(precoAberto\) \{\s*campos\.estoque_qtd = null\s*campos\.estoque_esgotado_auto = false\s*campos\.popular = false/)
  })
  test('só manda a coluna preco_aberto quando liga/desliga (banco sem migration não quebra)', () => {
    assert.match(ajustes, /if \(precoAberto \|\| existente\?\.preco_aberto\) campos\.preco_aberto = precoAberto/)
  })
  test('avisa quando faltam NCM, CFOP ou unidade e a lista mostra "Valor livre"', () => {
    assert.match(ajustes, /a nota fiscal deste item não sai/)
    assert.match(ajustes, /item\.preco_aberto \? 'Valor livre' : formatarPrecoBR\(item\.preco_centavos\)/)
  })
})
