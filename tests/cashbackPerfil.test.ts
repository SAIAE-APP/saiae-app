import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { rotuloLancamento, textoSaldoPerdido } from '../src/lib/cashbackTexto.ts'

const ler = (c: string) => readFileSync(new URL(`../src/${c}`, import.meta.url), 'utf8')
const normal = (s: string) => s.replace(/\s/g, ' ')

describe('textos do perfil', () => {
  test('rótulos dos lançamentos em português', () => {
    assert.equal(rotuloLancamento('credito'), 'Ganhou')
    assert.equal(rotuloLancamento('resgate'), 'Usou')
    assert.equal(rotuloLancamento('estorno_credito'), 'Estorno')
    assert.equal(rotuloLancamento('estorno_resgate'), 'Estorno')
    assert.equal(rotuloLancamento('expiracao'), 'Venceu')
    assert.equal(rotuloLancamento('qualquer_coisa'), 'Ajuste')
  })
  test('aviso de saldo perdido só com saldo', () => {
    assert.match(normal(textoSaldoPerdido(1250)), /R\$ 12,50.*perdido/)
    assert.equal(textoSaldoPerdido(0), '')
  })
})

describe('telas do perfil (texto)', () => {
  const perfil = ler('pages/PerfilCliente.tsx')
  const bloco = ler('components/cashback/BlocoSaldoCashback.tsx')
  test('Privacidade fala do saldo de cashback, por loja, validade e apagar', () => {
    const p = ler('pages/Privacidade.tsx')
    assert.match(p, /saldo de cashback/)
    assert.match(p, /por loja/)
    assert.match(p, /vence/)
    assert.match(p, /sem identificação/)
  })
  test('PerfilCliente importa o bloco uma vez e avisa a perda no fluxo apagar', () => {
    assert.equal([...perfil.matchAll(/import \{ BlocoSaldoCashback \}/g)].length, 1)
    assert.equal([...perfil.matchAll(/<BlocoSaldoCashback /g)].length, 1)
    assert.match(perfil, /textoSaldoPerdido/)
  })
  test('o bloco não imprime telefone nem nome e não quebra a página na falha', () => {
    assert.doesNotMatch(bloco, /telefone|\.nome\b/)
    assert.match(bloco, /Não foi possível carregar o saldo/)
    assert.match(bloco, /chamarSessao\(slug, 'cashback'\)/)
  })
})
