// "Pagar depois", Fase 1: corrigir a forma de pagamento no Histórico (dono, antes da NFC-e). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { mensagemCorrigirMetodo, podeCorrigirMetodo } from '../src/lib/corrigirMetodo.ts'

const pedido = (campos: Record<string, unknown> = {}) => ({ status: 'entregue', metodo_pagamento: 'pix', nfce_status: null, ...campos }) as never

describe('podeCorrigirMetodo', () => {
  test('ligado, forma real e sem nota válida: aparece o botão', () => {
    for (const metodo of ['dinheiro', 'debito', 'credito', 'pix']) assert.equal(podeCorrigirMetodo(pedido({ metodo_pagamento: metodo }), true), true, metodo)
    for (const nfce of [null, undefined, 'erro', 'erro_autorizacao']) assert.equal(podeCorrigirMetodo(pedido({ nfce_status: nfce }), true), true, String(nfce))
  })

  test('desligado nunca (telas iguais às de antes)', () => {
    assert.equal(podeCorrigirMetodo(pedido(), false), false)
  })

  test('nota autorizada, em processamento ou de status desconhecido trava', () => {
    for (const nfce of ['autorizado', 'processando_autorizacao', 'cancelado', 'qualquer']) assert.equal(podeCorrigirMetodo(pedido({ nfce_status: nfce }), true), false, nfce)
  })

  test('sem forma real não corrige (a receber usa Definir; grátis e cancelado não mudam)', () => {
    for (const metodo of ['na_entrega', 'gratis', 'misto', null]) assert.equal(podeCorrigirMetodo(pedido({ metodo_pagamento: metodo }), true), false, String(metodo))
    assert.equal(podeCorrigirMetodo(pedido({ status: 'cancelado' }), true), false)
  })
})

describe('mensagemCorrigirMetodo', () => {
  test('cada estado da RPC tem frase própria; o desconhecido cai numa genérica', () => {
    for (const estado of ['nfce_emitida', 'cancelado', 'nao_corrigivel', 'sem_acesso', 'nao_autenticado', 'metodo_invalido']) {
      assert.notEqual(mensagemCorrigirMetodo(estado), mensagemCorrigirMetodo(undefined), estado)
    }
    assert.match(mensagemCorrigirMetodo('sem_acesso'), /dono/)
    assert.match(mensagemCorrigirMetodo('nfce_emitida'), /nota fiscal/)
    assert.match(mensagemCorrigirMetodo('qualquer'), /Tente de novo/)
  })
})

describe('Histórico (guardas estáticas)', () => {
  const h = readFileSync(new URL('../src/pages/Historico.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  test('o botão só aparece pela regra pura e atualiza o card com o método que ficou valendo', () => {
    assert.match(h, /podeCorrigirMetodo\(pedido, pagarDepoisLigado\(barraca\)\) && \(\n\s+<BotaoCorrigirPagamento/)
    assert.match(h, /onCorrigido=\{\(metodo\) => onMetodoDefinido\(pedido\.id, metodo\)\}/)
  })

  test('o componente chama a RPC de correção e não enfileira (ação de gestão, só online)', () => {
    const c = readFileSync(new URL('../src/components/BotaoCorrigirPagamento.tsx', import.meta.url), 'utf8')
    assert.match(c, /rpc\('corrigir_metodo_pagamento'/)
    assert.doesNotMatch(c, /enfileirar\(|from '\.\.\/lib\/fila'/)
    assert.match(c, /Sem internet\. A forma de pagamento não foi trocada\./)
  })
})
