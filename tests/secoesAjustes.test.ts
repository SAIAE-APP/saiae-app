// Ajustes: Conta e Cardápio & Operação separados em qualquer largura; no desktop, menu de grupos à esquerda, um grupo por vez.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { GRUPOS_AJUSTES, grupoAtivo, gruposDaCategoria } from '../src/lib/secoesAjustes.ts'

const ajustes = readFileSync(new URL('../src/pages/Ajustes.tsx', import.meta.url), 'utf8')

describe('grupos de Ajustes', () => {
  test('cada categoria tem grupos e ids únicos', () => {
    assert.ok(gruposDaCategoria('conta').length >= 2)
    assert.ok(gruposDaCategoria('cardapio').length >= 4)
    assert.equal(new Set(GRUPOS_AJUSTES.map((g) => g.id)).size, GRUPOS_AJUSTES.length)
  })
  test('grupoAtivo: usa o pedido da URL só se existir NA categoria; senão o primeiro', () => {
    assert.equal(grupoAtivo('cardapio', 'atendimento'), 'atendimento')
    assert.equal(grupoAtivo('cardapio', 'financeiro'), 'cardapio') // grupo de outra categoria
    assert.equal(grupoAtivo('cardapio', null), 'cardapio')
    assert.equal(grupoAtivo('conta', 'xyz'), 'plano')
  })
})

describe('ligação em Ajustes', () => {
  test('toda seção pertence a um grupo que existe (29 seções, nenhuma órfã)', () => {
    const grupos = [...ajustes.matchAll(/<SecaoDaCategoria categoria="(conta|cardapio)" grupo="([\w-]+)"/g)]
    assert.equal(grupos.length, 29)
    const ids = new Set(GRUPOS_AJUSTES.map((g) => `${g.categoria}:${g.id}`))
    for (const [, cat, grupo] of grupos) assert.ok(ids.has(`${cat}:${grupo}`), `${cat}:${grupo}`)
  })
  test('a categoria esconde em qualquer largura; o grupo só do desktop (celular mostra a categoria inteira)', () => {
    assert.match(ajustes, /if \(categoria !== atual\) return <div className="hidden">\{children\}<\/div>/)
    assert.match(ajustes, /clsx\('contents', grupo !== grupoAtual && 'md:hidden'\)/)
  })
  test('as abas Conta / Cardápio & Operação aparecem também no celular', () => {
    assert.match(ajustes, /<div className="mt-3 flex gap-1\.5">\s+\{ABAS_CATEGORIA\.map/)
  })
  test('o menu fica escondido no celular e lembra a escolha na URL (?secao=)', () => {
    assert.match(ajustes, /aria-label="Seções de Ajustes" className="sticky top-32 hidden flex-col gap-1 md:flex"/)
    assert.match(ajustes, /setParams\(\{ secao: g\.id \}, \{ replace: true \}\)/)
  })
})
