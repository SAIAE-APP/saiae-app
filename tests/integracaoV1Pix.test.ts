// Ação pix da integracao-v1: recusas puras, total do pendente e guardas estáticas da function. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { recusaDaAcao, totalDoPendente } from '../supabase/functions/_shared/integracaoV1.ts'

const LOJA = {
  nome: 'Loja',
  slug: 'loja',
  modos_atendimento: ['retirada'],
  pagar_na_entrega_habilitado: false,
  pagamento_online_habilitado: true,
  perfil_cliente_obrigatorio: false,
  ia_habilitada: true,
}

describe('recusas do pix', () => {
  test('loja com perfil_cliente_obrigatorio devolve perfil_obrigatorio', () => {
    assert.equal(recusaDaAcao('pix', 'retirada', { ...LOJA, perfil_cliente_obrigatorio: true }, true)?.codigo, 'perfil_obrigatorio')
  })
  test('sem pagamento_online_habilitado devolve sem_pix', () => {
    assert.equal(recusaDaAcao('pix', 'retirada', { ...LOJA, pagamento_online_habilitado: false }, true)?.codigo, 'sem_pix')
  })
  test('bot desligado e loja fechada vêm antes', () => {
    assert.equal(recusaDaAcao('pix', 'retirada', { ...LOJA, ia_habilitada: false }, true)?.codigo, 'bot_desligado')
    assert.equal(recusaDaAcao('pix', 'retirada', LOJA, false)?.codigo, 'fechado')
  })
  test('pix não exige pagar na entrega e libera a loja certa', () => {
    assert.equal(recusaDaAcao('pix', 'retirada', LOJA, true), null)
  })
})

describe('totalDoPendente', () => {
  test('soma quantidade x preço unitário em centavos inteiros e a taxa', () => {
    const itens = [
      { quantidade: 2, preco_centavos_unitario: 1250 },
      { quantidade: 1, preco_centavos_unitario: 399 },
    ]
    assert.equal(totalDoPendente(itens, 0), 2899)
    assert.equal(totalDoPendente(itens, 500), 3399)
    assert.equal(totalDoPendente(null, null), 0)
  })
})

const fonte = readFileSync(new URL('../supabase/functions/integracao-v1/index.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
const pos = (t: string) => {
  const i = fonte.indexOf(t)
  assert.ok(i >= 0, t)
  return i
}

describe('function integracao-v1: pix', () => {
  test('retry do mesmo client_uuid recupera o QR emitido, antes de qualquer recusa ou cobrança nova', () => {
    assert.ok(pos('recuperarQr(') < pos("recusaDaAcao('pix'"))
    assert.ok(pos("recusaDaAcao('pix'") < pos('criarCobranca('))
  })
  test('grava a conversa e o telefone no pendente, com a cobrança referenciando o id dele', () => {
    assert.match(fonte, /conversa_id: c\.conversaId/)
    assert.match(fonte, /cliente_telefone: telefone/)
    assert.match(fonte, /referencia: pendente\.id/)
  })
  test('preço vem do resolver_carrinho (linhas gravadas no pendente) e nada de cupom, entrega ou pedido grátis', () => {
    assert.match(fonte, /itens: r\.linhas/)
    assert.doesNotMatch(fonte, /cupom_|pedido_gratis|criar_pedido_com_cupom/)
  })
  test('o pedido NÃO nasce aqui: só o webhook cria depois do pagamento', () => {
    const trecho = fonte.slice(pos('async function acaoPix'), pos('Deno.serve('))
    assert.doesNotMatch(trecho, /criar_pedido/)
  })
  test('erro do provedor não vaza detalhe', () => {
    assert.doesNotMatch(fonte, /erro\.detalhe/)
  })
})
