// "Saiu para entrega", PR 2/4: regra da coluna e ligação na Cozinha.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  cronometroCongelado,
  minutosDesdeQueSaiu,
  pedidoDeEntrega,
  podeSairParaEntrega,
  saiuEntregaLigado,
} from '../src/lib/saiuEntrega.ts'

const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const lojaComEntrega = { modos_atendimento: ['balcao', 'entrega'] as ('mesa' | 'balcao' | 'retirada' | 'entrega')[], saiu_entrega_habilitado: true }
const entrega = { tipo_atendimento: 'entrega' as const, mesa: null, viagem: true, status: 'pronto' as const }

describe('saiuEntregaLigado', () => {
  test('só com o interruptor E o modo Entrega ligados', () => {
    assert.equal(saiuEntregaLigado(lojaComEntrega), true)
    assert.equal(saiuEntregaLigado({ ...lojaComEntrega, saiu_entrega_habilitado: false }), false)
    assert.equal(saiuEntregaLigado({ modos_atendimento: ['balcao', 'entrega'] }), false)
    assert.equal(saiuEntregaLigado({ modos_atendimento: ['balcao', 'retirada'], saiu_entrega_habilitado: true }), false)
  })
})

describe('podeSairParaEntrega', () => {
  test('só pedido de Entrega em Pronto com a coluna ligada', () => {
    assert.equal(podeSairParaEntrega(entrega, lojaComEntrega), true)
    assert.equal(podeSairParaEntrega({ ...entrega, status: 'a_fazer' }, lojaComEntrega), false)
    assert.equal(podeSairParaEntrega({ ...entrega, tipo_atendimento: 'retirada' }, lojaComEntrega), false)
    assert.equal(podeSairParaEntrega(entrega, { ...lojaComEntrega, saiu_entrega_habilitado: false }), false)
  })
  test('pedido de Entrega antigo sem tipo_atendimento e viagem=false (mesa/balcão) não sai', () => {
    assert.equal(pedidoDeEntrega({ tipo_atendimento: null, mesa: '4', viagem: false }), false)
  })
})

describe('cronômetro e tempo', () => {
  test('congela em Pronto e em Saiu para entrega', () => {
    assert.equal(cronometroCongelado('pronto'), true)
    assert.equal(cronometroCongelado('saiu_entrega'), true)
    assert.equal(cronometroCongelado('a_fazer'), false)
  })
  test('"saiu há N min" arredonda para baixo e nunca fica negativo', () => {
    const t = Date.parse('2026-10-11T12:00:00Z')
    assert.equal(minutosDesdeQueSaiu('2026-10-11T11:55:30Z', t), 4)
    assert.equal(minutosDesdeQueSaiu('2026-10-11T12:05:00Z', t), 0)
    assert.equal(minutosDesdeQueSaiu(null, t), null)
  })
})

describe('ligação na Cozinha', () => {
  const c = ler('src/pages/Cozinha.tsx')
  test('Saiu vai pela fila com saiu_entrega_em e Voltar para Pronto limpa o campo', () => {
    assert.match(c, /status: 'saiu_entrega', saiu_entrega_em: agora/)
    assert.match(c, /status: 'pronto', saiu_entrega_em: null/)
  })
  test('com a coluna desligada nada some: Saiu aparece em Pronto', () => {
    assert.match(c, /p\.status === 'pronto' \|\| \(!colunaSaiu && p\.status === 'saiu_entrega'\)/)
  })
  test('a terceira coluna só existe com o interruptor ligado (kanban idêntico ao de antes se desligado)', () => {
    assert.match(c, /\$\{colunaSaiu \? 'md:grid-cols-3' : 'md:grid-cols-2'\}/)
    assert.match(c, /\.\.\.\(colunaSaiu\s*\?/)
  })
  test('a folha oferece o link do entregador e Pular', () => {
    assert.match(c, /<BotoesLinkEntregador token=\{pedidoSaiu\.entrega_token\} senha=\{pedidoSaiu\.senha\} \/>/)
    assert.match(c, /Pular/)
  })
})
