// criar-pagamento-pix no marketplace: taxa Sai aê, OAuth do vendedor e cartão. As regras (total, credencial, corte,
// meio) são testadas em supabase/functions/_shared/pagamento/pagamento.test.ts; aqui só a ligação na edge function
// (Deno, não importável no Node) e a higiene de log. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const pix = readFileSync(new URL('../supabase/functions/criar-pagamento-pix/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('criarPagamentoMarketplace', () => {
  test('nenhum console.* registra token do cartão, e-mail, CPF ou token de acesso', () => {
    for (const linha of pix.split('\n')) {
      if (/console\.(log|info|warn|error|debug)/.test(linha)) {
        assert.doesNotMatch(linha, /card_?token|cardToken|cartao|email|cpf|token|body\b/i, 'log suspeito: ' + linha)
      }
    }
  })

  test('decisões vêm do módulo puro', () => {
    for (const nome of ['lerMeioPagamento(', 'decidirCredencial(', 'corteTokenAtingido(', 'totalDaCobranca(', 'obterTokenVendedor(', 'statusCartaoParaCliente(']) {
      assert.ok(pix.includes(nome), nome)
    }
    assert.match(pix, /Deno\.env\.get\('CORTE_TOKEN_MP_ISO'\)/)
  })

  test('meio inválido ou cartão incompleto é recusado antes de qualquer cobrança', () => {
    assert.ok(pix.indexOf('lerMeioPagamento(') < pix.indexOf('registrarTentativa('))
  })

  test('taxa gravada no pendente (insert e update do reaproveitado) e devolvida na resposta e no 409', () => {
    assert.equal(pix.match(/taxa_plataforma_centavos: taxaPlataformaCentavos/g)?.length ?? 0, 2 + 3)
    assert.match(pix, /taxaPlataformaCentavos,\n/)
  })

  test('retry do QR já emitido compara com o total que inclui a taxa e usa a credencial da emissão', () => {
    assert.match(pix, /totalEsperadoDoPendente\(/)
    assert.match(pix, /emitidoViaOauth\(pendenteExistente\)/)
  })

  test('pedido grátis continua antes de qualquer cobrança (Pix ou cartão)', () => {
    const iGratis = pix.indexOf("'criar_pedido_com_cupom'")
    assert.ok(iGratis > 0 && iGratis < pix.indexOf('provedor.criarCobranca(') && iGratis < pix.indexOf('provedor.criarCobrancaCartao('))
  })

  test('cartão recusado devolve a vaga do cupom e a resposta não traz detalhe do provedor', () => {
    const bloco = pix.slice(pix.indexOf('provedor.criarCobrancaCartao('), pix.indexOf('provedor.criarCobranca('))
    assert.match(bloco, /rpc\('cupom_liberar'/)
    assert.doesNotMatch(bloco, /detalhe/)
    assert.doesNotMatch(bloco, /qr_code/)
  })

  test("ação 'chave_publica' devolve só a chave pública", () => {
    assert.match(pix, /acao === 'chave_publica'/)
    assert.match(pix, /chavePublicaDaBarraca\(/)
    assert.doesNotMatch(pix.slice(pix.indexOf("acao === 'chave_publica'"), pix.indexOf("acao === 'chave_publica'") + 600), /access_token|token:/)
  })
})
