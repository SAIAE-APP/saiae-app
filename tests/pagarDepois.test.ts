// "Pagar depois", Fase 1: interruptor por barraca, opção em Confirmar Pedido, etiqueta "A receber" e linha da comanda.
// Interruptor desligado = app igual ao de antes. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  LINHA_COMANDA_A_RECEBER,
  linhaPagamentoAReceber,
  modoPermitePagarDepois,
  opcaoPagarDepois,
  pagarDepoisLigado,
  pedidoAReceber,
  podeEnviarAReceber,
} from '../src/lib/pagarDepois.ts'

const LIGADA = { pagamento_depois_habilitado: true }
const DESLIGADA = { pagamento_depois_habilitado: false }
const pedido = (campos: Record<string, unknown>) =>
  ({ tipo_atendimento: 'retirada', mesa: null, viagem: true, metodo_pagamento: 'na_entrega', status: 'novo', ...campos }) as never

describe('interruptor', () => {
  test('só "true" liga; ausente (banco/cache antigo), false e barraca nula são desligado', () => {
    assert.equal(pagarDepoisLigado(LIGADA), true)
    for (const b of [DESLIGADA, {}, null, undefined]) assert.equal(pagarDepoisLigado(b as never), false)
  })
})

describe('opção em Confirmar Pedido', () => {
  test('Retirada ligada: "Pagar na retirada"; Entrega ligada: "Pagar na entrega"; as duas usam o valor interno na_entrega', () => {
    assert.deepEqual(opcaoPagarDepois(LIGADA, 'retirada'), { chave: 'na_entrega', label: 'Pagar na retirada', icone: 'takeout_dining' })
    assert.deepEqual(opcaoPagarDepois(LIGADA, 'entrega'), { chave: 'na_entrega', label: 'Pagar na entrega', icone: 'two_wheeler' })
  })

  test('Mesa e Balcão ficam de fora; desligado não oferece nada', () => {
    for (const modo of ['mesa', 'balcao', null, undefined, 'qualquer']) assert.equal(opcaoPagarDepois(LIGADA, modo), null, String(modo))
    for (const modo of ['retirada', 'entrega']) assert.equal(opcaoPagarDepois(DESLIGADA, modo), null)
    assert.equal(modoPermitePagarDepois('retirada'), true)
    assert.equal(modoPermitePagarDepois('mesa'), false)
  })

  test('o envio de na_entrega: sempre na Entrega (como já era); na Retirada só ligado; nunca em Mesa/Balcão', () => {
    assert.equal(podeEnviarAReceber(DESLIGADA, 'entrega'), true)
    assert.equal(podeEnviarAReceber(DESLIGADA, 'retirada'), false)
    assert.equal(podeEnviarAReceber(LIGADA, 'retirada'), true)
    assert.equal(podeEnviarAReceber(LIGADA, 'mesa'), false)
    assert.equal(podeEnviarAReceber(LIGADA, 'balcao'), false)
  })
})

describe('etiqueta "A receber"', () => {
  test('ligado: na_entrega de Retirada ou Entrega não cancelado', () => {
    assert.equal(pedidoAReceber(pedido({}), true), true)
    assert.equal(pedidoAReceber(pedido({ tipo_atendimento: 'entrega' }), true), true)
    assert.equal(pedidoAReceber(pedido({ tipo_atendimento: null, viagem: true }), true), true, 'derivado de viagem = retirada')
  })
  test('desligado: nunca (telas iguais às de antes); método real, cancelado e Mesa/Balcão também não', () => {
    assert.equal(pedidoAReceber(pedido({}), false), false)
    assert.equal(pedidoAReceber(pedido({ metodo_pagamento: 'pix' }), true), false)
    assert.equal(pedidoAReceber(pedido({ metodo_pagamento: null }), true), false)
    assert.equal(pedidoAReceber(pedido({ status: 'cancelado' }), true), false)
    assert.equal(pedidoAReceber(pedido({ tipo_atendimento: 'mesa', mesa: '3', viagem: false }), true), false)
    assert.equal(pedidoAReceber(pedido({ tipo_atendimento: 'balcao', viagem: false }), true), false)
  })
})

