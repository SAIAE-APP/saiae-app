// Contrato v1: campo opcional data.avisos (WhatsApp e Automação). Rodar: npm test
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const lerJson = (caminho: string) => JSON.parse(readFileSync(new URL(`../docs/contrato/v1/${caminho}`, import.meta.url), 'utf8'))
const schema = lerJson('evento.schema.json')
const exemplo = lerJson('exemplos/pedido-com-avisos.json')
const TIPOS = ['recebido', 'pronto', 'saiu_entrega', 'entregue', 'cancelado']

// Validação mínima do formato de avisos conforme o schema (o repo não tem validador de JSON Schema).
function avisosValidos(avisos: unknown): boolean {
  const def = schema.$defs.pedido.properties.avisos
  if (typeof avisos !== 'object' || avisos === null || Array.isArray(avisos)) return false
  for (const [chave, cfg] of Object.entries(avisos as Record<string, { ativo?: unknown; texto?: unknown }>)) {
    if (!(chave in def.properties)) return false
    if (typeof cfg?.ativo !== 'boolean') return false
    if (cfg.texto !== null && (typeof cfg.texto !== 'string' || cfg.texto.length > 500)) return false
  }
  return true
}

describe('contrato data.avisos', () => {
  test('schema declara as cinco chaves, sem chave extra, texto até 500', () => {
    const def = schema.$defs.pedido.properties.avisos
    assert.deepEqual(Object.keys(def.properties), TIPOS)
    assert.equal(def.additionalProperties, false)
    assert.equal(schema.$defs.aviso_config.properties.texto.maxLength, 500)
    assert.ok(!schema.$defs.pedido.required.includes('avisos'))
  })

  test('exemplo com avisos é válido', () => {
    assert.ok(avisosValidos(exemplo.avisos))
  })

  test('texto de 501 caracteres é inválido', () => {
    assert.equal(avisosValidos({ pronto: { ativo: true, texto: 'a'.repeat(501) } }), false)
  })

  test('chave em_preparo é inválida', () => {
    assert.equal(avisosValidos({ em_preparo: { ativo: true, texto: null } }), false)
  })

  test('exemplo antigo, sem avisos, continua sendo um pedido válido', () => {
    const antigo = lerJson('exemplos/pedido-itens-com-opcoes.json')
    assert.equal('avisos' in antigo, false)
  })
})
