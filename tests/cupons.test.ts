// Cupons no painel do dono: validação do formulário, selo e textos (src/lib/cupons.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  dataParaIso,
  formularioDoCupom,
  formularioVazio,
  normalizarCodigo,
  podeApagar,
  seloDoCupom,
  textoDescontoDoCupom,
  textoUsos,
  textoValidade,
  validarFormularioCupom,
  type Cupom,
  type FormularioCupom,
} from '../src/lib/cupons.ts'

const form = (o: Partial<FormularioCupom> = {}): FormularioCupom => ({ ...formularioVazio(), codigo: 'FEIRA10', valorTexto: '10', ...o })
const COM_PERFIL = { lojaUsaPerfil: true }
const SEM_PERFIL = { lojaUsaPerfil: false }

describe('normalizarCodigo', () => {
  test('maiúsculas e aparas; regra do banco', () => {
    assert.equal(normalizarCodigo(' feira10 '), 'FEIRA10')
    for (const ruim of ['ab', 'A'.repeat(21), 'FE IRA', 'FEIRA!', '']) assert.equal(normalizarCodigo(ruim), null, ruim)
  })
})

describe('validarFormularioCupom', () => {
  test('percentual válido grava dados prontos (código em maiúsculas, sem datas, ilimitado)', () => {
    const r = validarFormularioCupom(form({ codigo: ' feira10 ' }), COM_PERFIL)
    assert.ok(r.ok)
    assert.deepEqual(r.dados, {
      codigo: 'FEIRA10', tipo: 'percentual', valor: 10, inicio_em: null, fim_em: null,
      limite_usos: null, uma_por_cliente: false, pedido_minimo_centavos: 0, ativo: true,
    })
  })

  test('percentual: 1 a 100, inteiro', () => {
    for (const ok of ['1', '100', '50']) assert.ok(validarFormularioCupom(form({ valorTexto: ok }), COM_PERFIL).ok, ok)
    for (const ruim of ['0', '101', '', '-5', '10,5', 'abc', '1000']) {
      const r = validarFormularioCupom(form({ valorTexto: ruim }), COM_PERFIL)
      assert.ok(!r.ok && r.erros.valor, ruim)
    }
  })

  test('fixo: reais maiores que zero, vírgula ou ponto, vira centavos', () => {
    const r = validarFormularioCupom(form({ tipo: 'fixo', valorTexto: '5,50' }), COM_PERFIL)
    assert.ok(r.ok && r.dados.valor === 550)
    assert.ok(validarFormularioCupom(form({ tipo: 'fixo', valorTexto: '5.5' }), COM_PERFIL).ok)
    for (const ruim of ['0', '0,00', '', 'abc', '-3', '1,234', '9999999,00']) {
      const x = validarFormularioCupom(form({ tipo: 'fixo', valorTexto: ruim }), COM_PERFIL)
      assert.ok(!x.ok && x.erros.valor, ruim)
    }
  })

  test('datas: fim depois do início, formato e dia impossível', () => {
    const ok = validarFormularioCupom(form({ inicioTexto: '2026-10-01', fimTexto: '2026-10-31' }), COM_PERFIL)
    assert.ok(ok.ok && ok.dados.inicio_em && ok.dados.fim_em)
    assert.ok(Date.parse(ok.dados.fim_em!) > Date.parse(ok.dados.inicio_em!))
    const mesmoDia = validarFormularioCupom(form({ inicioTexto: '2026-10-01', fimTexto: '2026-10-01' }), COM_PERFIL)
    assert.ok(mesmoDia.ok, 'início 00:00 e fim 23:59 do mesmo dia é uma janela válida')
    const invertida = validarFormularioCupom(form({ inicioTexto: '2026-10-31', fimTexto: '2026-10-01' }), COM_PERFIL)
    assert.ok(!invertida.ok && invertida.erros.fim)
    for (const ruim of ['31/10/2026', '2026-02-30', '2026-13-01', 'abc']) {
      const r = validarFormularioCupom(form({ fimTexto: ruim }), COM_PERFIL)
      assert.ok(!r.ok && r.erros.fim, ruim)
    }
    assert.equal(dataParaIso('2026-02-30', 'inicio'), null)
  })

  test('só início ou só fim valem', () => {
    assert.ok(validarFormularioCupom(form({ inicioTexto: '2026-10-01' }), COM_PERFIL).ok)
    assert.ok(validarFormularioCupom(form({ fimTexto: '2026-10-31' }), COM_PERFIL).ok)
  })

  test('limite de usos: vazio = ilimitado; senão inteiro de 1 a 1.000.000', () => {
    const r = validarFormularioCupom(form({ limiteTexto: '50' }), COM_PERFIL)
    assert.ok(r.ok && r.dados.limite_usos === 50)
    for (const ruim of ['0', '-1', '1,5', 'abc', '1000001']) {
      const x = validarFormularioCupom(form({ limiteTexto: ruim }), COM_PERFIL)
      assert.ok(!x.ok && x.erros.limite, ruim)
    }
  })

  test('pedido mínimo: vazio = 0; reais válidos viram centavos', () => {
    const r = validarFormularioCupom(form({ minimoTexto: '30' }), COM_PERFIL)
    assert.ok(r.ok && r.dados.pedido_minimo_centavos === 3000)
    const x = validarFormularioCupom(form({ minimoTexto: 'abc' }), COM_PERFIL)
    assert.ok(!x.ok && x.erros.minimo)
  })

  test('uma vez por cliente só com o perfil do cliente ligado', () => {
    assert.ok(validarFormularioCupom(form({ umaPorCliente: true }), COM_PERFIL).ok)
    const r = validarFormularioCupom(form({ umaPorCliente: true }), SEM_PERFIL)
    assert.ok(!r.ok && r.erros.umaPorCliente)
    assert.ok(validarFormularioCupom(form({ umaPorCliente: false }), SEM_PERFIL).ok)
  })

  test('vários erros de uma vez, sem dados', () => {
    const r = validarFormularioCupom(form({ codigo: 'a', valorTexto: '0', limiteTexto: 'x' }), COM_PERFIL)
    assert.ok(!r.ok)
    assert.deepEqual(Object.keys(r.erros).sort(), ['codigo', 'limite', 'valor'])
  })
})

