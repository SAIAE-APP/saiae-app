// Perfil do cliente final: validação do formulário e "pedir de novo" (src/lib/clientePerfil.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { lerPedirDeNovo, resumoPedirDeNovo, validarDadosIdentificacao } from '../src/lib/clientePerfil.ts'

describe('validarDadosIdentificacao', () => {
  test('tudo certo: sem erros', () => {
    assert.deepEqual(validarDadosIdentificacao({ nome: 'Ana Souza', telefone: '(61) 99953-1848', aceitouPrivacidade: true }), {})
  })
  test('nome curto, telefone sem DDD e privacidade não aceita', () => {
    const e = validarDadosIdentificacao({ nome: 'A', telefone: '99953-1848', aceitouPrivacidade: false })
    assert.ok(e.nome && e.telefone && e.privacidade)
  })
  test('aceita telefone com +55', () => {
    assert.deepEqual(validarDadosIdentificacao({ nome: 'Ana', telefone: '+55 61 99953-1848', aceitouPrivacidade: true }), {})
  })
  test('DDD 55 (Santa Maria) com 10 ou 11 dígitos não é cortado', () => {
    assert.deepEqual(validarDadosIdentificacao({ nome: 'Ana', telefone: '55 99953-1848', aceitouPrivacidade: true }), {})
  })
  test('telefone com letras ou comprido demais é recusado', () => {
    assert.ok(validarDadosIdentificacao({ nome: 'Ana', telefone: 'abc', aceitouPrivacidade: true }).telefone)
    assert.ok(validarDadosIdentificacao({ nome: 'Ana', telefone: '5561999531848999', aceitouPrivacidade: true }).telefone)
  })
})

describe('resumoPedirDeNovo', () => {
  const l = (o: object) => ({ item_id: 'a', nome: 'X', quantidade: 1, status: 'ok', preco_atual_centavos: 1000, preco_antigo_centavos: 1000, ...o })
  test('ok e preço novo entram; o resto fica de fora com aviso', () => {
    const r = resumoPedirDeNovo([
      l({ item_id: '1' }),
      l({ item_id: '2', status: 'preco_mudou', preco_atual_centavos: 1200 }),
      l({ item_id: '3', status: 'esgotado' }),
      l({ item_id: '4', status: 'indisponivel' }),
      l({ item_id: '5', status: 'refazer_opcoes' }),
    ] as never)
    assert.deepEqual(r.montar.map((x) => x.item_id), ['1', '2'])
    assert.equal(r.bloqueados.length, 3)
    assert.equal(r.avisos.length, 4)
    assert.match(r.avisos.join(' '), /R\$ 12,00/)
  })
  test('nada utilizável: monta vazio', () => {
    const r = resumoPedirDeNovo([l({ status: 'indisponivel' })] as never)
    assert.equal(r.montar.length, 0)
  })
})

describe('lerPedirDeNovo', () => {
  test('lê itens válidos e descarta o resto', () => {
    assert.deepEqual(lerPedirDeNovo(JSON.stringify([{ item_id: 'a', quantidade: 2 }, { item_id: 3, quantidade: 1 }, { item_id: 'b', quantidade: 0 }, { item_id: 'c', quantidade: 51 }, null])), [{ item_id: 'a', quantidade: 2 }])
  })
  test('JSON quebrado, vazio ou não-array viram lista vazia', () => {
    for (const ruim of [null, '', '{quebrado', '{"a":1}', '"x"']) assert.deepEqual(lerPedirDeNovo(ruim), [])
  })
})
