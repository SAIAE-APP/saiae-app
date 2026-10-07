// Testes da lógica pura do estoque (npm test).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ESTOQUE_BAIXO,
  avisoDeEstoque,
  avisoPassaDoEstoque,
  controlaEstoque,
  excessosDoCarrinho,
  interpretarAjuste,
  interpretarSaldoInicial,
  mensagemAjusteEstoque,
  mensagemExcessos,
  nivelDeEstoque,
  rotuloMovimento,
  textoRestam,
  verificarAdicao,
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

// ---- Bloqueio opcional por barraca (Sprint 6, ajuste do #29) ----

test('item sem controle de estoque nunca é limitado, com ou sem bloqueio', () => {
  for (const bloqueia of [true, false]) {
    assert.deepEqual(verificarAdicao({ estoque_qtd: null }, 99, bloqueia), { ok: true })
    assert.deepEqual(verificarAdicao({}, 99, bloqueia), { ok: true })
  }
  assert.equal(avisoPassaDoEstoque({ estoque_qtd: null }, 50), null)
  assert.deepEqual(excessosDoCarrinho([{ id: 'a', nome: 'A', estoque_qtd: null }], { a: 50 }), [])
})

test('bloqueio LIGADO: não passa do saldo e diz quantos restam', () => {
  const item = { estoque_qtd: 1 }
  assert.deepEqual(verificarAdicao(item, 0, true), { ok: true }) // 1º cabe
  assert.deepEqual(verificarAdicao(item, 1, true), { ok: false, mensagem: 'Restam 1' }) // 2º não
  assert.deepEqual(verificarAdicao({ estoque_qtd: 5 }, 4, true), { ok: true }) // 5º cabe
  assert.deepEqual(verificarAdicao({ estoque_qtd: 5 }, 5, true), { ok: false, mensagem: 'Restam 5' })
})

test('bloqueio LIGADO: saldo zero ou negativo não adiciona', () => {
  assert.deepEqual(verificarAdicao({ estoque_qtd: 0 }, 0, true), { ok: false, mensagem: 'Sem estoque' })
  assert.deepEqual(verificarAdicao({ estoque_qtd: -2 }, 0, true), { ok: false, mensagem: 'Sem estoque' })
})

test('bloqueio DESLIGADO: deixa passar, mas avisa "Passa do estoque: restam N"', () => {
  assert.deepEqual(verificarAdicao({ estoque_qtd: 1 }, 0, false), { ok: true }) // dentro do saldo: sem aviso
  assert.deepEqual(verificarAdicao({ estoque_qtd: 1 }, 1, false), { ok: true, aviso: 'Passa do estoque: restam 1' })
  // o caso do teste do João: saldo 1, lançar 3 unidades -> o 2º e o 3º avisam
  assert.deepEqual(verificarAdicao({ estoque_qtd: 1 }, 2, false), { ok: true, aviso: 'Passa do estoque: restam 1' })
  assert.deepEqual(verificarAdicao({ estoque_qtd: 0 }, 0, false), { ok: true, aviso: 'Passa do estoque: restam 0' })
  assert.deepEqual(verificarAdicao({ estoque_qtd: -3 }, 0, false), { ok: true, aviso: 'Passa do estoque: restam 0' })
})

test('aviso fixo no card quando a quantidade passa do saldo', () => {
  assert.equal(avisoPassaDoEstoque({ estoque_qtd: 1 }, 1), null)
  assert.equal(avisoPassaDoEstoque({ estoque_qtd: 1 }, 3), 'Passa do estoque: restam 1')
  assert.equal(avisoPassaDoEstoque({ estoque_qtd: 0 }, 1), 'Passa do estoque: restam 0')
})

test('excessos do carrinho e mensagem de envio', () => {
  const itens = [
    { id: 'a', nome: 'Yakisoba', estoque_qtd: 2 },
    { id: 'b', nome: 'Gyoza', estoque_qtd: 0 },
    { id: 'c', nome: 'Suco', estoque_qtd: null },
    { id: 'd', nome: 'Tempurá', estoque_qtd: 10 },
  ]
  const excessos = excessosDoCarrinho(itens, { a: 3, b: 1, c: 9, d: 10 })
  assert.deepEqual(excessos, [
    { nome: 'Yakisoba', quantidade: 3, restam: 2 },
    { nome: 'Gyoza', quantidade: 1, restam: 0 },
  ])
  assert.equal(mensagemExcessos(excessos), 'Yakisoba: restam 2; Gyoza: sem estoque')
  assert.deepEqual(excessosDoCarrinho(itens, { a: 2, d: 10 }), []) // no limite exato não é excesso
  assert.deepEqual(excessosDoCarrinho(itens, {}), [])
})
