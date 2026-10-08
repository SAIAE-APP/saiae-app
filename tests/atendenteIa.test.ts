// Tela "Atendente IA": WhatsApp do dono, texto livre e o link da loja (src/lib/atendenteIa.ts). Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  MAX_TEXTO_LIVRE,
  codigoValido,
  linkWhatsappDaLoja,
  mensagemErroIa,
  mensagemInicial,
  numeroSaiaeValido,
  validarTextoLivre,
  validarWhatsappDono,
} from '../src/lib/atendenteIa.ts'

describe('validarWhatsappDono', () => {
  test('máscara vira dígitos e o 55 entra quando falta', () => {
    assert.deepEqual(validarWhatsappDono('(11) 99999-0000'), { ok: true, digitos: '5511999990000' })
    assert.deepEqual(validarWhatsappDono('11 3333-4444'), { ok: true, digitos: '551133334444' })
    assert.deepEqual(validarWhatsappDono('+55 11 99999-0000'), { ok: true, digitos: '5511999990000' })
    assert.deepEqual(validarWhatsappDono('5511999990000'), { ok: true, digitos: '5511999990000' })
  })
  test('o resultado cabe na constraint do banco (10 a 13 dígitos)', () => {
    for (const t of ['11999990000', '1133334444', '5511999990000', '551133334444']) {
      const r = validarWhatsappDono(t)
      assert.ok(r.ok && /^[0-9]{10,13}$/.test(r.digitos), t)
    }
  })
  test('vazio, curto, comprido ou de outro país é recusado com motivo', () => {
    for (const ruim of ['', '   ', 'abc', '99999', '119999900', '551199999000012', '+1 415 555 2671', '4499999000099']) {
      const r = validarWhatsappDono(ruim)
      assert.ok(!r.ok && r.motivo.length > 0, ruim)
    }
    assert.equal(validarWhatsappDono(null as unknown as string).ok, false)
  })
})

describe('validarTextoLivre', () => {
  test('aparado; vazio vira null (limpa o campo)', () => {
    assert.deepEqual(validarTextoLivre('  Aceitamos encomendas.  '), { ok: true, texto: 'Aceitamos encomendas.' })
    assert.deepEqual(validarTextoLivre('   '), { ok: true, texto: null })
    assert.deepEqual(validarTextoLivre(null as unknown as string), { ok: true, texto: null })
  })
  test('2000 caracteres passa; 2001 é recusado com a contagem', () => {
    assert.equal(validarTextoLivre('x'.repeat(MAX_TEXTO_LIVRE)).ok, true)
    const r = validarTextoLivre('x'.repeat(MAX_TEXTO_LIVRE + 1))
    assert.ok(!r.ok && /2000/.test(r.motivo) && /2001/.test(r.motivo))
  })
  test('o tamanho é medido depois de aparar', () => {
    assert.equal(validarTextoLivre(' ' + 'x'.repeat(MAX_TEXTO_LIVRE) + ' ').ok, true)
  })
})

describe('link do WhatsApp da loja', () => {
  test('código no formato do banco (sem I, L, O, 0, 1)', () => {
    assert.equal(codigoValido('K7P2QX'), true)
    for (const ruim of ['k7p2qx', 'K7P2Q', 'K7P2QXX', 'K7P2Q0', 'K7P2QI', 'K7P2QL', 'K7P2QO', 'K7P2Q1', '', null, undefined]) {
      assert.equal(codigoValido(ruim as string), false, String(ruim))
    }
  })

  test('mensagem leva o código com # (é o que o CRM procura)', () => {
    assert.match(mensagemInicial('K7P2QX'), /#K7P2QX$/)
  })

  test('monta wa.me com o número do Sai aê e a mensagem codificada', () => {
    const link = linkWhatsappDaLoja('+55 11 4000-1234', 'K7P2QX')!
    assert.ok(link.startsWith('https://wa.me/551140001234?text='))
    assert.equal(decodeURIComponent(link.split('?text=')[1]), mensagemInicial('K7P2QX'))
    assert.ok(link.includes('%23K7P2QX'), 'o # precisa estar codificado, senão vira âncora da URL')
  })

  test('sem número do Sai aê ou sem código válido: null (a tela diz "link indisponível ainda")', () => {
    assert.equal(linkWhatsappDaLoja(undefined, 'K7P2QX'), null)
    assert.equal(linkWhatsappDaLoja('', 'K7P2QX'), null)
    assert.equal(linkWhatsappDaLoja('123', 'K7P2QX'), null)
    assert.equal(linkWhatsappDaLoja('551140001234', null), null)
    assert.equal(linkWhatsappDaLoja('551140001234', 'abc'), null)
  })

  test('o link nunca carrega o WhatsApp do dono', () => {
    const dono = '5511999990000'
    const link = linkWhatsappDaLoja('551140001234', 'K7P2QX')!
    assert.ok(!link.includes(dono) && !link.includes('999990000'))
  })

  test('número do Sai aê: só dígitos, 10 a 15', () => {
    assert.equal(numeroSaiaeValido('+55 (11) 4000-1234'), '551140001234')
    for (const ruim of ['', 'abc', '123456789', '1'.repeat(16), null, undefined]) assert.equal(numeroSaiaeValido(ruim as string), null, String(ruim))
  })
})

describe('mensagemErroIa', () => {
  test('traduz os erros do banco', () => {
    assert.match(mensagemErroIa({ message: 'ia_sem_whatsapp_dono' }), /WhatsApp do dono/)
    assert.match(mensagemErroIa({ message: 'sem acesso a esta barraca' }), /acesso/)
    assert.match(mensagemErroIa({ message: 'Failed to fetch' }), /Sem internet/)
    assert.match(mensagemErroIa({ message: 'algo estranho' }), /algo estranho/)
    assert.match(mensagemErroIa(null), /Não foi possível/)
  })
})
