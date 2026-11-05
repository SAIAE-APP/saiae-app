// Nomes, ajuda e aviso da cozinha por tipo de pedido. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ROTULO_MODO,
  ROTULO_MODO_CARDAPIO,
  ajudaDoModo,
  avisoCozinha,
  faixaImpressao,
} from '../src/lib/atendimento.ts'

test('operador vê "Para viagem"; cliente do cardápio continua vendo "Retirada"', () => {
  assert.equal(ROTULO_MODO.retirada, 'Para viagem')
  assert.equal(ROTULO_MODO_CARDAPIO.retirada, 'Retirada')
  assert.equal(ROTULO_MODO_CARDAPIO.entrega, 'Entrega')
})

test('ajudaDoModo explica o tipo conforme os interruptores da barraca', () => {
  assert.equal(ajudaDoModo('mesa', { comanda_aberta_habilitada: true }), 'Comer aqui · conta aberta, paga no fim')
  assert.equal(ajudaDoModo('mesa', null), 'Comer aqui · paga agora')
  assert.equal(ajudaDoModo('balcao', null), 'Comer aqui · paga agora')
  assert.equal(ajudaDoModo('retirada', null), 'Embalado · paga agora')
  assert.equal(ajudaDoModo('retirada', { pagamento_depois_habilitado: true }), 'Embalado · paga agora ou depois')
  assert.equal(ajudaDoModo('entrega', null), 'Embalado + endereço · paga agora')
})

test('avisoCozinha diz o que a cozinha vai receber', () => {
  assert.equal(avisoCozinha('retirada'), 'Cozinha vai receber: PARA VIAGEM (embalar)')
  assert.equal(avisoCozinha('mesa'), 'Cozinha vai receber: MESA (comer aqui)')
  assert.equal(avisoCozinha('balcao'), 'Cozinha vai receber: BALCÃO (comer aqui)')
  assert.equal(avisoCozinha('entrega'), 'Cozinha vai receber: ENTREGA (embalar)')
})

test('faixa da comanda: Para viagem perde os asteriscos quando não cabe', () => {
  assert.equal(faixaImpressao('retirada', { colunasFaixa: 24 }), '*** PARA VIAGEM ***')
  assert.equal(faixaImpressao('retirada', { colunasFaixa: 16 }), 'PARA VIAGEM')
})
