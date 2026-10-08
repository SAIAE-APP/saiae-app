// Cliente só com telefone (sem endereço) não pode virar "null, null - null" nem quebrar o formulário. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { camposDeEndereco, SEM_ENDERECO, textoEndereco } from '../src/lib/enderecoCliente.ts'

describe('textoEndereco', () => {
  test('endereço completo, com e sem referência', () => {
    assert.equal(textoEndereco({ rua: 'Rua A', numero: '10', bairro: 'Centro' }), 'Rua A, 10 - Centro')
    assert.equal(textoEndereco({ rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'perto da praça' }), 'Rua A, 10 - Centro (perto da praça)')
  })
  test('nulo, vazio ou só espaços: Sem endereço', () => {
    for (const e of [{}, { rua: null, numero: null, bairro: null }, { rua: '  ', numero: '', bairro: ' ' }, { rua: null, referencia: 'só referência' }]) {
      assert.equal(textoEndereco(e), SEM_ENDERECO) // referência sozinha não é endereço
    }
  })
  test('endereço parcial não mostra null nem vírgulas soltas', () => {
    assert.equal(textoEndereco({ rua: 'Rua A', numero: null, bairro: null }), 'Rua A')
    assert.equal(textoEndereco({ rua: null, numero: null, bairro: 'Centro' }), 'Centro')
    assert.equal(textoEndereco({ rua: 'Rua A', numero: '10', bairro: null }), 'Rua A, 10')
    assert.ok(!/null|undefined/.test(textoEndereco({ rua: 'R', numero: null, bairro: 'B' })))
  })
})

describe('camposDeEndereco', () => {
  test('nulos viram vazios e a referência vazia vira null', () => {
    assert.deepEqual(camposDeEndereco({ rua: null, numero: undefined, bairro: ' ', referencia: '  ' }), { rua: '', numero: '', bairro: '', referencia: null })
  })
  test('aparas e mantém o que existe', () => {
    assert.deepEqual(camposDeEndereco({ rua: ' Rua A ', numero: '10', bairro: 'Centro', referencia: 'x' }), { rua: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'x' })
  })
})

import { validarDadosEntrega } from '../src/lib/entrega.ts'

describe('validarDadosEntrega com endereço nulo (cliente só com telefone)', () => {
  test('pede rua, número e bairro em vez de quebrar', () => {
    const dados = { nome: 'Ana', telefone: '61999531848', ...camposDeEndereco({ rua: null, numero: null, bairro: null }) }
    const erros = validarDadosEntrega(dados)
    assert.ok(erros.rua && erros.numero && erros.bairro)
    assert.equal(erros.nome, undefined)
    // mesmo se um null escapar do tipo
    assert.doesNotThrow(() => validarDadosEntrega({ ...dados, rua: null as unknown as string, numero: undefined as unknown as string }))
  })
  test('endereço completo valida', () => {
    assert.deepEqual(validarDadosEntrega({ nome: 'Ana', telefone: '61999531848', rua: 'A', numero: '1', bairro: 'B', referencia: null }), {})
  })
})
