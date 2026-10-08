// Tela do pedido grátis: decisão e leitura da resposta. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ehPedidoGratis, lerPedidoGratis, telefoneServePedidoGratis } from '../src/lib/pedidoGratis.ts'
import { humanizarMetodo } from '../src/lib/metodoPagamento.ts'
import { readFileSync } from 'node:fs'

test('só total zero é grátis (taxa a pagar mantém o Pix)', () => {
  assert.equal(ehPedidoGratis(0), true)
  assert.equal(ehPedidoGratis(null), false)
  assert.equal(ehPedidoGratis(300), false)
})

test('telefone com DDD, formatado ou não', () => {
  assert.equal(telefoneServePedidoGratis('(11) 99999-0000'), true)
  assert.equal(telefoneServePedidoGratis('5511999990000'), true)
  assert.equal(telefoneServePedidoGratis('9999-0000'), false)
  assert.equal(telefoneServePedidoGratis(''), false)
})

test('resposta grátis: lê a senha; resposta de Pix não é grátis', () => {
  assert.deepEqual(lerPedidoGratis({ pedido_gratis: true, senha: 7, pedido_id: 'x' }), { senha: 7 })
  assert.deepEqual(lerPedidoGratis({ pedido_gratis: true }), { senha: null })
  assert.equal(lerPedidoGratis({ pendente_id: 'p', qr_code: 'q' }), null)
  assert.equal(lerPedidoGratis(null), null)
})

test('método gratis: rótulo próprio e linha própria no relatório (não conta como Pix)', () => {
  assert.equal(humanizarMetodo('gratis'), 'Grátis (cupom)')
  const rel = readFileSync(new URL('../src/lib/relatorio.ts', import.meta.url), 'utf8')
  assert.match(rel, /MetodoOuNaoInformado = MetodoPagamento | 'na_entrega' | 'gratis'/)
  assert.match(rel, /gratis: null,/)
})
