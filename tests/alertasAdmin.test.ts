// Alertas por e-mail do painel do superadmin (supabase/functions/_shared/alertasAdmin.ts).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { assuntoDoAlerta, corpoDoAlerta, itensDeAlerta } from '../supabase/functions/_shared/alertasAdmin.ts'

const vazio = { parou: [], pico_erros: [], webhook_falhas: 0 }

describe('itensDeAlerta', () => {
  test('sem problema não há item', () => {
    assert.deepEqual(itensDeAlerta(vazio, '2026-10-17'), [])
  })

  test('um item por problema, com chave estável por dia', () => {
    const itens = itensDeAlerta(
      {
        parou: [{ barraca_id: 'b1', nome: 'Loja 1', ultimo_pedido_em: '2026-10-10T12:00:00Z' }],
        pico_erros: [{ versao: 'abc', erros: 12 }],
        webhook_falhas: 4,
      },
      '2026-10-17',
    )
    assert.deepEqual(itens.map((i) => i.chave), ['parou:b1:2026-10-17', 'pico:abc:2026-10-17', 'webhook:2026-10-17'])
    assert.match(itens[0].texto, /Loja 1/)
    assert.match(itens[1].texto, /12 erros/)
    assert.match(itens[2].texto, /4 falhas/)
  })

  test('outro dia, outra chave: o aviso volta a valer', () => {
    const a = { ...vazio, webhook_falhas: 3 }
    assert.notEqual(itensDeAlerta(a, '2026-10-17')[0].chave, itensDeAlerta(a, '2026-10-18')[0].chave)
  })
})

describe('texto do e-mail', () => {
  test('assunto no singular e no plural', () => {
    assert.equal(assuntoDoAlerta(1), 'Sai aê: 1 alerta')
    assert.equal(assuntoDoAlerta(3), 'Sai aê: 3 alertas')
  })
  test('corpo lista cada item', () => {
    const corpo = corpoDoAlerta([{ chave: 'a', texto: 'um' }, { chave: 'b', texto: 'dois' }])
    assert.match(corpo, /- um\n- dois/)
  })
})
