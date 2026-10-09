// "Pagar depois", Fase 1: forma de pagamento ao tocar Entregue, com fila offline retrocompatível. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { calcularTroco, desfechoDefinirMetodo, totalAPagarCentavos } from '../src/lib/definirMetodoFila.ts'

describe('desfechoDefinirMetodo (o que a fila faz com a resposta da RPC)', () => {
  test('definido, já definido (outro lugar), cancelado, sem acesso e método inválido: sai da fila', () => {
    for (const estado of ['ok', 'ja_definido', 'cancelado', 'sem_acesso', 'metodo_invalido']) {
      assert.equal(desfechoDefinirMetodo(null, { estado }), 'concluida', estado)
    }
  })

  test('banco sem a RPC (PGRST202) adia sem travar a fila; erro de rede/sessão repete', () => {
    assert.equal(desfechoDefinirMetodo({ code: 'PGRST202' }, null), 'adiar')
    assert.equal(desfechoDefinirMetodo({ code: '', message: 'Failed to fetch' }, null), 'repetir')
    assert.equal(desfechoDefinirMetodo({ code: '42501' }, null), 'repetir')
  })

  test('sessão expirada e resposta estranha ou vazia nunca encerram a operação', () => {
    for (const r of [{ estado: 'nao_autenticado' }, { estado: 'outra_coisa' }, {}, null, undefined]) {
      assert.equal(desfechoDefinirMetodo(null, r as never), 'repetir', JSON.stringify(r))
    }
  })
})

describe('total e troco (só informativos)', () => {
  const pedido = {
    itens_do_pedido: [
      { preco_centavos_unitario: 1500, quantidade: 2 },
      { preco_centavos_unitario: 800, quantidade: 1, removido: true },
      { preco_centavos_unitario: 250, quantidade: 4, removido: false },
    ],
    taxa_entrega_centavos: 500,
    desconto_cupom_centavos: 300,
  }
  test('itens ativos + taxa − cupom, nunca negativo', () => {
    assert.equal(totalAPagarCentavos(pedido), 3000 + 1000 + 500 - 300)
    assert.equal(totalAPagarCentavos({ itens_do_pedido: [{ preco_centavos_unitario: 100, quantidade: 1 }], desconto_cupom_centavos: 9999 }), 0)
    assert.equal(totalAPagarCentavos({ itens_do_pedido: [] }), 0)
  })
  test('troco só com valor recebido suficiente', () => {
    assert.equal(calcularTroco(4200, 5000), 800)
    assert.equal(calcularTroco(4200, 4200), 0)
    assert.equal(calcularTroco(4200, 4000), null)
    assert.equal(calcularTroco(4200, null), null)
    assert.equal(calcularTroco(4200, 0), null)
  })
})

describe('fiação (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('Entregue só pergunta a forma em pedido "A receber"; os demais finalizam direto como sempre', () => {
    const c = ler('pages/Cozinha.tsx')
    assert.match(c, /if \(pedidoAReceber\(pedido, pagarDepoisLigado\(barraca\)\)\) \{\n\s+setPedidoParaPagar\(pedido\)\n\s+return\n\s+\}\n\s+void finalizarPedido\(pedido\)/)
    assert.match(c, /onEntregar=\{entregarPedido\}/)
  })

  test('escolher a forma grava na fila e depois finaliza; "Receber depois" finaliza sem definir', () => {
    const c = ler('pages/Cozinha.tsx')
    assert.match(c, /enfileirar\('definir_metodo', \{ pedido_id: pedido\.id, metodo \}\)\n\s+await finalizarPedido\(pedido\)/)
    assert.match(c, /onReceberDepois=\{\(p\) => \{\n\s+setPedidoParaPagar\(null\)\n\s+void finalizarPedido\(p\)/)
  })

  test('a operação definir_metodo da fila: adia sem travar, não desiste de erro de rede', () => {
    const s = ler('hooks/useSincronizacao.ts')
    const caso = s.slice(s.indexOf("case 'definir_metodo'"), s.indexOf("case 'mudar_status'"))
    assert.match(caso, /rpc\('definir_metodo_pagamento', \{ p_pedido_id: pedido_id, p_metodo: metodo \}\)/)
    assert.match(caso, /throw new OperacaoAdiadaError\(/)
    assert.match(caso, /throw error \?\? new Error\(/)
    assert.match(ler('lib/fila.ts'), /'definir_metodo'/)
  })

  test('o modal oferece as quatro formas, "Receber depois" e o troco só no dinheiro', () => {
    const m = ler('components/ModalFormaPagamento.tsx')
    assert.match(m, /METODOS_DISPONIVEIS\.map/)
    assert.match(m, /Receber depois/)
    assert.match(m, /escolhido === 'dinheiro'/)
    assert.match(m, /Só para calcular o troco; não fica gravado\./)
  })
})
