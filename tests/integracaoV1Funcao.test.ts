// Guardas estáticas da edge function integracao-v1 (rota servidor→servidor assinada). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const fonte = readFileSync(new URL('../supabase/functions/integracao-v1/index.ts', import.meta.url), 'utf8')
// Só o código, sem os comentários de cabeçalho (que citam createClient e console de propósito).
const codigo = fonte.replace(/\/\/.*$/gm, '')
const pos = (trecho: string) => {
  const i = codigo.indexOf(trecho)
  assert.ok(i >= 0, `não achei: ${trecho}`)
  return i
}

describe('integracao-v1: ordem das guardas', () => {
  test('método, segredo, tamanho e assinatura vêm antes de qualquer acesso ao banco', () => {
    const banco = pos('createClient(')
    for (const trecho of [
      "req.method !== 'POST'",
      'haSegredoValido(',
      'req.text()',
      'TextEncoder().encode(corpoBruto)',
      'verificarAssinaturaLista(',
      'validarCorpoIntegracao(',
    ]) {
      assert.ok(pos(trecho) < banco, `${trecho} deve vir antes do createClient`)
    }
    assert.equal(codigo.split('createClient(').length - 1, 1, 'um único cliente, criado depois da assinatura')
  })
  test('lê o corpo UMA vez, em texto, e assina sobre esse texto (nunca req.json)', () => {
    assert.equal(codigo.split('req.text()').length - 1, 1)
    assert.ok(!codigo.includes('req.json'))
    assert.ok(pos('verificarAssinaturaLista(') < pos('JSON.parse('))
  })
  test('códigos: 405, 413, 503 e 401 sem corpo; 422 sem ecoar valores', () => {
    for (const s of [405, 413, 503, 401, 422]) assert.match(codigo, new RegExp(`new Response\\(null, \\{ status: ${s} \\}\\)`), String(s))
  })
  test('503 sem segredo vem antes do 401', () => {
    assert.ok(pos('status: 503') < pos('status: 401'))
  })
})

describe('integracao-v1: sem vazamento', () => {
  test('nenhum console imprime corpo, telefone, nome, itens ou mensagem de erro do banco', () => {
    const consoles = codigo.match(/console\.\w+\([^)]*\)/g) ?? []
    assert.ok(consoles.length > 0)
    for (const c of consoles) {
      assert.doesNotMatch(c, /corpo|telefone|nome|itens|barraca|cliente|\.message|detalhe/i, c)
    }
  })
  test('a resposta 500 é genérica', () => {
    assert.match(codigo, /json\(\{ erro: 'Erro interno' \}, 500\)/)
  })
})

describe('integracao-v1: regras de dinheiro e pedido', () => {
  test('preço vem do resolver_carrinho e o pedido usa as linhas dele', () => {
    assert.match(codigo, /rpc\('resolver_carrinho'/)
    assert.match(codigo, /p_itens: r\.linhas/)
    assert.doesNotMatch(codigo, /preco_centavos_unitario\s*[:=]\s*c\./)
  })
  test('criar_pedido com viagem, na_entrega, tipo de atendimento e telefone', () => {
    assert.match(codigo, /rpc\('criar_pedido'/)
    for (const t of ["p_viagem: true", "p_metodo_pagamento: 'na_entrega'", 'p_tipo_atendimento: c.tipoAtendimento', 'p_cliente_telefone: telefone']) {
      assert.ok(codigo.includes(t), t)
    }
  })
  test('idempotência por client_uuid é conferida antes das recusas da loja', () => {
    assert.ok(pos('pedidoJaCriado(supabase, c.clientUuid') < pos('recusaDaAcao('))
  })
  test('as recusas da loja valem antes de criar o pedido', () => {
    assert.ok(pos('recusaDaAcao(') < pos("rpc('criar_pedido'"))
  })
})
