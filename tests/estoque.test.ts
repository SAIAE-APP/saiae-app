// Testes da lógica pura do estoque (npm test).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ESTOQUE_BAIXO,
  avisoDeEstoque,
  controlaEstoque,
  interpretarAjuste,
  interpretarSaldoInicial,
  mensagemAjusteEstoque,
  nivelDeEstoque,
  rotuloMovimento,
  textoRestam,
} from '../src/lib/estoque.ts'

test('sem controle (null/undefined): sem nível, sem aviso, sem "Restam"', () => {
  for (const item of [{ estoque_qtd: null }, {}]) {
    assert.equal(controlaEstoque(item), false)
    assert.equal(nivelDeEstoque(item), null)
    assert.equal(avisoDeEstoque(item), null)
    assert.equal(textoRestam(item), null)
  }
})

test('níveis: negativo, zerado, baixo (<=5) e ok', () => {
  assert.equal(nivelDeEstoque({ estoque_qtd: -3 }), 'negativo')
  assert.equal(nivelDeEstoque({ estoque_qtd: 0 }), 'zerado')
  assert.equal(nivelDeEstoque({ estoque_qtd: 1 }), 'baixo')
  assert.equal(nivelDeEstoque({ estoque_qtd: ESTOQUE_BAIXO }), 'baixo')
  assert.equal(nivelDeEstoque({ estoque_qtd: ESTOQUE_BAIXO + 1 }), 'ok')
})

test('"Restam N" só com saldo baixo e positivo', () => {
  assert.equal(textoRestam({ estoque_qtd: 3 }), 'Restam 3')
  assert.equal(textoRestam({ estoque_qtd: 5 }), 'Restam 5')
  assert.equal(textoRestam({ estoque_qtd: 6 }), null)
  assert.equal(textoRestam({ estoque_qtd: 0 }), null)
  assert.equal(textoRestam({ estoque_qtd: -1 }), null)
})

test('aviso em Ajustes: negativo e zerado em destaque, baixo só aviso, ok sem nada', () => {
  assert.deepEqual(avisoDeEstoque({ estoque_qtd: -2 }), {
    nivel: 'negativo',
    texto: 'Estoque negativo: vendido além do saldo',
    destaque: 'erro',
  })
  assert.equal(avisoDeEstoque({ estoque_qtd: 0 })?.destaque, 'erro')
  assert.deepEqual(avisoDeEstoque({ estoque_qtd: 4 }), {
    nivel: 'baixo',
    texto: 'Estoque baixo: restam 4',
    destaque: 'aviso',
  })
  assert.equal(avisoDeEstoque({ estoque_qtd: 50 }), null)
})

test('saldo inicial: inteiro >= 0', () => {
  assert.equal(interpretarSaldoInicial('12'), 12)
  assert.equal(interpretarSaldoInicial(' 0 '), 0)
  assert.equal(interpretarSaldoInicial(''), null)
  assert.equal(interpretarSaldoInicial('-1'), null)
  assert.equal(interpretarSaldoInicial('1,5'), null)
  assert.equal(interpretarSaldoInicial('abc'), null)
  assert.equal(interpretarSaldoInicial('99999999'), null)
})

test('ajuste: inteiro com sinal, diferente de zero', () => {
  assert.equal(interpretarAjuste('10'), 10)
  assert.equal(interpretarAjuste('+10'), 10)
  assert.equal(interpretarAjuste('-4'), -4)
  assert.equal(interpretarAjuste('0'), null)
  assert.equal(interpretarAjuste('-0'), null)
  assert.equal(interpretarAjuste(''), null)
  assert.equal(interpretarAjuste('2.5'), null)
  assert.equal(interpretarAjuste('1e3'), null)
})

test('mensagens de erro e rótulos de movimento', () => {
  assert.match(mensagemAjusteEstoque('sem_acesso'), /permissão/)
  assert.match(mensagemAjusteEstoque(undefined), /Não foi possível/)
  assert.equal(rotuloMovimento('venda'), 'Venda')
  assert.match(rotuloMovimento('cancelamento'), /cancelado/)
  assert.match(rotuloMovimento('remocao'), /removido/)
  assert.equal(rotuloMovimento('ajuste'), 'Ajuste manual')
})