describe('comanda impressa', () => {
  test('"PAGAMENTO: A RECEBER" só com o interruptor ligado e pagamento pendente em Retirada/Entrega', () => {
    assert.equal(linhaPagamentoAReceber('na_entrega', 'retirada', true), LINHA_COMANDA_A_RECEBER)
    assert.equal(linhaPagamentoAReceber('na_entrega', 'entrega', true), 'PAGAMENTO: A RECEBER')
    assert.equal(linhaPagamentoAReceber('na_entrega', 'entrega', false), null, 'desligado: a comanda segue a de antes')
    assert.equal(linhaPagamentoAReceber('pix', 'retirada', true), null)
    assert.equal(linhaPagamentoAReceber(null, 'retirada', true), null)
    assert.equal(linhaPagamentoAReceber('na_entrega', 'mesa', true), null)
    assert.match(LINHA_COMANDA_A_RECEBER, /^[\x20-\x7e]+$/, 'sem acento')
  })

  test('montarComanda usa a linha e mantém a de sempre quando não é pagar depois', () => {
    const f = readFileSync(new URL('../src/lib/impressoraTermica.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(f, /linhaPagamentoAReceber\(dados\.metodoPagamento, tipo, dados\.pagarDepois === true\)/)
    assert.match(f, /\} else if \(dados\.metodoPagamento\) \{\n    encoder = encoder\.line\(semAcento\(`Pagamento: \$\{humanizarMetodo\(dados\.metodoPagamento\)\}`\)\)/)
  })

  test('os dois caminhos de impressão passam o interruptor da barraca', () => {
    const h = readFileSync(new URL('../src/hooks/useImpressaoAutomatica.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(h, /pagarDepois: barraca\.pagamento_depois_habilitado === true/)
    assert.match(h, /pagarDepois: barracaRef\.current\?\.pagamento_depois_habilitado === true/)
    assert.match(h, /dadosComandaDoPedido\(pedido, \{ \.\.\.cfg, pagamento_depois_habilitado: barracaRef\.current\?\.pagamento_depois_habilitado \}\)/)
  })
})

describe('telas (guardas estáticas)', () => {
  const ler = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  test('Confirmar Pedido: a opção da Retirada só entra pelo interruptor e o guarda de envio usa a mesma regra', () => {
    const c = ler('pages/ConfirmarPedido.tsx')
    assert.match(c, /!ehEntrega && opcaoPagarDepois\(barraca, estado\?\.tipoAtendimento\)/)
    assert.match(c, /metodoSelecionado === METODO_NA_ENTREGA && !podeEnviarAReceber\(barraca, tipoAtendimento\)/)
    assert.match(c, /\.\.\.\(ehEntrega \? \[OPCAO_PAGAR_NA_ENTREGA\] : \[\]\)/, 'a opção que já existia na Entrega continua')
  })

  test('Cozinha, Detalhe e Histórico mostram a etiqueta só pelo interruptor', () => {
    for (const p of ['pages/Cozinha.tsx', 'components/DetalheComanda.tsx', 'pages/Historico.tsx']) {
      assert.match(ler(p), /pedidoAReceber\(pedido, pagarDepoisLigado\(barraca\)\)/, p)
    }
  })

  test('Ajustes: a seção fica em Cardápio & Operação e some em banco sem a coluna', () => {
    assert.match(ler('pages/Ajustes.tsx'), /<SecaoDaCategoria categoria="cardapio" atual=\{categoria\}>\n\s+<SecaoPagamentoDepois barraca=\{barraca\} \/>/)
    assert.match(ler('components/SecaoPagamentoDepois.tsx'), /if \(barraca\.pagamento_depois_habilitado === undefined\) return null/)
  })
})