describe('seloDoCupom', () => {
  const agora = new Date('2026-10-15T12:00:00Z')
  const base = { ativo: true, inicio_em: null, fim_em: null, limite_usos: null }
  test('ativo por padrão', () => assert.equal(seloDoCupom(base, 0, agora), 'Ativo'))
  test('pausado vence todos', () => {
    assert.equal(seloDoCupom({ ...base, ativo: false, fim_em: '2026-01-01T00:00:00Z' }, 99, agora), 'Pausado')
  })
  test('vencido pelo fim, esgotado pelo limite, agendado pelo início', () => {
    assert.equal(seloDoCupom({ ...base, fim_em: '2026-10-14T00:00:00Z' }, 0, agora), 'Vencido')
    assert.equal(seloDoCupom({ ...base, fim_em: '2026-10-16T00:00:00Z' }, 0, agora), 'Ativo')
    assert.equal(seloDoCupom({ ...base, limite_usos: 5 }, 5, agora), 'Esgotado')
    assert.equal(seloDoCupom({ ...base, limite_usos: 5 }, 4, agora), 'Ativo')
    assert.equal(seloDoCupom({ ...base, inicio_em: '2026-10-20T00:00:00Z' }, 0, agora), 'Agendado')
  })
  test('vencido tem prioridade sobre esgotado', () => {
    assert.equal(seloDoCupom({ ...base, fim_em: '2026-10-01T00:00:00Z', limite_usos: 1 }, 1, agora), 'Vencido')
  })
})

describe('textos', () => {
  test('desconto', () => {
    assert.equal(textoDescontoDoCupom({ tipo: 'percentual', valor: 10 }), '−10%')
    assert.equal(textoDescontoDoCupom({ tipo: 'fixo', valor: 500 }), '−R$ 5,00')
  })
  test('usos', () => {
    assert.equal(textoUsos(3, 10), '3 / 10 usos')
    assert.equal(textoUsos(1, null), '1 uso')
    assert.equal(textoUsos(0, null), '0 usos')
  })
  test('validade', () => {
    assert.equal(textoValidade({ inicio_em: null, fim_em: null }), 'Sem prazo')
    assert.match(textoValidade({ inicio_em: '2026-10-05T12:00:00Z', fim_em: null }), /^a partir de \d{2}\/\d{2}\/\d{4}$/)
    assert.match(textoValidade({ inicio_em: null, fim_em: '2026-10-05T12:00:00Z' }), /^até \d{2}\/\d{2}\/\d{4}$/)
    assert.match(textoValidade({ inicio_em: '2026-10-05T12:00:00Z', fim_em: '2026-10-25T12:00:00Z' }), /^\d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}$/)
  })
  test('só apaga sem uso', () => {
    assert.equal(podeApagar(0), true)
    assert.equal(podeApagar(1), false)
  })
})

describe('formularioDoCupom (editar) volta a validar igual', () => {
  const c: Cupom = {
    id: '1', codigo: 'FEIRA10', tipo: 'fixo', valor: 550, inicio_em: dataParaIso('2026-10-01', 'inicio'),
    fim_em: dataParaIso('2026-10-31', 'fim'), limite_usos: 20, uma_por_cliente: true, pedido_minimo_centavos: 3000, ativo: false,
  }
  test('texto de reais, datas e limites', () => {
    const f = formularioDoCupom(c)
    assert.deepEqual(
      [f.valorTexto, f.inicioTexto, f.fimTexto, f.limiteTexto, f.minimoTexto, f.umaPorCliente, f.ativo],
      ['5,50', '2026-10-01', '2026-10-31', '20', '30,00', true, false],
    )
    const r = validarFormularioCupom(f, COM_PERFIL)
    assert.ok(r.ok)
    assert.deepEqual(r.dados, { codigo: 'FEIRA10', tipo: 'fixo', valor: 550, inicio_em: c.inicio_em, fim_em: c.fim_em, limite_usos: 20, uma_por_cliente: true, pedido_minimo_centavos: 3000, ativo: false })
  })
  test('percentual sem datas nem limite', () => {
    const f = formularioDoCupom({ ...c, tipo: 'percentual', valor: 15, inicio_em: null, fim_em: null, limite_usos: null, pedido_minimo_centavos: 0 })
    assert.deepEqual([f.valorTexto, f.inicioTexto, f.limiteTexto, f.minimoTexto], ['15', '', '', ''])
  })
})
