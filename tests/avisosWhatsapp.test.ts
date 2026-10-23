// Avisos de status por WhatsApp: normalização e texto. Rodar: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AVISOS_PADRAO,
  AVISO_TIPOS,
  MAX_TEXTO_AVISO,
  normalizarAvisos,
  textoDoAviso,
} from '../src/lib/avisosWhatsapp.ts'

const valores = { nome: 'Maria Silva', senha: 42, barraca: 'Sabor Kawashima' }

describe('normalizarAvisos', () => {
  test('null vira as cinco chaves ativas com texto null', () => {
    const c = normalizarAvisos(null)
    assert.deepEqual(Object.keys(c), [...AVISO_TIPOS])
    for (const t of AVISO_TIPOS) assert.deepEqual(c[t], { ativo: true, texto: null })
  })

  test('descarta chave desconhecida', () => {
    const c = normalizarAvisos({ em_preparo: { ativo: true, texto: 'x' } }) as Record<string, unknown>
    assert.equal('em_preparo' in c, false)
  })

  test('texto só com espaços vira null', () => {
    assert.equal(normalizarAvisos({ pronto: { ativo: true, texto: '   ' } }).pronto.texto, null)
  })

  test('texto acima do limite vira null', () => {
    const c = normalizarAvisos({ pronto: { ativo: true, texto: 'a'.repeat(MAX_TEXTO_AVISO + 1) } })
    assert.equal(c.pronto.texto, null)
  })

  test('ativo não booleano vira ativo true', () => {
    assert.equal(normalizarAvisos({ pronto: { ativo: 'sim', texto: null } }).pronto.ativo, true)
  })

  test('preserva ativo false e texto válido', () => {
    const c = normalizarAvisos({ entregue: { ativo: false, texto: ' Oi {nome} ' } })
    assert.deepEqual(c.entregue, { ativo: false, texto: 'Oi {nome}' })
  })
})

describe('textoDoAviso', () => {
  test('texto null usa o padrão e preenche as variáveis', () => {
    const t = textoDoAviso('pronto', normalizarAvisos(null), valores)
    assert.match(t, /Maria/)
    assert.match(t, /#42/)
    assert.match(t, /Sabor Kawashima/)
    assert.doesNotMatch(t, /\{/)
  })

  test('variável sem valor some junto do espaço', () => {
    const t = textoDoAviso('pronto', normalizarAvisos({ pronto: { ativo: true, texto: 'Olá {nome}! Pedido {senha}.' } }), { ...valores, nome: null })
    assert.equal(t, 'Olá! Pedido #42.')
  })

  test('cada padrão traz senha ou barraca e não fala em preparo', () => {
    for (const t of AVISO_TIPOS) {
      assert.match(AVISOS_PADRAO[t].texto, /\{senha\}|\{barraca\}/)
      assert.doesNotMatch(AVISOS_PADRAO[t].texto, /preparo|preparando/i)
    }
  })
})
