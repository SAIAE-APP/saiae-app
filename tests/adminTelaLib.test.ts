// Funções puras da tela do superadmin: rótulos do histórico e mensagens de erro das ações.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mensagemErroAcao, rotuloAcao } from '../src/lib/adminBarracas.ts'

describe('rotuloAcao', () => {
  test('traduz as sete ações e devolve a própria chave para desconhecida', () => {
    assert.equal(rotuloAcao('bloquear_conta'), 'Conta bloqueada')
    assert.equal(rotuloAcao('desbloquear_conta'), 'Conta desbloqueada')
    assert.equal(rotuloAcao('definir_plano'), 'Plano alterado')
    assert.equal(rotuloAcao('estender_vencimento'), 'Vencimento estendido')
    assert.equal(rotuloAcao('arquivar_barraca'), 'Barraca arquivada')
    assert.equal(rotuloAcao('restaurar_barraca'), 'Barraca restaurada')
    assert.equal(rotuloAcao('apagar_barraca_definitivo'), 'Barraca apagada definitivamente')
    assert.equal(rotuloAcao('toString'), 'toString')
  })
})

describe('mensagemErroAcao', () => {
  const casos: [{ code?: string; message?: string } | null, RegExp][] = [
    [{ code: '42501' }, /não tem permissão/],
    [{ code: '22023', message: 'conta vencida' }, /Conta vencida/],
    [{ code: '22023', message: 'conta sem vencimento' }, /não tem vencimento/],
    [{ code: '22023', message: 'dias deve ser de 1 a 365' }, /1 a 365 dias/],
    [{ code: '22023', message: 'nome não confere' }, /não confere/],
    [{ code: '22023', message: 'passou de 30 dias' }, /30 dias/],
    [{ code: '22023', message: 'conta sem assinatura' }, /não tem assinatura/],
    [{ code: '22023', message: 'qualquer outra' }, /dados inválidos/],
    [{ code: 'XX000', message: 'texto cru do banco' }, /Tente de novo/],
    [null, /Tente de novo/],
  ]
  for (const [erro, esperado] of casos) {
    test(JSON.stringify(erro), () => {
      const m = mensagemErroAcao(erro)
      assert.match(m, esperado)
      assert.doesNotMatch(m, /texto cru/)
    })
  }
})
