// estornar-pagamento: a decisão (acesso, elegibilidade, idempotência, saldo insuficiente) é testada em
// supabase/functions/_shared/pagamento/pagamento.test.ts (estornarPedido). Aqui só a ligação na edge function
// (Deno, não importável no Node), a higiene de log e o botão do Histórico. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const ler = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fonte = ler('../supabase/functions/estornar-pagamento/index.ts')
const historico = ler('../src/pages/Historico.tsx')

describe('estornarPagamento', () => {
  test('exige JWT e valida o pedido_id antes de tocar no banco', () => {
    assert.match(fonte, /return json\(\{ erro: 'Não autenticado' \}, 401\)/)
    assert.match(fonte, /auth\.getUser\(jwt\)/)
    assert.ok(fonte.indexOf('UUID.test(pedidoId)') < fonte.indexOf('SUPABASE_SERVICE_ROLE_KEY'))
  })

  test('decisão vem do módulo puro; dono confere papel dono da barraca do pedido', () => {
    assert.ok(fonte.includes('estornarPedido('))
    assert.match(fonte, /\.eq\('papel', 'dono'\)/)
    assert.match(fonte, /\.eq\('usuario_id', usuarioId\)/)
    assert.ok(fonte.includes('obterTokenVendedor('))
    assert.ok(fonte.includes('buscarTokenDoProvedor('))
  })

  test('grava estornado_em só no pendente ainda não estornado', () => {
    assert.match(fonte, /update\(\{ estornado_em: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', pendenteId\)\.is\('estornado_em', null\)/)
  })

  test('nenhum console.* registra token, id de pagamento, cartão ou e-mail', () => {
    for (const linha of fonte.split('\n').filter((l) => /console\.(log|info|warn|error|debug)/.test(l))) {
      assert.doesNotMatch(linha.replace(/'[^']*'/g, ''), /token|card|cartao|email|payer|order_id|idExterno|pedidoId|pendente/i, 'log suspeito: ' + linha)
    }
  })

  test('Histórico: só cancela o pedido depois do estorno confirmado, pelo caminho de cancelamento de sempre', () => {
    const i = historico.indexOf("functions.invoke('estornar-pagamento'")
    assert.ok(i > 0)
    const j = historico.indexOf("enfileirar('mudar_status'", i)
    assert.ok(j > i)
    assert.match(historico.slice(j, j + 200), /status: 'cancelado'/)
    // a recusa (erro) retorna antes de cancelar
    assert.ok(historico.slice(i, j).includes('return'))
  })
})
