// Resumo do "Pagar na entrega" enviado ao WhatsApp do dono. Item simples fica idêntico ao de antes;
// item com opções (SAI-010a) ganha as escolhas e a observação logo abaixo. Rodar: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { montarMensagemPagarNaEntrega } from '../src/lib/pagarNaEntrega.ts'

const base = {
  nomeBarraca: 'Barraca X',
  senha: 7,
  nome: 'Ana',
  telefone: '(11) 99999-0000',
  endereco: '',
  observacao: '',
  totalCentavos: 0,
}

test('item simples: texto igual ao de antes', () => {
  const m = montarMensagemPagarNaEntrega({
    ...base,
    itens: [{ nome_item: 'Refri', quantidade: 2, preco_centavos_unitario: 600 }],
    totalCentavos: 1200,
  })
  assert.equal(
    m,
    ['*Novo pedido - pagar na entrega* (senha 007)', 'Barraca: Barraca X', '', '2x Refri - R$ 12,00', '', '*Total: R$ 12,00* (pago na entrega)', '', 'Cliente: Ana', 'Telefone: (11) 99999-0000'].join('\n'),
  )
})

test('opcoes vazias ou observação em branco não criam linhas extras', () => {
  const m = montarMensagemPagarNaEntrega({
    ...base,
    itens: [{ nome_item: 'Refri', quantidade: 1, preco_centavos_unitario: 600, opcoes: [], observacao: '   ' }],
    totalCentavos: 600,
  })
  assert.ok(!m.includes('Obs:'))
  assert.equal(m.split('\n').filter((l) => l.startsWith('   ')).length, 0)
})

test('item com opções: escolhas e observação aparecem abaixo do item, com o preço final da linha', () => {
  const m = montarMensagemPagarNaEntrega({
    ...base,
    itens: [
      {
        nome_item: 'Yakisoba',
        quantidade: 2,
        preco_centavos_unitario: 3500,
        opcoes: [{ nome: 'Grande' }, { nome: 'Ovo' }],
        observacao: 'sem cebola',
      },
    ],
    totalCentavos: 7000,
  })
  const linhas = m.split('\n')
  const i = linhas.indexOf('2x Yakisoba - R$ 70,00')
  assert.ok(i >= 0)
  assert.equal(linhas[i + 1], '   Grande, Ovo')
  assert.equal(linhas[i + 2], '   Obs: sem cebola')
})
