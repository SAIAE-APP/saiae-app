// Modelo de preço único: valores, ciclos, economia, resumo e links antigos. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ANUAL_ECONOMIA_CENTAVOS,
  ANUAL_ECONOMIA_PERCENTUAL,
  ANUAL_EQUIVALENTE_MES_CENTAVOS,
  PLANO_VENDA,
  PRECO_BASE_ANUAL_CENTAVOS,
  PRECO_BASE_MENSAL_CENTAVOS,
  PRECO_FISCAL_MENSAL_CENTAVOS,
  cicloDoLink,
  formatarPreco,
  linkAssinar,
  nomePlano,
  resumoCobranca,
} from '../src/lib/planos.ts'

describe('preços', () => {
  test('valores em centavos', () => {
    assert.equal(PRECO_BASE_MENSAL_CENTAVOS, 5790)
    assert.equal(PRECO_BASE_ANUAL_CENTAVOS, 49900)
    assert.equal(PRECO_FISCAL_MENSAL_CENTAVOS, 6990)
  })
  test('economia do anual', () => {
    assert.equal(PRECO_BASE_MENSAL_CENTAVOS * 12, 69480)
    assert.equal(ANUAL_ECONOMIA_CENTAVOS, 19580)
    assert.equal(formatarPreco(ANUAL_ECONOMIA_CENTAVOS), 'R$ 195,80')
    assert.equal(ANUAL_ECONOMIA_PERCENTUAL, 28)
    assert.equal(formatarPreco(ANUAL_EQUIVALENTE_MES_CENTAVOS), 'R$ 41,58')
  })
})

describe('resumoCobranca', () => {
  test('mensal sem fiscal', () => {
    const r = resumoCobranca('mensal', false)
    assert.equal(r.total, 'R$ 57,90 por mês')
    assert.equal(r.linhas.length, 1)
    assert.equal(r.economia, null)
  })
  test('mensal com fiscal soma por mês', () => {
    const r = resumoCobranca('mensal', true)
    assert.equal(r.total, 'R$ 127,80 por mês')
    assert.equal(r.linhas.length, 2)
  })
  test('anual sem fiscal', () => {
    const r = resumoCobranca('anual', false)
    assert.equal(r.total, 'R$ 499,00 por ano')
    assert.match(r.economia ?? '', /R\$ 41,58 por mês.*R\$ 195,80 \(28%\)/)
  })
  test('anual com fiscal mantém periodicidades separadas', () => {
    const r = resumoCobranca('anual', true)
    assert.equal(r.total, 'R$ 499,00 por ano + R$ 69,90 por mês')
    assert.deepEqual(r.linhas.map((l) => l.texto), ['R$ 499,00 por ano', 'R$ 69,90 por mês'])
  })
})

describe('links', () => {
  test('linkAssinar usa plano e ciclo', () => {
    assert.equal(linkAssinar(PLANO_VENDA, 'anual'), '/assinar?plano=ponto&ciclo=anual')
  })
  test('plano vendido é ponto; links antigos só aproveitam o ciclo', () => {
    assert.equal(PLANO_VENDA, 'ponto')
    assert.equal(cicloDoLink('anual'), 'anual')
    assert.equal(cicloDoLink('mensal'), 'mensal')
  })
  test('ciclo ausente vale mensal; desconhecido é inválido', () => {
    assert.equal(cicloDoLink(null), 'mensal')
    assert.equal(cicloDoLink(''), 'mensal')
    assert.equal(cicloDoLink('trimestral'), null)
  })
})

describe('nomePlano', () => {
  test('nomes de exibição, inclusive legados', () => {
    assert.equal(nomePlano('ponto'), 'Sai aê')
    assert.equal(nomePlano('essencial'), 'Essencial')
    assert.equal(nomePlano('pro'), 'Pro')
    assert.equal(nomePlano(null), 'Sai aê')
  })
})

test('versão do termo dos módulos', async () => {
  const { TERMO_MODULOS_VERSAO } = await import('../src/lib/planos.ts')
  assert.equal(TERMO_MODULOS_VERSAO, 'termos-2026-10-v1')
})
