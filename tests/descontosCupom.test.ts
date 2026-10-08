// Cupom à parte do faturamento: linha do pedido, totais do relatório e evento. Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { calcularDescontosCupom, textoCupomDoPedido } from '../src/lib/descontosCupom.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

describe('textoCupomDoPedido', () => {
  test('"Cupom FEIRA10: −R$ 5,00"', () => {
    assert.equal(textoCupomDoPedido({ cupom_codigo: 'FEIRA10', desconto_cupom_centavos: 500 }), 'Cupom FEIRA10: −R$ 5,00')
    assert.equal(textoCupomDoPedido({ cupom_codigo: 'OFF', desconto_cupom_centavos: 1234 }), 'Cupom OFF: −R$ 12,34')
  })
  test('pedido sem cupom ou pedido antigo: vazio', () => {
    assert.equal(textoCupomDoPedido({ cupom_codigo: null, desconto_cupom_centavos: 0 }), '')
    assert.equal(textoCupomDoPedido({}), '')
    assert.equal(textoCupomDoPedido({ cupom_codigo: 'X' }), '')
  })
  test('cupom apagado depois: o desconto continua aparecendo (cópia no pedido)', () => {
    assert.equal(textoCupomDoPedido({ cupom_codigo: null, desconto_cupom_centavos: 300 }), 'Cupom: −R$ 3,00')
  })
})

describe('calcularDescontosCupom', () => {
  test('soma só pedidos não cancelados com desconto', () => {
    const r = calcularDescontosCupom([
      { status: 'entregue', desconto_cupom_centavos: 500 },
      { status: 'pronto', desconto_cupom_centavos: 250 },
      { status: 'cancelado', desconto_cupom_centavos: 900 },
      { status: 'a_fazer', desconto_cupom_centavos: 0 },
      { status: 'entregue' },
    ])
    assert.deepEqual(r, { quantidade: 2, valor: 750 })
  })
  test('sem cupom nenhum: zero (a seção do relatório nem aparece)', () => {
    assert.deepEqual(calcularDescontosCupom([{ status: 'entregue' }]), { quantidade: 0, valor: 0 })
    assert.deepEqual(calcularDescontosCupom([]), { quantidade: 0, valor: 0 })
  })
})

describe('evento para o CRM', () => {
  const sql = ler('supabase/migrations/20261018130000_evento_cupom.sql')
  test('leva cupom_codigo e desconto só quando há desconto; total é o pago', () => {
    assert.match(sql, /'cupom_codigo', case when v_desconto > 0 then p\.cupom_codigo end/)
    assert.match(sql, /'desconto_cupom_centavos', case when v_desconto > 0 then v_desconto end/)
    assert.match(sql, /'total_centavos', v_soma - v_desconto \+ v_taxa/)
  })
  test('mantém tudo o que já existia (telefone do perfil, nome da barraca, opções)', () => {
    for (const trecho of ['barraca_nome', 'clientes_finais c where c.id = p.cliente_id', "'opcoes'", 'consentimento_contato']) {
      assert.ok(sql.includes(trecho), trecho)
    }
  })
  test('contrato v1 documenta os campos opcionais', () => {
    const schema = ler('docs/contrato/v1/evento.schema.json')
    assert.match(schema, /"cupom_codigo"/)
    assert.match(schema, /"desconto_cupom_centavos"/)
    assert.doesNotMatch(schema, /"required": \[[^\]]*cupom/)
    assert.match(ler('INTEGRACAO.md'), /cupom_codigo/)
  })
})

describe('NFC-e', () => {
  const nfce = ler('supabase/functions/emitir-nfce/index.ts')
  test('desconto rateado por item (valor_desconto) e total da forma de pagamento já descontado; taxa fora', () => {
    assert.match(nfce, /ratearDesconto\(/)
    assert.match(nfce, /valor_desconto: descontosPorItem\[indice\] \/ 100/)
    assert.match(nfce, /descontosPorItem\.reduce\(\(a, b\) => a \+ b, 0\)\) \/ 100/)
    assert.doesNotMatch(nfce, /taxa_entrega_centavos[^\n]*valorTotal/)
  })
  test('lê o desconto à parte (não quebra antes da migration dos cupons)', () => {
    assert.match(nfce, /select\('desconto_cupom_centavos'\)/)
  })
})
